// Offscreen script for AI Chat Exporter Chrome Extension
// Handles DOM/window-level operations: fetches remote media and prepares the export's files as blob URLs for download.

// Establish a persistent heartbeat to keep the background service worker alive
let keepAlivePort;
let activePackaging = null;
const transfers = globalThis.AIChatExporterTransport?.receiver();

function packagingCancellationError() {
  const error = new Error("Export cancelled.");
  error.name = "AbortError";
  error.code = "EXPORT_CANCELLED";
  return error;
}

function throwIfPackagingCancelled(signal) {
  if (signal && signal.aborted) throw packagingCancellationError();
}

function isPackagingCancellation(error, signal) {
  return !!(
    signal && signal.aborted ||
    error && error.code === "EXPORT_CANCELLED" ||
    /export cancelled/i.test(String(error && error.message || error || ""))
  );
}

function raceWithPackagingCancellation(promise, signal) {
  throwIfPackagingCancelled(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      fn(value);
    };
    const onAbort = () => finish(reject, packagingCancellationError());
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      value => finish(resolve, value),
      error => finish(reject, error)
    );
  });
}

function connectKeepAlive() {
  keepAlivePort = chrome.runtime.connect({ name: 'keepAlive' });
  keepAlivePort.onDisconnect.addListener(() => {
    // Automatically reconnect if the SW restarts or port drops
    setTimeout(connectKeepAlive, 1000);
  });
}

connectKeepAlive();

// Ping every 20 seconds
setInterval(() => {
  if (keepAlivePort) {
    try {
      keepAlivePort.postMessage({ ping: true });
    } catch (err) {}
  }
}, 20000);

function logProgress(message, type = "info") {
  try {
    chrome.runtime.sendMessage({
      action: "forwardProgress",
      message: message,
      type: type
    }, () => {
      // Reading lastError silences the "Unchecked runtime.lastError" warning.
      void chrome.runtime.lastError;
    });
  } catch (e) {
    // Ignore
  }
}

// A Date shifted so its UTC fields read as the local wall clock, for the
// local date in export folder names.
function localDate(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000);
}

// Exports are kept together in Downloads/AI Chat Exports, one folder per app,
// instead of being scattered across Downloads.
const EXPORT_ROOT = "AI Chat Exports";
function appFolder(siteName) {
  const name = String(siteName || "");
  if (/^Claude/.test(name)) return "Claude";
  if (/^Google AI/.test(name)) return "Google AI";
  return name.replace(/[^\w .-]+/g, "").trim() || "Other";
}

// Build the markdown file contents

