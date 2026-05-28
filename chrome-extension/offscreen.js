// Offscreen script for AI Chat Exporter Chrome Extension
// Handles DOM/window-level operations: fetches remote media, zips with JSZip, and triggers downloads via blob URLs.

// Establish a persistent heartbeat to keep the background service worker alive
let keepAlivePort;

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

// Build the markdown file contents
function buildMarkdown(data) {
  const nl = "\n";
  let md = '---' + nl;
  md += 'title: ' + JSON.stringify(data.title) + nl;
  md += 'source: ' + data.siteName + nl;
  md += 'exported_at: ' + data.date + nl;
  md += 'message_count: ' + data.messageCount + nl;
  md += 'media_count: ' + (data.savedMedia.length + (data.remoteQueue ? data.remoteQueue.length : 0)) + nl;
  if (data.failedFetches && data.failedFetches.length) {
    md += 'media_failed: ' + data.failedFetches.length + nl;
  }
  md += '---' + nl + nl;
  md += '# ' + data.title + nl + nl;

  data.messages.forEach((m, i) => {
    md += m.role + nl + nl + m.text + nl + nl;
    if (i < data.messages.length - 1) md += '---' + nl + nl;
  });

  return md;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "zipAndDownload") {
    processSessionDownload(request.data, request.options)
      .then(resData => {
        sendResponse({ status: "success", dataUrl: resData.dataUrl, filename: resData.filename });
      })
      .catch(err => {
        console.error("Zip error:", err);
        logProgress(`Failed to generate package: ${err.message}`, "error");
        sendResponse({ status: "error", error: err.message });
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

async function processSessionDownload(data, options) {
  logProgress(`Scraped ${data.messageCount} messages. Resolving remote media...`, "info");

  // Fetch remote attachments in offscreen context to bypass CORS
  if (options.includeMedia && data.remoteQueue && data.remoteQueue.length > 0) {
    for (let i = 0; i < data.remoteQueue.length; i++) {
      const item = data.remoteQueue[i];
      logProgress(`Downloading remote attachment ${i + 1}/${data.remoteQueue.length}: ${item.filename}...`, "info");
      try {
        const res = await fetch(item.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        
        // Convert blob to base64 for uniform representation inside JSZip
        const base64Data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        data.savedMedia.push({ filename: item.filename, base64: base64Data, type: blob.type });
      } catch (err) {
        console.warn("[Offscreen] Fetch failed for", item.url, err);
        data.failedFetches.push({ url: item.url, filename: item.filename, error: String(err.message || err) });
      }
    }
  }

  // Rewrite media references for failed fetches (local + remote) in markdown
  const failedFilenames = new Set(data.failedFetches.map(f => f.filename));
  data.messages.forEach(m => {
    if (!failedFilenames.size) return;
    data.failedFetches.forEach(f => {
      const needle = 'media/' + f.filename;
      const re = new RegExp('\\]\\(' + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\)', 'g');
      m.text = m.text.replace(re, `] [fetch failed](${f.url})`);
    });
  });

  const markdownContent = buildMarkdown(data);
  const safeTitle = data.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || "chat-export";
  const stamp = new Date().toISOString().slice(0, 10);

  if (data.savedMedia && data.savedMedia.length > 0) {
    logProgress(`Compiling zip package...`, "info");
    const zip = new JSZip();
    zip.file("conversation.md", markdownContent);

    const mediaFolder = zip.folder("media");
    data.savedMedia.forEach(media => {
      mediaFolder.file(media.filename, media.base64, { base64: true });
    });

    if (data.failedFetches && data.failedFetches.length > 0) {
      const report = data.failedFetches.map(f => `${f.filename}\t${f.url}\t${f.error}`).join("\n");
      zip.file("media-fetch-errors.tsv", "filename\turl\terror\n" + report);
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(zipBlob);
    });
    logProgress(`Generated zip file (${(zipBlob.size / 1024 / 1024).toFixed(2)} MB).`, "info");

    return { dataUrl: dataUrl, filename: `${safeTitle}-${stamp}.zip` };

  } else {
    // No media, save as pure Markdown via base64 data URL
    const mdBlob = new Blob([markdownContent], { type: "text/markdown;charset=utf-8" });
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(mdBlob);
    });
    logProgress(`Generated markdown file.`, "info");

    return { dataUrl: dataUrl, filename: `${safeTitle}.md` };
  }
}
