// Content script for AI Chat Exporter Chrome Extension
// Scrapes the chat page, scrolls to load all content, fetches media, and returns the data.

(async function() {
  if (window.hasExporterListener) {
    // Already loaded, don't re-register listener
    return;
  }
  window.hasExporterListener = true;

  let keepAlivePort;
  let keepAliveInterval;

  function startKeepAlive() {
    if (keepAlivePort) return;
    try {
      keepAlivePort = chrome.runtime.connect({ name: 'keepAlive' });
      keepAlivePort.onDisconnect.addListener(() => {
        keepAlivePort = null;
      });
      
      // Ping every 20 seconds to reset the background script's idle timer
      keepAliveInterval = setInterval(() => {
        if (keepAlivePort) {
          try {
            keepAlivePort.postMessage({ ping: true });
          } catch (err) {}
        } else {
          startKeepAlive(); // Reconnect if disconnected
        }
      }, 20000);
    } catch (e) {
      // Ignore connection failures when the extension gets reloaded/invalidated
    }
  }

  function stopKeepAlive() {
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }
    if (keepAlivePort) {
      keepAlivePort.disconnect();
      keepAlivePort = null;
    }
  }

  // ----- Pop-out-on-hide -----
  // When the export tab is backgrounded, browsers throttle timers and pause
  // virtualization/IntersectionObserver, which stalls scrolling. We move the tab to
  // its own (unfocused) window so document.hidden becomes false and layout stays live.
  //
  // Previously this only fired from inside the scroll loops (via ensureVisible), so it
  // depended on the tab being hidden at the exact moment one of those awaits ran. Sites
  // with short/fast scroll phases (e.g. Gemini) could get backgrounded between phases —
  // or during the media-fetch loop, which never calls ensureVisible — and never pop out.
  // Listening on visibilitychange makes the pop-out fire the instant the user clicks away,
  // regardless of which phase the export is in.
  let popOutRequested = false;

  function requestPopOut() {
    if (popOutRequested || !document.hidden) return;
    popOutRequested = true;
    try {
      chrome.runtime.sendMessage({ action: "popOutTab" }, () => {
        void chrome.runtime.lastError;
      });
    } catch (e) {
      // Ignore if context is invalidated
    }
  }

  function onVisibilityChange() {
    if (document.hidden) requestPopOut();
  }

  // Listen for the run message from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request) return;
    if (request.action === "exportChat") {
      startKeepAlive();
      runExport(request.options)
        .then(result => {
          stopKeepAlive();
          document.removeEventListener('visibilitychange', onVisibilityChange);
          sendResponse({ status: "success", data: result });
        })
        .catch(err => {
          stopKeepAlive();
          document.removeEventListener('visibilitychange', onVisibilityChange);
          sendResponse({ status: "error", error: err.message || String(err) });
        });
      return true; // Keep message channel open for async response
    }
  });

  // Helper to send progress updates back to popup
  function updateProgress(message) {
    try {
      chrome.runtime.sendMessage({ action: "forwardProgress", message: message }, () => {
        // Reading lastError silences the "Unchecked runtime.lastError" warning in background.
        void chrome.runtime.lastError;
      });
    } catch (e) {
      // Ignore if context is invalidated
    }
  }

  async function runExport(options) {
    const isChatGPT = !!document.querySelector('[data-message-author-role]');
    const isClaude = !!document.querySelector('[data-testid="user-message"]');
    const isGemini = !!document.querySelector('user-query');

    if (!isChatGPT && !isClaude && !isGemini) {
      throw new Error("No messages found. Open this on a Claude.ai, ChatGPT, or Gemini conversation.");
    }

    const siteName = isChatGPT ? "ChatGPT" : (isClaude ? "Claude" : "Gemini");
    updateProgress(`Detected ${siteName} tab. Scanning scroll container...`);

    // Pop out the moment the tab is backgrounded, for the whole export — not just while
    // a scroll loop happens to be awaiting. Covers gaps between phases and the media-fetch
    // loop, where Gemini exports were previously getting stuck without popping out.
    popOutRequested = false;
    document.addEventListener('visibilitychange', onVisibilityChange);
    requestPopOut(); // in case the tab is already hidden when the export starts

    // ----- Find scroll container, force-load all turns -----
    let firstMsg;
    if (isChatGPT) firstMsg = document.querySelector('[data-message-author-role]');
    else if (isClaude) firstMsg = document.querySelector('[data-testid="user-message"]');
    else firstMsg = document.querySelector('user-query');

    let scrollEl = document.documentElement;
    let p = firstMsg;
    while (p && p.parentElement) {
      p = p.parentElement;
      const style = window.getComputedStyle(p);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && p.scrollHeight > p.clientHeight + 100) {
        scrollEl = p;
        break;
      }
    }

    function getScrollableElements() {
      const els = new Set([document.documentElement, document.body]);
      if (scrollEl) els.add(scrollEl);
      document.querySelectorAll('.overflow-y-auto, [style*="overflow-y: auto"], [style*="overflow: auto"], main').forEach(e => els.add(e));
      return Array.from(els);
    }

    function scrollTopTo(y) {
      window.scrollTo(0, y);
      getScrollableElements().forEach(el => {
        try { el.scrollTop = y; } catch(e) {}
      });
    }

    function scrollBy(dy) {
      window.scrollBy(0, dy);
      getScrollableElements().forEach(el => {
        try { el.scrollTop += dy; } catch(e) {}
      });
    }

    function currentTop() {
      let maxTop = window.scrollY || 0;
      getScrollableElements().forEach(el => {
        if (el && el.scrollTop > maxTop) {
          maxTop = el.scrollTop;
        }
      });
      return maxTop;
    }

    function clientH() {
      let h = window.innerHeight;
      if (scrollEl && scrollEl !== document.documentElement && scrollEl.clientHeight > 0) {
        h = scrollEl.clientHeight;
      }
      return h;
    }

    function getMaxScrollHeight() {
      let maxH = document.documentElement.scrollHeight || 0;
      getScrollableElements().forEach(el => {
        if (el && el.scrollHeight > maxH) maxH = el.scrollHeight;
      });
      return maxH;
    }

    async function ensureVisible() {
      if (!document.hidden) return;

      updateProgress("Export tab backgrounded. Popping out tab to a temporary background window to keep layout and scrolling active...");
      requestPopOut(); // no-op if the visibilitychange listener already requested it

      // Wait for Chrome to transfer the window and activate layout rendering (hidden becomes false)
      let checks = 0;
      while (document.hidden && checks < 15) {
        await new Promise(r => setTimeout(r, 400));
        checks++;
      }
    }

    updateProgress("Loading full conversation history...");

    // 1. Scroll UP repeatedly to trigger all lazy-loaded history
    let upAttempts = 0;
    let noNewContentCount = 0;
    let lastScrollHeight = getMaxScrollHeight();
    let lastTopPos = currentTop();

    while (upAttempts < 80) {
      await ensureVisible();
      scrollTopTo(0);
      
      // If the tab is hidden, Chrome throttles setTimeout, so we wait longer to match throttle rate
      const delay = document.hidden ? 1200 : 400;
      await new Promise(r => setTimeout(r, delay));
      
      const currentH = getMaxScrollHeight();
      const currentTopPos = currentTop();
      
      if (currentTopPos === 0) {
        updateProgress("Reached the top of the conversation.");
        break;
      }
      
      if (currentH === lastScrollHeight && currentTopPos === lastTopPos) {
        noNewContentCount++;
        const maxNoProgress = document.hidden ? 15 : 5;
        if (noNewContentCount > maxNoProgress) {
          updateProgress("Fully scrolled up (no new history loaded).");
          break; 
        }
      } else {
        noNewContentCount = 0;
      }
      
      lastScrollHeight = currentH;
      lastTopPos = currentTopPos;
      upAttempts++;
      if (upAttempts % 5 === 0) {
        updateProgress(`Scrolling UP to load history (step ${upAttempts})...`);
      }
    }

    // 2. Scroll DOWN gradually to ensure all virtualized nodes render
    updateProgress("Scrolling DOWN to render all messages...");
    scrollTopTo(0);
    await new Promise(r => setTimeout(r, document.hidden ? 1000 : 500));

    let lastTop = -1;
    let downAttempts = 0;
    let noProgressCount = 0;
    
    while (downAttempts < 120) {
      await ensureVisible();
      const currentH = getMaxScrollHeight();
      const currTop = currentTop();
      const viewH = clientH();
      
      // If we are already at or extremely close to the bottom, we can stop scrolling
      if (currTop + viewH >= currentH - 100) {
        break;
      }
      
      scrollBy(viewH - 50);
      
      const delay = document.hidden ? 1000 : 250;
      await new Promise(r => setTimeout(r, delay));
      
      const top = currentTop();
      if (top === lastTop) {
        noProgressCount++;
        const maxNoProgress = document.hidden ? 15 : 6;
        if (noProgressCount > maxNoProgress) {
          break;
        }
      } else {
        noProgressCount = 0;
      }
      
      lastTop = top;
      downAttempts++;
      if (downAttempts % 5 === 0) {
        updateProgress(`Scrolling DOWN to render messages (step ${downAttempts})...`);
      }
    }
    
    scrollTopTo(0);
    await new Promise(r => setTimeout(r, document.hidden ? 1000 : 500));

    // ----- Media Bookkeeping -----
    const mediaQueue = [];  // [{ url, filename, kind, alt }]
    const urlToFilename = new Map();
    let mediaCounter = 0;

    function enqueueMedia(rawUrl, kind, alt) {
      if (!options.includeMedia) return null;
      if (!rawUrl) return null;
      let absolute;
      try { absolute = new URL(rawUrl, location.href).href; } catch (e) { return null; }
      if (urlToFilename.has(absolute)) return urlToFilename.get(absolute);

      const filename = generateMediaFilename(absolute, kind, mediaCounter++);
      urlToFilename.set(absolute, filename);
      const isLocal = absolute.startsWith('blob:') || absolute.startsWith('data:');
      mediaQueue.push({ url: absolute, filename: filename, kind: kind, alt: alt || "", isLocal: isLocal });
      return filename;
    }

    function generateMediaFilename(url, kind, idx) {
      let basePart = "";
      try {
        const u = new URL(url);
        const lastSeg = u.pathname.split('/').filter(Boolean).pop() || "";
        basePart = lastSeg.split('?')[0];
      } catch (e) { basePart = ""; }
      basePart = basePart.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '');
      const hasExt = /\.[a-z0-9]{1,5}$/i.test(basePart);
      if (basePart && hasExt) {
        return String(idx).padStart(3, '0') + '-' + basePart.toLowerCase();
      }
      const prefix = kind === 'image' ? 'image'
                   : kind === 'video' ? 'video'
                   : kind === 'audio' ? 'audio'
                   : 'file';
      const ext = kind === 'image' ? '.png'
                : kind === 'video' ? '.mp4'
                : kind === 'audio' ? '.mp3'
                : '.bin';
      return String(idx).padStart(3, '0') + '-' + prefix + ext;
    }

    function extFromMime(mime) {
      if (!mime) return null;
      const map = {
        'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
        'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/avif': '.avif',
        'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
        'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg', 'audio/webm': '.weba',
        'application/pdf': '.pdf', 'application/json': '.json',
        'text/plain': '.txt', 'text/csv': '.csv', 'text/markdown': '.md',
        'application/zip': '.zip'
      };
      return map[mime.split(';')[0].trim()] || null;
    }

    // ----- Walk DOM to generate Markdown -----
    function nodeToMarkdown(node) {
      if (!node) return "";
      let out = "";
      node.childNodes.forEach(child => {
        if (child.nodeType === 3) { out += child.nodeValue; return; }
        if (child.nodeType !== 1) return;
        const tag = child.tagName.toLowerCase();

        // ----- Media capture -----
        if (tag === 'img') {
          const src = child.currentSrc || child.src || child.getAttribute('src');
          const alt = (child.getAttribute('alt') || '').trim();
          const fname = enqueueMedia(src, 'image', alt);
          const altText = alt ? ` - "${alt}"` : '';
          if (fname) {
            out += '\n\n![' + alt + '](media/' + fname + ')\n*(Uploaded Image: `media/' + fname + '`' + altText + ')*\n\n';
          } else {
            out += '\n\n![' + alt + '](' + src + ')\n*(Uploaded Image: <' + src + '>' + altText + ')*\n\n';
          }
          return;
        }
        if (tag === 'video') {
          let vSrc = child.currentSrc || child.src || child.getAttribute('src');
          if (!vSrc) {
            const srcEl = child.querySelector('source');
            if (srcEl) vSrc = srcEl.src || srcEl.getAttribute('src');
          }
          const fname2 = enqueueMedia(vSrc, 'video');
          if (fname2) {
            out += '\n\n[🎬 video: media/' + fname2 + '](media/' + fname2 + ')\n*(Uploaded Video: `media/' + fname2 + '`)*\n\n';
          } else if (vSrc) {
            out += '\n\n[🎬 video](' + vSrc + ')\n*(Uploaded Video: <' + vSrc + '>)*\n\n';
          }
          return;
        }
        if (tag === 'audio') {
          let aSrc = child.currentSrc || child.src || child.getAttribute('src');
          if (!aSrc) {
            const srcEl2 = child.querySelector('source');
            if (srcEl2) aSrc = srcEl2.src || srcEl2.getAttribute('src');
          }
          const fname3 = enqueueMedia(aSrc, 'audio');
          if (fname3) {
            out += '\n\n[🔊 audio: media/' + fname3 + '](media/' + fname3 + ')\n*(Uploaded Audio: `media/' + fname3 + '`)*\n\n';
          } else if (aSrc) {
            out += '\n\n[🔊 audio](' + aSrc + ')\n*(Uploaded Audio: <' + aSrc + '>)*\n\n';
          }
          return;
        }
        // Link attachments
        if (tag === 'a') {
          const href = child.getAttribute('href') || '';
          const downloadable = child.hasAttribute('download')
            || /\.(pdf|csv|tsv|json|zip|txt|md|docx?|xlsx?|pptx?|py|js|ts|tsx|jsx|html|css|wav|mp3|mp4|mov|webm)(\?.*)?$/i.test(href);
          if (downloadable && href && href !== '#') {
            const label = (child.innerText || child.getAttribute('aria-label') || 'attachment').trim();
            const fname4 = enqueueMedia(href, 'attachment', label);
            if (fname4) {
              out += '[📎 ' + (label || fname4) + '](media/' + fname4 + ') *(Uploaded File: `media/' + fname4 + '`)*';
              return;
            }
          }
          if (href && href !== '#') {
            out += '[' + (child.innerText || href) + '](' + href + ')';
            return;
          }
        }

        // ----- Text formatting -----
        if (tag === 'pre') {
          const codeEl = child.querySelector('code') || child;
          const classNames = (codeEl.className || '') + ' ' + (child.className || '');
          const langMatch = classNames.match(/(?:language-|lang-|hljs language-)([a-z0-9+#-]+)/i);
          const lang = langMatch ? langMatch[1] : '';
          const codeText = codeEl.innerText.replace(/\n+$/, '');
          out += '\n\n```' + lang + '\n' + codeText + '\n```\n\n';
          return;
        }
        if (tag === 'code' && child.parentElement && child.parentElement.tagName.toLowerCase() !== 'pre') {
          out += '`' + child.innerText + '`';
          return;
        }
        if (tag === 'br') { out += '\n'; return; }
        if (tag === 'p' || tag === 'div') { out += nodeToMarkdown(child) + '\n\n'; return; }
        if (tag === 'li') { out += '- ' + nodeToMarkdown(child) + '\n'; return; }
        if (tag === 'strong' || tag === 'b') { out += '**' + nodeToMarkdown(child) + '**'; return; }
        if (tag === 'em' || tag === 'i') { out += '*' + nodeToMarkdown(child) + '*'; return; }
        if (/^h[1-6]$/.test(tag)) {
          const n = parseInt(tag.slice(1), 10);
          out += '\n\n' + '#'.repeat(n) + ' ' + nodeToMarkdown(child) + '\n\n';
          return;
        }
        out += nodeToMarkdown(child);
      });
      return out;
    }

    function cleanText(s) { return s.replace(/\n{3,}/g, '\n\n').trim(); }

    // ----- Capture Pass -----
    const seen = new Set();
    const ordered = [];
    lastTop = -1;

    function captureClaude() {
      // User turns
      document.querySelectorAll('[data-testid="user-message"]').forEach(el => {
        if (seen.has(el)) return;
        seen.add(el);
        ordered.push({ el: el, role: '## You', text: cleanText(nodeToMarkdown(el)) });
      });
      // Assistant turns (filtering out tool call internals if not desired)
      const main = document.querySelector('main') || document.body;
      const blocks = main.querySelectorAll('[data-test-render-count], .font-claude-message, [class*="claude-message"]');
      blocks.forEach(el => {
        if (seen.has(el)) return;
        if (el.closest('[data-testid="user-message"]')) return;
        seen.add(el);
        const txt = cleanText(nodeToMarkdown(el));
        if (txt) ordered.push({ el: el, role: '## Claude', text: txt });
      });
    }

    function captureChatGPT() {
      document.querySelectorAll('[data-message-author-role]').forEach(el => {
        if (seen.has(el)) return;
        seen.add(el);
        const roleAttr = el.getAttribute('data-message-author-role');
        const role = roleAttr === 'user' ? '## You' : '## ChatGPT';
        const txt = cleanText(nodeToMarkdown(el));
        if (txt) ordered.push({ el: el, role: role, text: txt });
      });
    }

    function captureGemini() {
      document.querySelectorAll('user-query, model-response').forEach(el => {
        if (seen.has(el)) return;
        seen.add(el);
        const role = el.tagName.toLowerCase() === 'user-query' ? '## You' : '## Gemini';
        const txt = cleanText(nodeToMarkdown(el));
        if (txt) ordered.push({ el: el, role: role, text: txt });
      });
    }

    updateProgress("Scraping conversation structure...");
    let scrapeNoProgressCount = 0;
    lastTop = -1;
    
    while (true) {
      await ensureVisible();
      if (isClaude) captureClaude();
      else if (isChatGPT) captureChatGPT();
      else captureGemini();

      const currentH = getMaxScrollHeight();
      const currTop = currentTop();
      const viewH = clientH();
      
      // If we are at the bottom, run one final capture and exit
      if (currTop + viewH >= currentH - 100) {
        if (isClaude) captureClaude();
        else if (isChatGPT) captureChatGPT();
        else captureGemini();
        break;
      }

      scrollBy(viewH - 50);
      
      const delay = document.hidden ? 1000 : 250;
      await new Promise(r => setTimeout(r, delay));
      
      const top = currentTop();
      if (top === lastTop) {
        scrapeNoProgressCount++;
        const maxNoProgress = document.hidden ? 15 : 6;
        if (scrapeNoProgressCount > maxNoProgress) {
          break;
        }
      } else {
        scrapeNoProgressCount = 0;
      }
      lastTop = top;
    }
    // Final check
    if (isClaude) captureClaude();
    else if (isChatGPT) captureChatGPT();
    else captureGemini();

    if (!ordered.length) {
      throw new Error('No messages could be parsed in the DOM.');
    }

    // Sort chronologically based on layout position
    ordered.sort((a, b) => {
      if (a.el === b.el) return 0;
      const pos = a.el.compareDocumentPosition(b.el);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    updateProgress(`Parsed ${ordered.length} messages. Found ${mediaQueue.length} media attachments.`);

    // ----- Fetch local media (Sequential & Base64 transfer) -----
    const failedFetches = [];
    const savedMedia = []; // [{ filename, base64, type }]

    const localQueue = mediaQueue.filter(item => item.isLocal);
    const remoteQueue = mediaQueue.filter(item => !item.isLocal);

    if (localQueue.length > 0) {
      for (let i = 0; i < localQueue.length; i++) {
        const item = localQueue[i];
        updateProgress(`Fetching local attachment ${i+1}/${localQueue.length}: ${item.filename}...`);
        try {
          let blob = null;

          if (item.url.startsWith('blob:')) {
            // blob: URLs (Gemini generated images, etc.) often can't be fetched — try canvas first.
            if (item.kind === 'image') {
              const imgEl = Array.from(document.querySelectorAll('img')).find(el => el.src === item.url);
              if (imgEl && imgEl.naturalWidth) {
                const cvs = document.createElement('canvas');
                cvs.width = imgEl.naturalWidth;
                cvs.height = imgEl.naturalHeight;
                cvs.getContext('2d').drawImage(imgEl, 0, 0);
                blob = await new Promise(resolve => cvs.toBlob(resolve, 'image/png'));
              }
            } else if (item.kind === 'video') {
              const vidEl = Array.from(document.querySelectorAll('video')).find(el => {
                const s = el.src || (el.querySelector('source') && el.querySelector('source').src) || '';
                return s === item.url;
              });
              if (vidEl && vidEl.videoWidth) {
                const cvs = document.createElement('canvas');
                cvs.width = vidEl.videoWidth;
                cvs.height = vidEl.videoHeight;
                cvs.getContext('2d').drawImage(vidEl, 0, 0);
                blob = await new Promise(resolve => cvs.toBlob(resolve, 'image/png'));
              }
            }
            // Fall back to fetch if canvas didn't work (e.g. data: URLs or other blob types)
            if (!blob || !blob.size) {
              const res = await fetch(item.url);
              if (!res.ok) throw new Error('HTTP ' + res.status);
              blob = await res.blob();
            }
          } else {
            const res = await fetch(item.url);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            blob = await res.blob();
          }

          const ext = extFromMime(blob.type);
          if (ext && !item.filename.toLowerCase().endsWith(ext)) {
            const stem = item.filename.replace(/\.[a-z0-9]{1,5}$/i, '');
            item.filename = stem + ext;
          }

          const base64Data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });

          savedMedia.push({ filename: item.filename, base64: base64Data, type: blob.type });
        } catch (err) {
          console.warn('[Exporter] Local fetch failed for', item.url, err);
          failedFetches.push({ url: item.url, filename: item.filename, error: String(err.message || err) });
        }
      }
    }

    const title = document.title.replace(/[-|].*(Claude|ChatGPT|Gemini).*/i, '').trim() || (`${siteName} Conversation`);
    const date = new Date().toISOString();

    return {
      title,
      siteName,
      date,
      messageCount: ordered.length,
      messages: ordered.map(m => ({ role: m.role, text: m.text })),
      savedMedia,
      remoteQueue,
      failedFetches
    };
  }
})();