async function buildMarkdown(data, signal) {
  const nl = "\n";
  let md = '---' + nl;
  md += 'title: ' + JSON.stringify(data.title) + nl;
  md += 'source: ' + data.siteName + nl;
  // Where the chat lives, so it can be found and exported again later.
  if (data.sourceUrl) md += 'source_url: ' + JSON.stringify(data.sourceUrl) + nl;
  if (data.exporterVersion) md += 'exporter_version: ' + JSON.stringify(data.exporterVersion) + nl;
  md += 'exported_at: ' + data.date + nl;
  md += 'message_count: ' + data.messageCount + nl;
  if (data.exportScope) md += 'export_scope: ' + data.exportScope + nl;
  md += 'media_count: ' + data.savedMedia.length + nl;
  if (data.failedFetches && data.failedFetches.length) {
    md += 'media_failed: ' + data.failedFetches.length + nl;
  }
  if (data.history) md += 'history_status: ' + data.history.status + nl;
  if (data.history?.basis) md += 'history_basis: ' + JSON.stringify(data.history.basis) + nl;
  md += '---' + nl + nl;
  md += '# ' + data.title + nl + nl;

  for (let i = 0; i < data.messages.length; i++) {
    throwIfPackagingCancelled(signal);
    const m = data.messages[i];
    md += m.role + nl + nl + m.text + nl + nl;
    if (i < data.messages.length - 1) md += '---' + nl + nl;
    // Let a cancellation message run even while compiling a very long chat.
    if (i > 0 && i % 50 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  if (data.appendix) md += '---' + nl + nl + data.appendix.trim() + nl;

  return md;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "exportTransfer") {
    try { transfers.receive(request); sendResponse({ status: "ok" }); }
    catch (error) { sendResponse({ status: "error", error: error.message }); }
    return true;
  }
  if (request.action === "cancelOffscreenExport") {
    const matchesActiveRun = activePackaging && (
      request.runId === undefined || request.runId === activePackaging.runId
    );
    if (matchesActiveRun && !activePackaging.controller.signal.aborted) {
      activePackaging.controller.abort();
    }
    sendResponse({ status: matchesActiveRun ? "cancelling" : "idle" });
    return true;
  }

  if (request.action === "zipAndDownload") {
    if (activePackaging && !activePackaging.controller.signal.aborted) {
      activePackaging.controller.abort();
    }
    const packaging = {
      runId: request.runId,
      controller: new AbortController(),
    };
    activePackaging = packaging;

    Promise.resolve().then(() => {
      const data = request.transferId ? transfers.take(request.transferId) : request.data;
      if (data && /^https?:\/\//.test(request.sourceUrl || "")) data.sourceUrl = request.sourceUrl;
      return processSessionDownload(data, request.options, packaging.controller.signal);
    })
      .then(resData => {
        throwIfPackagingCancelled(packaging.controller.signal);
        sendResponse({
          status: "success",
          downloadUrl: resData.downloadUrl,
          filename: resData.filename,
          folder: resData.folder,
          files: resData.files
        });
      })
      .catch(err => {
        if (isPackagingCancellation(err, packaging.controller.signal)) {
          sendResponse({ status: "cancelled", error: "Export cancelled." });
          return;
        }
        console.error("Packaging error:", err);
        logProgress(`Failed to generate package: ${err.message}`, "error");
        sendResponse({ status: "error", error: err.message });
      })
      .finally(() => {
        if (activePackaging === packaging) activePackaging = null;
      });
    return true; // Keep message channel open for async response
  }

  if (request.action === "revokeBlobUrl") {
    try {
      URL.revokeObjectURL(request.url);
      sendResponse({ status: "success" });
    } catch (e) {
      sendResponse({ status: "error", error: e.message });
    }
    return true;
  }
});

async function processSessionDownload(data, options, signal) {
  options = options || {};
  throwIfPackagingCancelled(signal);
  logProgress(`Scraped ${data.messageCount} messages. Resolving remote media...`, "info");
  if (options.repliesOnly) {
    data.messages = data.messages.filter(message => !/^(?:##\s*)?(?:you|user|human|system|tool)(?:\s|$)/i.test(message.role || ''));
    data.messageCount = data.messages.length;
    data.appendix = '';
    const text = data.messages.map(message => message.text).join('\n');
    const referenced = item => text.split('media/' + item.filename).slice(1).some(rest => !rest || /^[)\s`"<>]/.test(rest));
    data.savedMedia = (data.savedMedia || []).filter(referenced);
    data.remoteQueue = (data.remoteQueue || []).filter(referenced);
    data.failedFetches = (data.failedFetches || []).filter(referenced);
    data.exportScope = 'ai-replies-only';
    logProgress(`Exporting ${data.messageCount} AI replies. Your messages are excluded.`, 'info');
  }

  // Fetch remote attachments in offscreen context to bypass CORS
  if (options.includeMedia && data.remoteQueue && data.remoteQueue.length > 0) {
    const REMOTE_MEDIA_CONCURRENCY = 4;
    const REMOTE_MEDIA_TIMEOUT_MS = 60 * 1000;
    const remoteResults = new Array(data.remoteQueue.length);
    let nextRemoteIndex = 0;

    const downloadRemoteAttachment = async (index) => {
      const item = data.remoteQueue[index];
      logProgress(
        `Downloading remote attachment ${index + 1}/${data.remoteQueue.length}: ${item.filename}...`,
        "info"
      );
      const controller = new AbortController();
      let timedOut = false;
      const onPackagingAbort = () => controller.abort();
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", onPackagingAbort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, REMOTE_MEDIA_TIMEOUT_MS);
      try {
        let blob;
        let lastError;
        for (const url of [...new Set([item.url, item.fallbackUrl].filter(Boolean))]) {
          try {
            const res = await fetch(url, { credentials: 'omit', signal: controller.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            blob = await res.blob();
            if (!blob.size) throw new Error("Empty attachment response");
            if (/^text\/html/i.test(blob.type) || (item.kind === "image" && /^text\//i.test(blob.type))) throw new Error("Attachment URL returned a web page instead of a file");
            break;
          } catch (error) {
            blob = null;
            lastError = error;
            if (controller.signal.aborted) throw error;
          }
        }
        if (!blob) throw lastError || new Error("No attachment URL");
        remoteResults[index] = {
          media: { filename: item.filename, blob, type: blob.type }
        };
      } catch (err) {
        if (signal.aborted) throw packagingCancellationError();
        console.warn("[Offscreen] Fetch failed for", item.filename, err);
        remoteResults[index] = {
          failure: {
            url: item.url,
            filename: item.filename,
            error: timedOut
              ? `Timed out after ${REMOTE_MEDIA_TIMEOUT_MS / 1000} seconds`
              : String(err.message || err),
          }
        };
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", onPackagingAbort);
      }
    };

    const worker = async () => {
      while (nextRemoteIndex < data.remoteQueue.length) {
        throwIfPackagingCancelled(signal);
        const index = nextRemoteIndex++;
        await downloadRemoteAttachment(index);
      }
    };
    await Promise.all(Array.from(
      {
        length: Math.min(
          REMOTE_MEDIA_CONCURRENCY,
          Math.max(1, data.remoteQueue.length)
        )
      },
      () => worker()
    ));
    throwIfPackagingCancelled(signal);

    for (const result of remoteResults) {
      if (result && result.media) data.savedMedia.push(result.media);
      if (result && result.failure) data.failedFetches.push(result.failure);
    }
  }

  if (options.includeMedia) {
    throwIfPackagingCancelled(signal);
    logProgress(
      `Media result: ${data.savedMedia.length} saved, ${data.failedFetches.length} failed.`,
      data.failedFetches.length ? "error" : "info"
    );
  }

  // Rewrite media references for failed fetches (local + remote) in markdown
  const failedFilenames = new Set(data.failedFetches.map(f => f.filename));
  const references = data.appendix ? [...data.messages, { text: data.appendix }] : data.messages;
  for (let messageIndex = 0; messageIndex < references.length; messageIndex++) {
    throwIfPackagingCancelled(signal);
    const m = references[messageIndex];
    if (!failedFilenames.size) break;
    data.failedFetches.forEach(f => {
      const needle = 'media/' + f.filename;
      const re = new RegExp('\\]\\(' + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\)', 'g');
      m.text = m.text.replace(re, `] [fetch failed](${f.url})`);
    });
    if (messageIndex > 0 && messageIndex % 100 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  if (globalThis.AIChatExporterCore) {
    const deduped = await globalThis.AIChatExporterCore.deduplicateImages(data.savedMedia, references, () => throwIfPackagingCancelled(signal));
    data.savedMedia = deduped.savedMedia;
    if (deduped.duplicates) logProgress(`Kept one copy of ${deduped.duplicates} exact duplicate image(s). All conversation references are preserved.`, "info");
  }
  if (data.appendix) data.appendix = references[references.length - 1].text;
  const markdownContent = await buildMarkdown(data, signal);
  throwIfPackagingCancelled(signal);
  const safeTitle = data.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || "chat-export";
  const stamp = localDate().toISOString().slice(0, 10);

  if (data.savedMedia && data.savedMedia.length > 0) {
    // A chat with attachments is saved as a folder, its Markdown plus media/,
    // so it opens straight away in Finder instead of arriving as a ZIP. The
    // background worker writes each file into the folder.
    logProgress(`Preparing the chat folder: ${data.savedMedia.length + 1} files...`, "info");
    const files = [{
      path: `${safeTitle}.md`,
      url: URL.createObjectURL(new Blob([markdownContent], { type: "text/markdown;charset=utf-8" })),
    }];
    for (let mediaIndex = 0; mediaIndex < data.savedMedia.length; mediaIndex++) {
      throwIfPackagingCancelled(signal);
      const media = data.savedMedia[mediaIndex];
      const blob = media.blob instanceof Blob
        ? media.blob
        : await raceWithPackagingCancellation(fetch(`data:${media.type || "application/octet-stream"};base64,${media.base64}`).then(res => res.blob()), signal);
      files.push({ path: `media/${media.filename}`, url: URL.createObjectURL(blob) });
      if (mediaIndex > 0 && mediaIndex % 25 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    throwIfPackagingCancelled(signal);
    return { folder: `${EXPORT_ROOT}/${appFolder(data.siteName)}/${safeTitle}-${stamp}`, files };

  } else {
    // No media, save as pure Markdown through an object URL too. Keeping the
    // file body out of extension messaging prevents large text-only chats from
    // hitting message serialization limits.
    throwIfPackagingCancelled(signal);
    const mdBlob = new Blob([markdownContent], { type: "text/markdown;charset=utf-8" });
    const downloadUrl = URL.createObjectURL(mdBlob);
    logProgress(`Generated markdown file.`, "info");

    return { downloadUrl, filename: `${EXPORT_ROOT}/${appFolder(data.siteName)}/${safeTitle}.md` };
  }
}
