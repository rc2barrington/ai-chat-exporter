// Background Service Worker for AI Chat Exporter Chrome Extension
// Coordinates sequential tab activation, scripting, and delegates zipping/downloading to an offscreen document.

let isCancelled = false;
let isExporting = false;
let currentExportTabId = null;
let logsList = [];

// Log status message and cache it, then broadcast to popup if open
function logProgress(message, type = "info") {
  const time = new Date().toLocaleTimeString();
  console.log(`[${type.toUpperCase()}] [${time}] ${message}`);

  // Store the log in logsList
  logsList.push({ message, type, time });
  if (logsList.length > 200) {
    logsList.shift();
  }

  try {
    chrome.runtime.sendMessage({
      action: "progress",
      message: message,
      type: type,
      time: time
    }, () => {
      // Reading lastError silences the "Unchecked runtime.lastError" warning when the popup is closed.
      void chrome.runtime.lastError;
    });
  } catch (err) {
    console.error("Failed to send progress message:", err);
  }
}

// Create the offscreen document context for DOM-based zipping and downloads
async function setupOffscreenDocument(path) {
  try {
    await chrome.offscreen.createDocument({
      url: path,
      reasons: ['DOM_PARSER'],
      justification: 'Fetch remote files, compile JSZip, and trigger download using blob URLs'
    });
  } catch (err) {
    // If it already exists, ignore the error
    if (err && err.message && !err.message.includes("Only a single offscreen document may be created")) {
      throw err;
    }
  }
}

// Close the offscreen document context
async function closeOffscreenDocument() {
  try {
    await chrome.offscreen.closeDocument();
  } catch (err) {
    // Ignore error if already closed
  }
}

// Listen for keep-alive heartbeats to prevent SW termination during long tasks
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'keepAlive') {
    port.onMessage.addListener((msg) => {
      // The act of receiving this message resets the 30-second idle timer.
    });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request) return;

  if (request.action === "forwardProgress") {
    logProgress(request.message, request.type || "info");
    return;
  }

  if (request.action === "startExport") {
    isCancelled = false;
    isExporting = true;
    logsList = [];

    runBatchExport(request.tabs, request.options)
      .then(() => {
        isExporting = false;
        if (isCancelled) {
          logProgress("Batch export was cancelled.", "error");
        } else {
          logProgress("Batch export sequence completed.", "success");
        }
      })
      .catch((err) => {
        isExporting = false;
        logProgress(`Batch export failed: ${err.message || err}`, "error");
      });

    sendResponse({ status: "started" });
    return true;
  }

  if (request.action === "cancelExport") {
    isCancelled = true;
    logProgress("Cancelling export request...", "info");
    if (currentExportTabId) {
      try {
        chrome.tabs.sendMessage(currentExportTabId, { action: "cancelExport" }, () => {
          void chrome.runtime.lastError;
        });
      } catch (e) {}
    }
    sendResponse({ status: "cancelled" });
    return true;
  }

  if (request.action === "getStatus") {
    sendResponse({
      isExporting: isExporting,
      logs: logsList
    });
    return true;
  }

  // Legacy pop-out request from older content scripts: acknowledge and do
  // nothing. Window manipulation (pop-out, resize, focus-steal) is gone —
  // hidden tabs are kept alive by the visibility patch + wake pulses instead.
  if (request.action === "popOutTab") {
    sendResponse({ status: "success" });
    return true;
  }

});


// ----- TEST HOOK -----
// Allows starting an export via externally_connectable (web page → extension).
function handleTestExport(tabId, sendResponse) {
  if (isExporting) return false;
  isCancelled = false;
  isExporting = true;
  logsList = [];
  logProgress("[TEST HOOK] Auto-export triggered.", "info");
  runBatchExport([tabId], {
    includeThinking: true,
    includeTools: true,
    includeMedia: false
  })
    .then(() => {
      isExporting = false;
      logProgress(isCancelled ? "Batch export was cancelled." : "Batch export sequence completed.",
        isCancelled ? "error" : "success");
    })
    .catch((err) => {
      isExporting = false;
      logProgress(`Batch export failed: ${err.message || err}`, "error");
    });
  sendResponse({ status: "started" });
  return true;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.action === "testExport" && sender && sender.tab) {
    return handleTestExport(sender.tab.id, sendResponse);
  }
});

// External messages from web pages (via externally_connectable)
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (request && request.action === "testExport" && sender && sender.tab) {
    return handleTestExport(sender.tab.id, sendResponse);
  }
});

