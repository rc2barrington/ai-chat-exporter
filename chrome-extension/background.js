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


// NOTE: there is deliberately no web-page-triggered export path. An earlier
// "testExport" hook, reachable from any page on the supported sites via
// externally_connectable, let a script start an export and write a file to
// disk with no user interaction. Exports must originate from the popup.

async function runBatchExport(targetTabIds, options) {
  logProgress(`Starting batch export of ${targetTabIds.length} chat(s) in background...`, "info");

  try {
    // Keep service worker alive by opening the offscreen document immediately
    await setupOffscreenDocument('offscreen.html');

    // Remember what the user was looking at so it can be put back. A service
    // worker has no "current window", so tabs.query({currentWindow:true})
    // returns nothing useful here; ask for the last focused window instead.
    let initialWindowId = null;
    try {
      const win = await chrome.windows.getLastFocused();
      if (win) initialWindowId = win.id;
    } catch (e) {}

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

        // Moving the only tab out of a window destroys that window, which
        // then makes the restore fail and the cleanup close the user's tab.
        // In that case the tab already has a window to itself, so use it.
        let sourceTabCount = 0;
        try {
          const srcWin = await chrome.windows.get(origWindowId, { populate: true });
          sourceTabCount = (srcWin && srcWin.tabs) ? srcWin.tabs.length : 0;
        } catch (e) {}

        if (sourceTabCount === 1) {
          try {
            await chrome.windows.update(origWindowId, { focused: true });
            await chrome.tabs.update(tabId, { active: true });
            logProgress(`Exporting "${tabTitle}" in its existing window.`, "info");
          } catch (e) {
            logProgress(`Could not focus the chat window; exporting in place.`, "info");
          }
        } else {
          try {
            // focused:true matters with more than one window open. An
            // unfocused window opens behind the others and Chrome treats a
            // fully occluded window as hidden, which throttles the renderer
            // and stops Gemini's lazy-loader firing at all. The originally
            // focused window is restored once the batch finishes.
            const win = await chrome.windows.create({
              tabId: tabId,
              focused: true,
              state: "normal"
            });
            exportWindowId = win.id;
            logProgress(`Opened export window for "${tabTitle}".`, "info");
          } catch (e) {
            logProgress(`Could not open export window, exporting in place.`, "info");
            try {
              await chrome.windows.update(origWindowId, { focused: true });
              await chrome.tabs.update(tabId, { active: true });
            } catch (e2) {}
          }
        }
        await new Promise(r => setTimeout(r, 600));

        // Surface the tab's own view of whether it is visible. If this ever
        // reports "hidden" the renderer is throttled and a stalled export is
        // explained rather than mysterious.
        try {
          const [vis] = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: () => document.visibilityState,
          });
          if (vis && vis.result && vis.result !== "visible") {
            logProgress(`Warning: tab reports visibilityState "${vis.result}" — Chrome may throttle it.`, "error");
          }
        } catch (e) {}

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
        // Move the tab back to its original window, then close the temp one.
        // The removal is deliberately conditional: if the move failed (the
        // original window is gone, say) the tab is still inside the export
        // window, and removing it would close the user's chat tab outright.
        if (exportWindowId) {
          let movedBack = false;
          try {
            await chrome.tabs.move(tabId, { windowId: origWindowId, index: origIndex });
            movedBack = true;
          } catch (e) {
            logProgress(`Could not return the tab to its original window; leaving it open.`, "info");
          }

          if (movedBack) {
            try {
              const leftover = await chrome.windows.get(exportWindowId, { populate: true });
              if (!leftover || !leftover.tabs || leftover.tabs.length === 0) {
                await chrome.windows.remove(exportWindowId);
              }
            } catch (e) {
              // Window already gone.
            }
          }
          exportWindowId = null;
        }
      }
    }

    // Put the user back on the window they were using.
    if (initialWindowId !== null) {
      try {
        await chrome.windows.update(initialWindowId, { focused: true });
      } catch (e) {
        // Window was closed while exporting.
      }
    }

  } finally {
    // Always close offscreen document when finished to release resources
    await closeOffscreenDocument();
  }
}

