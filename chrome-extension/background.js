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

        // The export never takes focus. Making the tab the active one inside
        // its own window is enough for it to run; stealing the foreground is
        // not acceptable while the user is working elsewhere.
        if (sourceTabCount === 1) {
          try {
            await chrome.tabs.update(tabId, { active: true });
            logProgress(`Exporting "${tabTitle}" in its existing window.`, "info");
          } catch (e) {
            logProgress(`Could not activate the chat tab; exporting in place.`, "info");
          }
        } else {
          try {
            const win = await chrome.windows.create({
              tabId: tabId,
              focused: false,
              state: "normal"
            });
            exportWindowId = win.id;
            logProgress(`Opened export window for "${tabTitle}" (unfocused).`, "info");
          } catch (e) {
            logProgress(`Could not open export window, exporting in place.`, "info");
            try {
              await chrome.tabs.update(tabId, { active: true });
            } catch (e2) {}
          }
        }
        await new Promise(r => setTimeout(r, 600));

        // An unfocused window that ends up fully covered is marked occluded by
        // Chrome. The page is then reported hidden, its timers are throttled to
        // roughly once a second, and requestAnimationFrame stops firing
        // altogether.
        //
        // The scrape itself copes: sleep() advances on __exportWake pulses
        // injected from here, and the loader is triggered by a synthetic scroll
        // event, both of which work while hidden. What does not cope is the
        // page's own rendering. Gemini's chat history is an Angular virtual
        // scroller, so the scroll handler schedules its work through rAF; with
        // rAF parked, the batch is fetched but never rendered and the message
        // count never moves. That is the difference between one window (visible,
        // fine) and several (occluded, stuck).
        //
        // So: report the page as visible, and re-drive rAF from the same
        // unthrottled pulse that drives sleep(). Callbacks are queued and
        // flushed on each __exportWake -- DOM events cross worlds, so the pulse
        // dispatched from the isolated world reaches this MAIN-world listener.
        // The native rAF is still called too, so nothing changes while visible.
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tabId },
            world: "MAIN",
            func: () => {
              if (window.__exportVisibilityPatched) return;
              window.__exportVisibilityPatched = true;
              try {
                Object.defineProperty(document, "visibilityState", {
                  configurable: true,
                  get: () => "visible",
                });
                Object.defineProperty(document, "hidden", {
                  configurable: true,
                  get: () => false,
                });
                document.addEventListener(
                  "visibilitychange",
                  (e) => { e.stopImmediatePropagation(); },
                  true
                );
              } catch (err) {}

              try {
                const nativeRaf = window.requestAnimationFrame.bind(window);
                let queue = [];
                let nextId = 1 << 20; // keep clear of native ids
                const flush = () => {
                  if (!queue.length) return;
                  const batch = queue;
                  queue = [];
                  const now = performance.now();
                  for (const entry of batch) {
                    try { entry.cb(now); } catch (err) {}
                  }
                };
                window.requestAnimationFrame = function (cb) {
                  const id = nextId++;
                  queue.push({ id: id, cb: cb });
                  try { nativeRaf(flush); } catch (err) {}
                  return id;
                };
                window.cancelAnimationFrame = function (id) {
                  queue = queue.filter((e) => e.id !== id);
                };
                document.addEventListener("__exportWake", flush);
              } catch (err) {}
            },
          });
        } catch (e) {}

        // Read the true visibility from the isolated world: property
        // redefinitions in MAIN are not shared across worlds, so this still
        // sees what Chrome actually thinks rather than the patched value.
        // Occluded is expected and handled -- log it as information so a slow
        // export is explainable, not as a failure.
        try {
          const [vis] = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: () => document.visibilityState,
          });
          if (vis && vis.result && vis.result !== "visible") {
            logProgress(`Tab is occluded (visibilityState "${vis.result}"); driving it from the background.`, "info");
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

    // Focus is deliberately not touched at the end either. The export never
    // took it, so "restoring" it would only yank the user out of whatever
    // window they moved to while the export was running.

  } finally {
    // Always close offscreen document when finished to release resources
    await closeOffscreenDocument();
  }
}