async function runBatchExport(targetTabIds, options) {
  logProgress(`Starting batch export of ${targetTabIds.length} chat(s) in background...`, "info");

  try {
    // Keep service worker alive by opening the offscreen document immediately
    await setupOffscreenDocument('offscreen.html');

    // Save the currently active tab to restore it later
    const initialActiveTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const initialActiveTab = initialActiveTabs[0];

    for (let tabId of targetTabIds) {
      if (isCancelled) {
        logProgress("Export cancelled before starting next tab.", "info");
        break;
      }

      let exportWindowId = null;
      let origWindowId = null;
      let origIndex = 0;

      try {
        const tabObj = await chrome.tabs.get(tabId);
        const tabTitle = tabObj ? tabObj.title : `Tab ${tabId}`;

        currentExportTabId = tabId;
        origWindowId = tabObj.windowId;
        origIndex = tabObj.index;
        try {
          const win = await chrome.windows.create({
            tabId: tabId,
            focused: false,
            state: "normal"
          });
          exportWindowId = win.id;
          logProgress(`Opened export window for "${tabTitle}".`, "info");
        } catch (e) {
          logProgress(`Could not open export window, exporting in place.`, "info");
          await chrome.tabs.update(tabId, { active: true });
        }
        await new Promise(r => setTimeout(r, 600));

        if (isCancelled) break;

        logProgress(`Injecting scraper script...`, "info");
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ["contentScript.js"]
        });

        if (isCancelled) break;

        logProgress(`Executing scraper on webpage...`, "info");

        // Wake pulse: keeps the service worker alive and lets the content
        // script's sleep() resolve via __exportWake even if the window
        // ends up behind other windows.
        const wakeInterval = setInterval(() => {
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: () => { document.dispatchEvent(new Event('__exportWake')); }
          }).catch(() => {});
        }, 500);

        const EXPORT_TIMEOUT_MS = 30 * 60 * 1000;
        const response = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            clearInterval(wakeInterval);
            reject(new Error("Export timed out after 30 minutes."));
          }, EXPORT_TIMEOUT_MS);

          chrome.tabs.sendMessage(tabId, {
            action: "exportChat",
            options: options
          }, (res) => {
            clearInterval(wakeInterval);
            clearTimeout(timer);
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(res);
            }
          });
        });

        if (isCancelled) break;

        if (response && response.status === "success") {
          const data = response.data;

          if (isCancelled) break;

          logProgress(`Delegating file compile to offscreen document...`, "info");
          const offscreenResponse = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
              action: "zipAndDownload",
              data: response.data,
              options: options
            }, (res) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(res);
              }
            });
          });

          if (offscreenResponse && offscreenResponse.status === "success" && offscreenResponse.dataUrl) {
            const { dataUrl, filename } = offscreenResponse;
            logProgress(`Starting download of: ${filename}...`, "info");

            await new Promise((resolve, reject) => {
              chrome.downloads.download({
                url: dataUrl,
                filename: filename,
                saveAs: false
              }, (downloadId) => {
                if (chrome.runtime.lastError) {
                  return reject(new Error(chrome.runtime.lastError.message));
                }

                const listener = (delta) => {
                  if (delta.id === downloadId && delta.state && delta.state.current !== 'in_progress') {
                    chrome.downloads.onChanged.removeListener(listener);

                    if (delta.state.current === 'complete') {
                      logProgress(`Successfully downloaded: ${filename}`, "success");
                      resolve();
                    } else {
                      reject(new Error(`Download state: ${delta.state.current}`));
                    }
                  }
                };
                chrome.downloads.onChanged.addListener(listener);
              });
            });

          } else {
            const errMsg = (offscreenResponse && offscreenResponse.error) || "Offscreen packaging failed.";
            logProgress(`Export packaging failed for "${data.title}": ${errMsg}`, "error");
          }

        } else {
          const errMessage = (response && response.error) || "Scraper failed to return data.";
          logProgress(`Scraper error in "${tabTitle}": ${errMessage}`, "error");
        }
      } catch (err) {
        logProgress(`Failed to process tab: ${err.message || err}`, "error");
      } finally {
        currentExportTabId = null;
        // Move the tab back to its original window and close the temp one.
        if (exportWindowId) {
          try {
            await chrome.tabs.move(tabId, { windowId: origWindowId, index: origIndex });
          } catch (e) {}
          try {
            await chrome.windows.remove(exportWindowId);
          } catch (e) {}
          exportWindowId = null;
        }
      }
    }

    // Restore original active tab
    if (initialActiveTab && initialActiveTab.id) {
      try {
        await chrome.tabs.update(initialActiveTab.id, { active: true });
      } catch (e) {
        // Ignore if tab was closed
      }
    }

  } finally {
    // Always close offscreen document when finished to release resources
    await closeOffscreenDocument();
  }
}

