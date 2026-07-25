// Content script for AI Chat Exporter Chrome Extension
// Scrapes the chat page, scrolls to load all content, fetches media, and returns the data.

(async function() {
  const scriptVersion = (window.__exporterScriptVersion || 0) + 1;
  window.__exporterScriptVersion = scriptVersion;

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

  let exportCancelled = false;

  // Chrome throttles setTimeout to ~1/second (or worse) in hidden tabs.
  // The background worker dispatches an __exportWake event every 500ms via
  // chrome.scripting.executeScript, which is NOT throttled. sleep() listens
  // for that event so the export keeps running at near-normal speed even
  // when the user switches to another tab.
  //
  // sleep() is also the cancellation point: if the export is cancelled while
  // it's waiting, it aborts the sleep and throws immediately instead of
  // running out the full delay. Since nearly every step awaits a sleep, this
  // makes Cancel take effect almost instantly no matter what phase we're in.
  function sleep(ms) {
    return new Promise((resolve, reject) => {
      if (exportCancelled) { reject(new Error("Export cancelled.")); return; }
      const deadline = Date.now() + ms;
      let settled = false;
      const cleanup = () => {
        document.removeEventListener('__exportWake', onWake);
        document.removeEventListener('__exportCancel', onCancel);
      };
      const done = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const onCancel = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("Export cancelled."));
      };
      const onWake = () => {
        if (Date.now() >= deadline) done();
      };
      document.addEventListener('__exportWake', onWake);
      document.addEventListener('__exportCancel', onCancel);
      setTimeout(done, ms);
    });
  }

  // Listen for the run message from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (window.__exporterScriptVersion !== scriptVersion) return;
    if (!request) return;
    if (request.action === "cancelExport") {
      exportCancelled = true;
      // Wake any in-flight sleep() so it aborts right now instead of
      // waiting out its timer.
      try { document.dispatchEvent(new Event('__exportCancel')); } catch (e) {}
      sendResponse({ status: "cancelled" });
      return;
    }
    if (request.action === "exportChat") {
      exportCancelled = false;
      startKeepAlive();
      runExport(request.options)
        .then(result => {
          stopKeepAlive();
          sendResponse({ status: "success", data: result });
        })
        .catch(err => {
          stopKeepAlive();
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
    function checkCancelled() {
      if (exportCancelled) throw new Error("Export cancelled.");
    }

    // Aborts in-flight network requests the moment Cancel is hit, so a slow
    // media download or the initial API fetch doesn't hold up cancellation.
    const abortController = new AbortController();
    const onExportCancel = () => {
      document.removeEventListener('__exportCancel', onExportCancel);
      try { abortController.abort(); } catch (e) {}
    };
    document.addEventListener('__exportCancel', onExportCancel);
    if (exportCancelled) abortController.abort();

    // Grok is tested FIRST: it marks messages with [data-testid="user-message"]
    // too, which is also Claude's selector, so a hostname check has to break
    // the tie before the Claude branch can claim the page.
    const isGrok = /(^|\.)grok\.com$/.test(location.hostname) &&
                   !!document.querySelector('[data-testid="user-message"],[data-testid="assistant-message"]');
    const isChatGPT = !isGrok && !!document.querySelector('[data-message-author-role]');
    const isClaude = !isGrok && !!document.querySelector('[data-testid="user-message"]');
    const isGemini = !isGrok && !!document.querySelector('user-query');

    if (!isChatGPT && !isClaude && !isGemini && !isGrok) {
      throw new Error("No messages found. Open this on a Claude.ai, ChatGPT, Gemini, or Grok conversation.");
    }

    const siteName = isGrok ? "Grok" : (isChatGPT ? "ChatGPT" : (isClaude ? "Claude" : "Gemini"));
    updateProgress(`Detected ${siteName} tab. Scanning scroll container...`);

    // claude.ai virtualizes long chats so aggressively that a DOM sweep is
    // both slow (React mounts each window synchronously; ~20 min on a long
    // chat) and lossy (the DOM never mounts every message). The SPA's own
    // JSON API returns the entire conversation in one request — use it,
    // and keep the DOM sweep only as a fallback. Runs in the page context,
    // so the user's session cookies apply; nothing leaves claude.ai.
    let claudeApiData = null;
    if (isClaude) {
      try {
        updateProgress("Fetching conversation via claude.ai API (no scrolling needed)...");
        const convoId = (location.pathname.match(/\/chat\/([^/?#]+)/) || [])[1];
        if (!convoId) throw new Error("no conversation id in URL");
        const orgsRes = await fetch("/api/organizations", { credentials: "same-origin", signal: abortController.signal });
        if (!orgsRes.ok) throw new Error("organizations HTTP " + orgsRes.status);
        const orgs = await orgsRes.json();
        // The account may belong to several organizations; the conversation
        // lives in exactly one. Try chat-capable orgs first.
        const candidates = [
          ...orgs.filter(o => (o.capabilities || []).includes("chat")),
          ...orgs.filter(o => !(o.capabilities || []).includes("chat"))
        ];
        for (const org of candidates) {
          const res = await fetch(
            "/api/organizations/" + org.uuid + "/chat_conversations/" + convoId +
            "?tree=True&rendering_mode=messages&render_all_tools=true",
            { credentials: "same-origin", signal: abortController.signal }
          );
          if (res.ok) { claudeApiData = await res.json(); break; }
        }
        if (!claudeApiData || !Array.isArray(claudeApiData.chat_messages) || !claudeApiData.chat_messages.length) {
          claudeApiData = null;
          throw new Error("conversation not found via API");
        }
        updateProgress(`Fetched ${claudeApiData.chat_messages.length} messages via API.`);
      } catch (e) {
        claudeApiData = null;
        updateProgress(`claude.ai API path failed (${e.message || e}); falling back to page scrape.`);
      }
    }

    // ----- Find scroll container, force-load all turns -----
    const GROK_MSG_SELECTOR = '[data-testid="user-message"],[data-testid="assistant-message"]';

    let firstMsg;
    if (isGrok) firstMsg = document.querySelector(GROK_MSG_SELECTOR);
    else if (isChatGPT) firstMsg = document.querySelector('[data-message-author-role]');
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
      const geminiScroller = document.querySelector('infinite-scroller.chat-history');
      if (geminiScroller) els.add(geminiScroller);
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

    const initialClientH = window.innerHeight || 800;

    function clientH() {
      let h = window.innerHeight;
      if (scrollEl && scrollEl !== document.documentElement && scrollEl.clientHeight > 0) {
        h = scrollEl.clientHeight;
      }
      return Math.max(h, initialClientH, 600);
    }

    function getMaxScrollHeight() {
      let maxH = document.documentElement.scrollHeight || 0;
      getScrollableElements().forEach(el => {
        if (el && el.scrollHeight > maxH) maxH = el.scrollHeight;
      });
      return maxH;
    }

    // Kept as a hook point for the scroll loops. The background worker's
    // visibility patch + wake pulses keep a hidden tab progressing, so
    // there is nothing to do here anymore.
    async function ensureVisible() {}

    updateProgress("Loading full conversation history...");

    if (isClaude && claudeApiData) {
      // Full conversation already fetched via the API — no DOM prep needed.
    } else if (isClaude) {
      // Fallback DOM path: jump to the top, confirm the height is stable,
      // and let the capture sweep below visit every virtualized window.
      scrollTopTo(0);
      await sleep(600);
      let cLastH = getMaxScrollHeight();
      for (let cStep = 0; cStep < 10; cStep++) {
        checkCancelled();
        await sleep(300);
        const h = getMaxScrollHeight();
        if (h === cLastH) break;
        cLastH = h;
        scrollTopTo(0);
      }
    } else if (isGrok) {
      // Grok keeps every message mounted (verified live, 2026-07: a
      // 53-message chat had all 53 in the DOM with stable element
      // identity, and scrolling to the top loaded nothing new). Longer
      // chats may still paginate, so scroll up until the count stops
      // growing, then stop — on an already-complete chat this costs one
      // round and exits.
      const grokCount = () => document.querySelectorAll(GROK_MSG_SELECTOR).length;
      let gPrev = grokCount();
      let gEmpty = 0;

      for (let step = 0; step < 300 && gEmpty < 3; step++) {
        checkCancelled();
        scrollTopTo(0);
        getScrollableElements().forEach(el => {
          try { el.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (e) {}
        });
        await sleep(700);
        const c = grokCount();
        if (c > gPrev) {
          gPrev = c;
          gEmpty = 0;
          updateProgress(`Loading history... ${c} messages`);
        } else {
          gEmpty++;
        }
      }
      updateProgress(`All history loaded: ${gPrev} messages.`);
    } else if (isGemini) {
      // The background worker moves this tab to its own window so Chrome
      // never throttles it. With the tab visible, Gemini's lazy-loader
      // works normally: scroll the infinite-scroller to 0, dispatch a
      // 'scroll' event, wait for the batch to render.
      //
      // Verified live (2026-07, 340-message chat):
      //   - scrollTop=0 alone does NOT trigger the loader; the scroll
      //     event dispatch is required.
      //   - After each ~20-message batch, Gemini restores scrollTop back
      //     down, so every round must re-scroll to 0.
      //   - Batches can stall for 1-2 rounds then resume, so "done"
      //     requires several consecutive rounds with zero growth.
      const gScroller = () =>
        document.querySelector('infinite-scroller.chat-history') ||
        scrollEl || document.scrollingElement || document.documentElement;
      const msgCount = () => document.querySelectorAll('user-query, model-response').length;

      let prevCount = msgCount();
      let emptyRounds = 0;

      for (let gStep = 0; gStep < 2000; gStep++) {
        checkCancelled();

        const sc = gScroller();
        sc.scrollTop = 0;
        sc.dispatchEvent(new Event('scroll', { bubbles: true }));

        // Wait for the count to grow. Batch render time scales with DOM
        // size, so be patient.
        const waitStart = Date.now();
        let grew = false;
        while (Date.now() - waitStart < 15000) {
          await sleep(500);
          checkCancelled();
          if (msgCount() > prevCount) { grew = true; break; }
        }

        const now = msgCount();
        if (grew) {
          emptyRounds = 0;
          prevCount = now;
          updateProgress(`Loading history... ${now} messages`);
        } else {
          emptyRounds++;
          if (emptyRounds >= 4) {
            updateProgress(`All history loaded: ${now} messages.`);
            break;
          }
        }
      }

      gScroller().scrollTop = 0;
      await sleep(500);
    } else {
      // ChatGPT: scroll UP to trigger lazy-loaded history.
      let upAttempts = 0;
      let noNewContentCount = 0;
      let lastScrollHeight = getMaxScrollHeight();

      while (upAttempts < 200) {
        checkCancelled();
        await ensureVisible();

        const stepSize = clientH() - 50;
        const before = currentTop();

        if (before <= 0) {
          scrollTopTo(0);
          getScrollableElements().forEach(el => {
            try { el.dispatchEvent(new Event('scroll', { bubbles: true })); } catch(e) {}
          });
          await sleep(400);

          const afterH = getMaxScrollHeight();
          const afterTop = currentTop();
          if (afterTop === 0 && afterH === lastScrollHeight) {
            noNewContentCount++;
            if (noNewContentCount > 5) {
              updateProgress("Reached the top of the conversation.");
              break;
            }
          } else {
            noNewContentCount = 0;
          }
          lastScrollHeight = afterH;
        } else {
          scrollBy(-stepSize);
          getScrollableElements().forEach(el => {
            try { el.dispatchEvent(new Event('scroll', { bubbles: true })); } catch(e) {}
          });
          await sleep(250);
          const afterTop = currentTop();
          const afterH = getMaxScrollHeight();
          if (afterTop === before && afterH === lastScrollHeight) {
            noNewContentCount++;
            if (noNewContentCount > 3) {
              scrollTopTo(0);
              await sleep(250);
            }
          } else {
            noNewContentCount = 0;
          }
          lastScrollHeight = afterH;
        }

        upAttempts++;
        if (upAttempts % 10 === 0) {
          updateProgress(`Scrolling UP to load history (step ${upAttempts})...`);
        }
      }

      // Scroll DOWN to ensure all virtualized nodes render
      updateProgress("Scrolling DOWN to render all messages...");
      scrollTopTo(0);
      await sleep(500);

      let lastTop = -1;
      let downAttempts = 0;
      let noProgressCount = 0;

      while (downAttempts < 120) {
        checkCancelled();
        await ensureVisible();
        const currentH = getMaxScrollHeight();
        const currTop = currentTop();
        const viewH = clientH();

        if (currTop + viewH >= currentH - 100) break;

        scrollBy(viewH - 50);
        getScrollableElements().forEach(el => {
          try { el.dispatchEvent(new Event('scroll', { bubbles: true })); } catch(e) {}
        });

        await sleep(250);

        const top = currentTop();
        if (top === lastTop) {
          noProgressCount++;
          if (noProgressCount > 6) break;
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
      getScrollableElements().forEach(el => {
        try { el.dispatchEvent(new Event('scroll', { bubbles: true })); } catch(e) {}
      });
      await sleep(500);
    }

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

    const GEMINI_SKIP_TAGS = new Set([
      'sources-list', 'message-actions', 'thumb-up-button', 'thumb-down-button',
      'copy-button', 'freemium-rag-disclaimer', 'sensitive-memories-banner',
      'election-info-disclaimer', 'fact-check-button'
    ]);

    // ----- Walk DOM to generate Markdown -----
    function nodeToMarkdown(node) {
      if (!node) return "";
      let out = "";
      node.childNodes.forEach(child => {
        if (child.nodeType === 3) { out += child.nodeValue; return; }
        if (child.nodeType !== 1) return;
        if (child.classList && (
          child.classList.contains('cdk-visually-hidden') ||
          child.classList.contains('sr-only') ||
          child.classList.contains('visually-hidden')
        )) return;
        const tag = child.tagName.toLowerCase();

        if (GEMINI_SKIP_TAGS.has(tag)) return;

        // Grok wraps its reasoning trace in .thinking-container; honour the
        // "Include Thinking" toggle rather than always inlining it.
        if (child.classList && child.classList.contains('thinking-container')) {
          if (!options.includeThinking) return;
          const think = cleanText(nodeToMarkdown(child));
          if (think) out += '\n\n*Thinking:*\n\n> ' + think.replace(/\n/g, '\n> ') + '\n\n';
          return;
        }

        // ----- Media capture -----
        if (tag === 'img') {
          const src = child.currentSrc || child.src || child.getAttribute('src');
          const alt = (child.getAttribute('alt') || '').trim();

          if (src && src.includes('drive-thirdparty.googleusercontent.com')) {
            return;
          }

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

    function cleanGeminiText(s) {
      return s.replace(/\s{2,}[A-Z]{2,5}(?:\+\s*\d+)?\s*$/gm, '');
    }

    // ----- Capture Pass -----
    const seen = new Set();
    const ordered = [];
    let captureOrder = 0;

    // Gemini's virtualizer recycles DOM nodes, so element-reference dedup
    // doesn't work. Use a text fingerprint (first 200 chars of role+text)
    // to avoid duplicates from recycled elements.
    const seenTexts = new Set();

    // claude.ai virtualizes long chats: only ~10 message wrappers are
    // mounted at a time (notably BOTH the first and last turns while you're
    // at the top), and wrappers unmount/remount as you scroll. Two
    // consequences for capture:
    //   - element-identity dedup fails (a remounted message is a new node),
    //     so dedup by text fingerprint;
    //   - capture sequence is NOT document order (the tail is mounted at
    //     the top of the sweep), so order by absolute pixel position in
    //     the scroll space instead.
    let claudeScrollerCache = null;
    function claudeScroller() {
      if (claudeScrollerCache && claudeScrollerCache.isConnected) return claudeScrollerCache;
      claudeScrollerCache = Array.from(document.querySelectorAll('.overflow-y-auto'))
        .filter(el => el.scrollHeight > el.clientHeight + 200)
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || null;
      return claudeScrollerCache;
    }

    function captureClaude() {
      const sc = claudeScroller();
      const base = sc ? sc.scrollTop : 0;
      const absTop = (el) => Math.round(el.getBoundingClientRect().top + base);

      document.querySelectorAll('[data-testid="user-message"]').forEach(el => {
        const fp = 'Y|' + (el.textContent || '').trim().slice(0, 200);
        if (seenTexts.has(fp)) return;
        const txt = cleanText(nodeToMarkdown(el));
        if (!txt) return;
        seenTexts.add(fp);
        ordered.push({ el: el, role: '## You', text: txt, ord: absTop(el) });
      });
      // claude.ai renamed .font-claude-message to .font-claude-response
      // (mid-2026). Query both so the extension works on either build. The
      // [data-test-render-count] wrappers now wrap USER messages too, so
      // they can't be used as a response selector anymore — a wrapper that
      // contains a user message is not a Claude turn.
      const main = document.querySelector('main') || document.body;
      let blocks = main.querySelectorAll('.font-claude-response, .font-claude-message');
      if (!blocks.length) {
        blocks = Array.from(main.querySelectorAll('[data-test-render-count]'))
          .filter(el => !el.querySelector('[data-testid="user-message"]'));
      }
      blocks.forEach(el => {
        if (el.closest('[data-testid="user-message"]')) return;
        const fp = 'C|' + (el.textContent || '').trim().slice(0, 200);
        if (seenTexts.has(fp)) return;
        const txt = cleanText(nodeToMarkdown(el));
        if (!txt) return;
        seenTexts.add(fp);
        ordered.push({ el: el, role: '## Claude', text: txt, ord: absTop(el) });
      });
    }

    function captureChatGPT() {
      // ChatGPT's virtualizer (verified live on temporary chats, 2026-07)
      // unmounts messages and remounts them later as brand-new element
      // objects. Two consequences:
      //   1. Dedup must key on data-message-id, not element identity,
      //      or a remounted message is captured twice.
      //   2. Capture-time ordering is unreliable: a message that remounts
      //      mid-scroll gets captured late and would sort to the end.
      //      Each message sits inside <section data-testid=
      //      "conversation-turn-N">; that N is its absolute position, so
      //      use it as the sort key. Multiple messages within one turn
      //      share an ord and keep their DOM order via the stable sort.
      document.querySelectorAll('[data-message-author-role]').forEach(el => {
        const key = el.getAttribute('data-message-id') || el;
        if (seen.has(key)) return;
        const roleAttr = el.getAttribute('data-message-author-role');
        const role = roleAttr === 'user' ? '## You' : '## ChatGPT';
        const txt = cleanText(nodeToMarkdown(el));
        // Only mark seen once we actually captured text, so a message
        // walked mid-remount (momentarily empty) can be retried on a
        // later pass instead of being lost.
        if (!txt) return;
        seen.add(key);
        let ord = null;
        const turnEl = el.closest('[data-testid^="conversation-turn-"]');
        if (turnEl) {
          const n = parseInt(turnEl.getAttribute('data-testid').slice('conversation-turn-'.length), 10);
          if (!isNaN(n)) ord = n;
        }
        ordered.push({ el: el, role: role, text: txt, ord: ord !== null ? ord : captureOrder++ });
      });
    }

    function captureGemini() {
      // Runs exactly ONCE, after the background worker has loaded the full
      // history (Gemini keeps every loaded message mounted, in document
      // order). No dedup: in a single pass every element is distinct, and
      // fingerprint dedup would wrongly drop legitimately repeated messages
      // (e.g. the user answering "yes" twice).
      document.querySelectorAll('user-query, model-response').forEach(el => {
        const role = el.tagName.toLowerCase() === 'user-query' ? '## You' : '## Gemini';
        let txt = cleanText(nodeToMarkdown(el));
        if (role === '## Gemini') txt = cleanGeminiText(txt);
        if (!txt) return; // e.g. image-only message with media export off
        ordered.push({ el: el, role: role, text: txt, ord: captureOrder++ });
      });
    }

    function captureGrok() {
      // Runs once, after the history pass. Grok renders every message in
      // document order with no virtualization, so a single sweep in DOM
      // order is both complete and correctly ordered (verified live:
      // DOM order matched visual order exactly). No dedup, for the same
      // reason as Gemini: repeated messages are legitimate.
      document.querySelectorAll(GROK_MSG_SELECTOR).forEach(el => {
        const role = el.getAttribute('data-testid') === 'user-message' ? '## You' : '## Grok';
        const txt = cleanText(nodeToMarkdown(el));
        if (!txt) return;
        ordered.push({ el: el, role: role, text: txt, ord: captureOrder++ });
      });
    }

    function captureVisible() {
      if (isGrok) captureGrok();
      else if (isClaude) captureClaude();
      else if (isChatGPT) captureChatGPT();
      else captureGemini();
    }

    // Build `ordered` straight from the claude.ai API payload: every
    // message, in order, no scrolling. Media files are pushed onto the
    // local queue (fetched below in page context, where cookies apply).
    function buildOrderedFromClaudeApi() {
      const msgs = claudeApiData.chat_messages || [];
      msgs.forEach((m, i) => {
        const role = m.sender === "human" ? "## You" : "## Claude";
        const parts = [];

        (m.attachments || []).forEach(a => {
          if (a && a.file_name) parts.push("*Attached: " + a.file_name + "*");
        });

        (m.files_v2 || m.files || []).forEach(f => {
          if (!f) return;
          const kind = f.file_kind === "image" ? "image" : "file";
          const rawUrl = f.preview_url || f.thumbnail_url || (f.document_asset && f.document_asset.url) || "";
          if (rawUrl && options.includeMedia) {
            let abs;
            try { abs = new URL(rawUrl, location.href).href; } catch (e) { return; }
            if (!urlToFilename.has(abs)) {
              const filename = generateMediaFilename(abs, kind, mediaCounter++);
              urlToFilename.set(abs, filename);
              // isLocal so the in-page fetch loop (with session cookies)
              // downloads it; the background worker has no claude.ai auth.
              mediaQueue.push({ url: abs, filename: filename, kind: kind, alt: f.file_name || "", isLocal: true });
            }
            const fn = urlToFilename.get(abs);
            parts.push(kind === "image" ? "![" + (f.file_name || "image") + "](" + fn + ")" : "[" + (f.file_name || "file") + "](" + fn + ")");
          } else if (f.file_name) {
            parts.push("*File: " + f.file_name + "*");
          }
        });

        (m.content || []).forEach(b => {
          if (!b) return;
          if (b.type === "text" && b.text && b.text.trim()) {
            parts.push(b.text.trim());
          } else if (b.type === "thinking" && options.includeThinking && (b.thinking || "").trim()) {
            parts.push("*Thinking:*\n\n> " + b.thinking.trim().replace(/\n/g, "\n> "));
          } else if (b.type === "tool_use" && options.includeTools) {
            parts.push("**Tool use: " + (b.name || "tool") + "**\n\n```json\n" + JSON.stringify(b.input || {}, null, 2) + "\n```");
          } else if (b.type === "tool_result" && options.includeTools) {
            let c = b.content;
            if (Array.isArray(c)) c = c.map(x => (x && x.text) || "").join("\n");
            if (typeof c !== "string") c = JSON.stringify(c ?? "", null, 2);
            if (c && c.trim()) parts.push("**Tool result:**\n\n```\n" + c.trim() + "\n```");
          }
        });

        const text = cleanText(parts.join("\n\n"));
        if (text) ordered.push({ el: null, role: role, text: text, ord: i });
      });
    }

    if (isClaude && claudeApiData) {
      updateProgress("Building export from API data...");
      buildOrderedFromClaudeApi();
    } else if (isGrok) {
      // Like Gemini: nothing is virtualized, so one sweep in DOM order
      // captures the whole conversation with no scroll-down pass.
      updateProgress("Scraping conversation structure...");
      captureGrok();
      updateProgress(`Captured ${ordered.length} messages.`);
    } else if (isGemini) {
      // Gemini keeps every loaded message mounted in the DOM (no
      // virtualization / recycling). After the scroll-up phase loaded
      // all history, every message is already rendered. One querySelectorAll
      // captures the entire conversation -- no scroll-down pass needed,
      // and critically no scrollBy()/scrollTopTo() calls that force
      // synchronous layout on the 6+ scrollable elements Angular creates
      // (which is what was stalling exports on long chats).
      updateProgress("Scraping conversation structure...");
      captureGemini();
      updateProgress(`Captured ${ordered.length} messages.`);
    } else {

    // ChatGPT or Claude DOM fallback: scroll down through the page,
    // capturing messages as the virtualizer renders each window.
    updateProgress("Scraping conversation structure...");
    scrollTopTo(0);
    getScrollableElements().forEach(el => {
      try { el.dispatchEvent(new Event('scroll', { bubbles: true })); } catch(e) {}
    });
    await sleep(300);
    captureVisible();

    let scrapeNoProgressCount = 0;
    let lastTop = -1;
    const captureDelay = isClaude ? 60 : 250;
    const captureStep = isClaude ? Math.floor(clientH() * 1.5) : clientH() - 50;

    let lastProgressAt = 0;

    while (true) {
      checkCancelled();
      await ensureVisible();

      const currentH = getMaxScrollHeight();
      const currTop = currentTop();
      const viewH = clientH();

      if (currTop + viewH >= currentH - 100) {
        captureVisible();
        break;
      }

      scrollBy(captureStep);
      getScrollableElements().forEach(el => {
        try { el.dispatchEvent(new Event('scroll', { bubbles: true })); } catch(e) {}
      });

      await sleep(captureDelay);
      captureVisible();

      if (Date.now() - lastProgressAt > 500) {
        lastProgressAt = Date.now();
        updateProgress(`Captured ${ordered.length} messages...`);
      }

      const top = currentTop();
      if (top === lastTop) {
        scrapeNoProgressCount++;
        await sleep(200);
        if (scrapeNoProgressCount > 12) break;
      } else {
        scrapeNoProgressCount = 0;
      }
      lastTop = top;
    }

    // Scroll to the absolute bottom and wait for the virtualizer to render
    // the last messages before the final capture.
    const maxScroll = getMaxScrollHeight();
    scrollTopTo(maxScroll);
    getScrollableElements().forEach(el => {
      try { el.dispatchEvent(new Event('scroll', { bubbles: true })); } catch(e) {}
    });
    await sleep(400);
    captureVisible();

    } // end DOM scrape path

    if (!ordered.length) {
      throw new Error('No messages could be parsed in the DOM.');
    }

    ordered.sort((a, b) => a.ord - b.ord);

    updateProgress(`Parsed ${ordered.length} messages. Found ${mediaQueue.length} media attachments.`);

    // ----- Fetch local media (Sequential & Base64 transfer) -----
    const failedFetches = [];
    const savedMedia = []; // [{ filename, base64, type }]

    const localQueue = mediaQueue.filter(item => item.isLocal);
    const remoteQueue = mediaQueue.filter(item => !item.isLocal);

    if (localQueue.length > 0) {
      for (let i = 0; i < localQueue.length; i++) {
        checkCancelled();
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
              const res = await fetch(item.url, { signal: abortController.signal });
              if (!res.ok) throw new Error('HTTP ' + res.status);
              blob = await res.blob();
            }
          } else {
            const res = await fetch(item.url, { signal: abortController.signal });
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

    const title = (claudeApiData && claudeApiData.name) ||
      document.title.replace(/[-|].*(Claude|ChatGPT|Gemini|Grok).*/i, '').trim() ||
      (`${siteName} Conversation`);
    const date = new Date().toISOString();

    document.removeEventListener('__exportCancel', onExportCancel);

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
