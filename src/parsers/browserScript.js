// Browser console export script for ChatGPT, Claude.ai, Gemini.
// Stringified so it can be copied to the clipboard verbatim.
//
// v2 — adds media bundling:
//   - Captures <img>, <video>, <audio>, and <a download> attachments alongside text.
//   - Dynamic-imports JSZip from a CDN (no install step required for the end user).
//   - Output is now a .zip containing `conversation.md` + a `media/` folder.
//     Markdown references each file with a relative path so it renders correctly
//     after extracting.
//   - Cross-origin media that the browser blocks falls back to keeping the
//     original URL in the markdown (with a `[fetch failed]` annotation).
//
// Carried over from v1:
//   - Dedupe by element reference (Set), not text-prefix slice.
//   - Preserve fenced code blocks via a DOM walker.
//   - Anchor Claude.ai detection on `main` instead of a depth heuristic.

export const consoleCode = `// AI Conversation Exporter (Claude, ChatGPT, Gemini) — bundles media into a .zip
(async function() {
  var isChatGPT = !!document.querySelector('[data-message-author-role]');
  var isClaude = !!document.querySelector('[data-testid="user-message"]');
  var isGemini = !!document.querySelector('user-query');

  if (!isChatGPT && !isClaude && !isGemini) {
    alert("No messages found. Open this on a Claude.ai, ChatGPT, or Gemini conversation.");
    return;
  }

  var siteName = isChatGPT ? "ChatGPT" : (isClaude ? "Claude" : "Gemini");

  // ----- Load JSZip from a CDN. Single ESM import; falls back to .md if it fails. -----
  var JSZip = null;
  try {
    var mod = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
    JSZip = mod.default || mod;
  } catch (e) {
    console.warn("[Exporter] JSZip CDN load failed, falling back to .md only:", e);
  }

  // ----- Media bookkeeping -----
  var mediaQueue = [];  // [{ url, filename, kind, alt }]
  var urlToFilename = new Map();
  var mediaCounter = 0;

  function enqueueMedia(rawUrl, kind, alt) {
    if (!rawUrl) return null;
    var absolute;
    try { absolute = new URL(rawUrl, location.href).href; } catch (e) { return null; }
    if (urlToFilename.has(absolute)) return urlToFilename.get(absolute);

    var filename = generateMediaFilename(absolute, kind, mediaCounter++);
    urlToFilename.set(absolute, filename);
    mediaQueue.push({ url: absolute, filename: filename, kind: kind, alt: alt || "" });
    return filename;
  }

  function generateMediaFilename(url, kind, idx) {
    var basePart = "";
    try {
      var u = new URL(url);
      var lastSeg = u.pathname.split('/').filter(Boolean).pop() || "";
      basePart = lastSeg.split('?')[0];
    } catch (e) { basePart = ""; }
    basePart = basePart.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '');
    var hasExt = /\\.[a-z0-9]{1,5}$/i.test(basePart);
    if (basePart && hasExt) {
      return String(idx).padStart(3, '0') + '-' + basePart.toLowerCase();
    }
    var prefix = kind === 'image' ? 'image'
               : kind === 'video' ? 'video'
               : kind === 'audio' ? 'audio'
               : 'file';
    var ext = kind === 'image' ? '.png'
            : kind === 'video' ? '.mp4'
            : kind === 'audio' ? '.mp3'
            : '.bin';
    return String(idx).padStart(3, '0') + '-' + prefix + ext;
  }

  function extFromMime(mime) {
    if (!mime) return null;
    var map = {
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

  // ----- Walk an element, emit markdown, queue media -----
  function nodeToMarkdown(node) {
    if (!node) return "";
    var out = "";
    node.childNodes.forEach(function(child) {
      if (child.nodeType === 3) { out += child.nodeValue; return; }
      if (child.nodeType !== 1) return;
      var tag = child.tagName.toLowerCase();

      // ----- Media -----
      if (tag === 'img') {
        var src = child.currentSrc || child.src || child.getAttribute('src');
        var alt = (child.getAttribute('alt') || '').trim();
        var fname = enqueueMedia(src, 'image', alt);
        var altText = alt ? ` - "${alt}"` : '';
        if (fname) {
          out += '\\n\\n![' + alt + '](media/' + fname + ')\\n*(Uploaded Image: \`media/' + fname + '\`' + altText + ')*\\n\\n';
        } else {
          out += '\\n\\n![' + alt + '](' + src + ')\\n*(Uploaded Image: <' + src + '>' + altText + ')*\\n\\n';
        }
        return;
      }
      if (tag === 'video') {
        var vSrc = child.currentSrc || child.src || child.getAttribute('src');
        if (!vSrc) {
          var srcEl = child.querySelector('source');
          if (srcEl) vSrc = srcEl.src || srcEl.getAttribute('src');
        }
        var fname2 = enqueueMedia(vSrc, 'video');
        if (fname2) {
          out += '\\n\\n[🎬 video: media/' + fname2 + '](media/' + fname2 + ')\\n*(Uploaded Video: \`media/' + fname2 + '\`)*\\n\\n';
        } else if (vSrc) {
          out += '\\n\\n[🎬 video](' + vSrc + ')\\n*(Uploaded Video: <' + vSrc + '>)*\\n\\n';
        }
        return;
      }
      if (tag === 'audio') {
        var aSrc = child.currentSrc || child.src || child.getAttribute('src');
        if (!aSrc) {
          var srcEl2 = child.querySelector('source');
          if (srcEl2) aSrc = srcEl2.src || srcEl2.getAttribute('src');
        }
        var fname3 = enqueueMedia(aSrc, 'audio');
        if (fname3) {
          out += '\\n\\n[🔊 audio: media/' + fname3 + '](media/' + fname3 + ')\\n*(Uploaded Audio: \`media/' + fname3 + '\`)*\\n\\n';
        } else if (aSrc) {
          out += '\\n\\n[🔊 audio](' + aSrc + ')\\n*(Uploaded Audio: <' + aSrc + '>)*\\n\\n';
        }
        return;
      }
      // <a download> or known-file links (best-effort attachment capture)
      if (tag === 'a') {
        var href = child.getAttribute('href') || '';
        var downloadable = child.hasAttribute('download')
          || /\\.(pdf|csv|tsv|json|zip|txt|md|docx?|xlsx?|pptx?|py|js|ts|tsx|jsx|html|css|wav|mp3|mp4|mov|webm)(\\?.*)?$/i.test(href);
        if (downloadable && href && href !== '#') {
          var label = (child.innerText || child.getAttribute('aria-label') || 'attachment').trim();
          var fname4 = enqueueMedia(href, 'attachment', label);
          if (fname4) {
            out += '[📎 ' + (label || fname4) + '](media/' + fname4 + ') *(Uploaded File: \`media/' + fname4 + '\`)*';
            return;
          }
        }
        // ordinary link: keep as plain anchor
        if (href && href !== '#') {
          out += '[' + (child.innerText || href) + '](' + href + ')';
          return;
        }
      }

      // ----- Prose elements -----
      if (tag === 'pre') {
        var codeEl = child.querySelector('code') || child;
        var classNames = (codeEl.className || '') + ' ' + (child.className || '');
        var langMatch = classNames.match(/(?:language-|lang-|hljs language-)([a-z0-9+#-]+)/i);
        var lang = langMatch ? langMatch[1] : '';
        var codeText = codeEl.innerText.replace(/\\n+$/, '');
        out += '\\n\\n\\u0060\\u0060\\u0060' + lang + '\\n' + codeText + '\\n\\u0060\\u0060\\u0060\\n\\n';
        return;
      }
      if (tag === 'code' && child.parentElement && child.parentElement.tagName.toLowerCase() !== 'pre') {
        out += '\\u0060' + child.innerText + '\\u0060';
        return;
      }
      if (tag === 'br') { out += '\\n'; return; }
      if (tag === 'p' || tag === 'div') { out += nodeToMarkdown(child) + '\\n\\n'; return; }
      if (tag === 'li') { out += '- ' + nodeToMarkdown(child) + '\\n'; return; }
      if (tag === 'strong' || tag === 'b') { out += '**' + nodeToMarkdown(child) + '**'; return; }
      if (tag === 'em' || tag === 'i') { out += '*' + nodeToMarkdown(child) + '*'; return; }
      if (/^h[1-6]$/.test(tag)) {
        var n = parseInt(tag.slice(1), 10);
        out += '\\n\\n' + '#'.repeat(n) + ' ' + nodeToMarkdown(child) + '\\n\\n';
        return;
      }
      out += nodeToMarkdown(child);
    });
    return out;
  }

  function cleanText(s) { return s.replace(/\\n{3,}/g, '\\n\\n').trim(); }

  // ----- Find scroll container, force-load all turns -----
  var firstMsg;
  if (isChatGPT) firstMsg = document.querySelector('[data-message-author-role]');
  else if (isClaude) firstMsg = document.querySelector('[data-testid="user-message"]');
  else firstMsg = document.querySelector('user-query');

  var scrollEl = document.documentElement;
  var p = firstMsg;
  while (p && p.parentElement) {
    p = p.parentElement;
    var style = window.getComputedStyle(p);
    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && p.scrollHeight > p.clientHeight + 100) {
      scrollEl = p; break;
    }
  }

  function scrollTopTo(y) {
    if (scrollEl === document.documentElement) window.scrollTo(0, y);
    else scrollEl.scrollTop = y;
  }
  function scrollBy(dy) {
    if (scrollEl === document.documentElement) window.scrollBy(0, dy);
    else scrollEl.scrollTop += dy;
  }
  function currentTop() {
    return scrollEl === document.documentElement ? window.scrollY : scrollEl.scrollTop;
  }
  function clientH() {
    return scrollEl === document.documentElement ? window.innerHeight : scrollEl.clientHeight;
  }

  console.log('[Exporter] Scrolling to load all messages...');
  scrollTopTo(0);
  await new Promise(function(r) { setTimeout(r, 500); });

  var lastTop = -1, attempts = 0;
  while (attempts < 500) {
    scrollBy(clientH() - 50);
    await new Promise(function(r) { setTimeout(r, 100); });
    if (currentTop() === lastTop) break;
    lastTop = currentTop();
    attempts++;
  }
  scrollTopTo(0);
  await new Promise(function(r) { setTimeout(r, 500); });

  // ----- Capture pass -----
  var seen = new Set();
  var ordered = [];
  lastTop = -1;

  function captureClaude() {
    document.querySelectorAll('[data-testid="user-message"]').forEach(function(el) {
      if (seen.has(el)) return;
      seen.add(el);
      ordered.push({ el: el, role: '## You', text: cleanText(nodeToMarkdown(el)) });
    });
    var main = document.querySelector('main') || document.body;
    var blocks = main.querySelectorAll('[data-test-render-count], .font-claude-message, [class*="claude-message"]');
    blocks.forEach(function(el) {
      if (seen.has(el)) return;
      if (el.closest('[data-testid="user-message"]')) return;
      seen.add(el);
      var txt = cleanText(nodeToMarkdown(el));
      if (txt) ordered.push({ el: el, role: '## Claude', text: txt });
    });
  }
  function captureChatGPT() {
    document.querySelectorAll('[data-message-author-role]').forEach(function(el) {
      if (seen.has(el)) return;
      seen.add(el);
      var roleAttr = el.getAttribute('data-message-author-role');
      var role = roleAttr === 'user' ? '## You' : '## ChatGPT';
      var txt = cleanText(nodeToMarkdown(el));
      if (txt) ordered.push({ el: el, role: role, text: txt });
    });
  }
  function captureGemini() {
    document.querySelectorAll('user-query, model-response').forEach(function(el) {
      if (seen.has(el)) return;
      seen.add(el);
      var role = el.tagName.toLowerCase() === 'user-query' ? '## You' : '## Gemini';
      var txt = cleanText(nodeToMarkdown(el));
      if (txt) ordered.push({ el: el, role: role, text: txt });
    });
  }

  while (true) {
    if (isClaude) captureClaude();
    else if (isChatGPT) captureChatGPT();
    else captureGemini();

    scrollBy(clientH() - 50);
    await new Promise(function(r) { setTimeout(r, 200); });
    if (currentTop() === lastTop) break;
    lastTop = currentTop();
  }
  if (isClaude) captureClaude();
  else if (isChatGPT) captureChatGPT();
  else captureGemini();

  if (!ordered.length) { alert('No messages found.'); return; }

  ordered.sort(function(a, b) {
    if (a.el === b.el) return 0;
    var pos = a.el.compareDocumentPosition(b.el);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  console.log('[Exporter] Captured ' + ordered.length + ' messages, ' + mediaQueue.length + ' media items');

  // ----- Fetch media, build zip -----
  var failedFetches = [];
  var savedMedia = [];
  if (JSZip && mediaQueue.length > 0) {
    var zipPreview = new JSZip();  // probe; reassigned below
    // Fetch sequentially to keep memory bounded and avoid CDN rate limits.
    for (var i = 0; i < mediaQueue.length; i++) {
      var item = mediaQueue[i];
      try {
        var res = await fetch(item.url, { credentials: 'include', mode: 'cors' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var blob = await res.blob();
        // Upgrade extension based on MIME type if we previously guessed wrong.
        var ext = extFromMime(blob.type);
        if (ext && !item.filename.toLowerCase().endsWith(ext)) {
          var stem = item.filename.replace(/\\.[a-z0-9]{1,5}$/i, '');
          item.filename = stem + ext;
        }
        savedMedia.push({ filename: item.filename, blob: blob });
        // Rewrite any markdown reference to use the (possibly updated) filename.
        // We replace by url-derived original filename in messages text:
      } catch (err) {
        console.warn('[Exporter] Fetch failed for', item.url, err);
        failedFetches.push({ url: item.url, filename: item.filename, error: String(err.message || err) });
      }
    }
  }

  // Rewrite media/* references for failed fetches back to original URL.
  var failedFilenames = new Set(failedFetches.map(function(f) { return f.filename; }));
  ordered.forEach(function(m) {
    if (!failedFilenames.size) return;
    failedFetches.forEach(function(f) {
      var needle = 'media/' + f.filename;
      // Replace [text](media/file) with [text \[fetch failed\]](originalUrl)
      var re = new RegExp('\\\\]\\\\(' + needle.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + '\\\\)', 'g');
      m.text = m.text.replace(re, '] [fetch failed](' + f.url + ')');
    });
  });

  // ----- Markdown -----
  var title = document.title.replace(/[-|].*(Claude|ChatGPT|Gemini).*/i, '').trim() || (siteName + ' Conversation');
  var date = new Date().toISOString();
  var nl = '\\n';
  var md = '---' + nl;
  md += 'title: ' + JSON.stringify(title) + nl;
  md += 'source: ' + siteName + nl;
  md += 'exported_at: ' + date + nl;
  md += 'message_count: ' + ordered.length + nl;
  md += 'media_count: ' + savedMedia.length + nl;
  if (failedFetches.length) md += 'media_failed: ' + failedFetches.length + nl;
  md += '---' + nl + nl;
  md += '# ' + title + nl + nl;
  ordered.forEach(function(m, i) {
    md += m.role + nl + nl + m.text + nl + nl;
    if (i < ordered.length - 1) md += '---' + nl + nl;
  });

  // ----- Download -----
  var safeBase = title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60);
  var stamp = new Date().toISOString().slice(0, 10);

  if (JSZip && (savedMedia.length > 0 || mediaQueue.length > 0)) {
    var zip = new JSZip();
    zip.file('conversation.md', md);
    var folder = zip.folder('media');
    savedMedia.forEach(function(m) { folder.file(m.filename, m.blob); });
    if (failedFetches.length) {
      var report = failedFetches.map(function(f) {
        return f.filename + '\\t' + f.url + '\\t' + f.error;
      }).join('\\n');
      zip.file('media-fetch-errors.tsv', 'filename\\turl\\terror\\n' + report);
    }
    var zipBlob = await zip.generateAsync({ type: 'blob' });
    triggerDownload(zipBlob, safeBase + '-' + stamp + '.zip');
    console.log('[Exporter] Saved zip with ' + savedMedia.length + '/' + mediaQueue.length + ' media items');
  } else {
    var mdBlob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    triggerDownload(mdBlob, safeBase + '.md');
    console.log('[Exporter] Saved ' + safeBase + '.md');
  }

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 2000);
  }
})();`;
