// Background Service Worker for AI Chat Exporter Chrome Extension
// Coordinates sequential tab activation, scripting, and delegates zipping/downloading to an offscreen document.

let isCancelled = false;
let isExporting = false;
let logsList = [];
const originalTabPositions = new Map(); // tabId -> { windowId, index }

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

  if (request.action === "popOutTab") {
    if (sender && sender.tab && sender.tab.id) {
      popOutTab(sender.tab.id)
        .then(() => sendResponse({ status: "success" }))
        .catch((err) => sendResponse({ status: "error", error: err.message || String(err) }));
      return true; // Keep response channel open for async response
    }
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

      try {
        const tabObj = await chrome.tabs.get(tabId);
        const tabTitle = tabObj ? tabObj.title : `Tab ${tabId}`;

        logProgress(`Activating tab: "${tabTitle}"...`, "info");
        await chrome.tabs.update(tabId, { active: true });
        // Give layout engine time to refresh active state
        await new Promise(r => setTimeout(r, 600));

        if (isCancelled) break;

        logProgress(`Injecting scraper script...`, "info");
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ["contentScript.js"]
        });

        if (isCancelled) break;

        logProgress(`Executing scraper on webpage...`, "info");
        const response = await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(tabId, {
            action: "exportChat",
            options: options
          }, (res) => {
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
        await restoreTab(tabId);
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

async function popOutTab(tabId) {
  try {
    const tabObj = await chrome.tabs.get(tabId);
    if (!tabObj) return;

    // Check if the tab is already popped out
    if (originalTabPositions.has(tabId)) return;

    // Save its original position
    originalTabPositions.set(tabId, {
      windowId: tabObj.windowId,
      index: tabObj.index
    });

    logProgress(`Popping out tab "${tabObj.title}" to background window to keep layout/IntersectionObserver active...`, "info");

    // Move to a new background window (focused: false)
    await chrome.windows.create({
      tabId: tabId,
      focused: false,
      type: "normal"
    });
  } catch (err) {
    console.error("Failed to pop out tab:", err);
  }
}

async function restoreTab(tabId) {
  try {
    const pos = originalTabPositions.get(tabId);
    if (pos) {
      originalTabPositions.delete(tabId);
      
      // Check if original window still exists
      let windowExists = false;
      try {
        const win = await chrome.windows.get(pos.windowId);
        windowExists = !!win;
      } catch (e) {
        windowExists = false;
      }

      if (windowExists) {
        logProgress("Restoring tab to its original window...", "info");
        await chrome.tabs.move(tabId, {
          windowId: pos.windowId,
          index: pos.index
        });
      } else {
        // If original window was closed, create a new window for it
        logProgress("Original window closed. Creating a new window for this tab...", "info");
        await chrome.windows.create({ tabId: tabId, focused: true });
      }
    }
  } catch (err) {
    console.error("Failed to restore tab:", err);
  }
}
