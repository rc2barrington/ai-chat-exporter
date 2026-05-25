// Browser console export script for ChatGPT, Claude.ai, Gemini.
// Stringified so it can be copied to the clipboard verbatim.
//
// Improvements over v1:
//   - Dedupe by element reference (Set) instead of first-150-char slice,
//     so messages sharing an opening phrase no longer collide.
//   - Preserve fenced code blocks: <pre><code> nodes are emitted as
//     ``` blocks with the language hint from common Prism/Highlight classes.
//   - Anchor Claude.ai detection on a stable ancestor (`main`) instead of
//     a depth/child-count heuristic.

export const consoleCode = `// AI Conversation Exporter (Claude, ChatGPT, Gemini)
(async function() {
  var isChatGPT = !!document.querySelector('[data-message-author-role]');
  var isClaude = !!document.querySelector('[data-testid="user-message"]');
  var isGemini = !!document.querySelector('user-query');

  if (!isChatGPT && !isClaude && !isGemini) {
    alert("No messages found. Open this on a Claude.ai, ChatGPT, or Gemini conversation.");
    return;
  }

  var siteName = isChatGPT ? "ChatGPT" : (isClaude ? "Claude" : "Gemini");

  // Walk an element, emitting fenced code blocks for <pre><code> and
  // plain text for everything else. Preserves a usable approximation
  // of the original message instead of flattening with innerText.
  function nodeToMarkdown(node) {
    if (!node) return "";
    var out = "";
    node.childNodes.forEach(function(child) {
      if (child.nodeType === 3) {
        out += child.nodeValue;
        return;
      }
      if (child.nodeType !== 1) return;
      var tag = child.tagName.toLowerCase();
      if (tag === "pre") {
        var codeEl = child.querySelector("code") || child;
        var classNames = (codeEl.className || "") + " " + (child.className || "");
        var langMatch = classNames.match(/(?:language-|lang-|hljs language-)([a-z0-9+#-]+)/i);
        var lang = langMatch ? langMatch[1] : "";
        var codeText = codeEl.innerText.replace(/\\n+$/, "");
        out += "\\n\\n\\u0060\\u0060\\u0060" + lang + "\\n" + codeText + "\\n\\u0060\\u0060\\u0060\\n\\n";
        return;
      }
      if (tag === "code" && child.parentElement && child.parentElement.tagName.toLowerCase() !== "pre") {
        out += "\\u0060" + child.innerText + "\\u0060";
        return;
      }
      if (tag === "br") { out += "\\n"; return; }
      if (tag === "p" || tag === "div") {
        out += nodeToMarkdown(child) + "\\n\\n";
        return;
      }
      if (tag === "li") { out += "- " + nodeToMarkdown(child) + "\\n"; return; }
      if (tag === "strong" || tag === "b") { out += "**" + nodeToMarkdown(child) + "**"; return; }
      if (tag === "em" || tag === "i") { out += "*" + nodeToMarkdown(child) + "*"; return; }
      if (/^h[1-6]$/.test(tag)) {
        var n = parseInt(tag.slice(1), 10);
        out += "\\n\\n" + "#".repeat(n) + " " + nodeToMarkdown(child) + "\\n\\n";
        return;
      }
      out += nodeToMarkdown(child);
    });
    return out;
  }

  function cleanText(s) {
    return s.replace(/\\n{3,}/g, "\\n\\n").trim();
  }

  // Find the scroll container by walking up from the first message.
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
      scrollEl = p;
      break;
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

  console.log("[Exporter] Scrolling to load all messages...");
  scrollTopTo(0);
  await new Promise(function(r) { setTimeout(r, 500); });

  // Warm-up pass to force virtualized lists to mount every row.
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

  // Capture pass. Dedupe by element identity, not text prefix.
  var seen = new Set();
  var ordered = [];
  lastTop = -1;

  function captureClaude() {
    var userEls = document.querySelectorAll('[data-testid="user-message"]');
    userEls.forEach(function(el) {
      if (seen.has(el)) return;
      seen.add(el);
      ordered.push({ el: el, role: "## You", text: cleanText(nodeToMarkdown(el)) });
    });
    // Claude assistant turns: each turn lives in a sibling of the user message
    // wrapped by the conversation main element.
    var main = document.querySelector('main') || document.body;
    var blocks = main.querySelectorAll('[data-test-render-count], .font-claude-message, [class*="claude-message"]');
    blocks.forEach(function(el) {
      if (seen.has(el)) return;
      // Skip if it's inside a user message
      if (el.closest('[data-testid="user-message"]')) return;
      seen.add(el);
      var txt = cleanText(nodeToMarkdown(el));
      if (txt) ordered.push({ el: el, role: "## Claude", text: txt });
    });
  }

  function captureChatGPT() {
    var els = document.querySelectorAll('[data-message-author-role]');
    els.forEach(function(el) {
      if (seen.has(el)) return;
      seen.add(el);
      var roleAttr = el.getAttribute('data-message-author-role');
      var role = roleAttr === 'user' ? "## You" : "## ChatGPT";
      var txt = cleanText(nodeToMarkdown(el));
      if (txt) ordered.push({ el: el, role: role, text: txt });
    });
  }

  function captureGemini() {
    var els = document.querySelectorAll('user-query, model-response');
    els.forEach(function(el) {
      if (seen.has(el)) return;
      seen.add(el);
      var role = el.tagName.toLowerCase() === 'user-query' ? "## You" : "## Gemini";
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

  // Final pass after reaching bottom
  if (isClaude) captureClaude();
  else if (isChatGPT) captureChatGPT();
  else captureGemini();

  if (!ordered.length) {
    alert("No messages found.");
    return;
  }

  // Sort by document order (we captured during scroll, but DOM order is canonical)
  ordered.sort(function(a, b) {
    if (a.el === b.el) return 0;
    var pos = a.el.compareDocumentPosition(b.el);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  console.log("[Exporter] Captured " + ordered.length + " messages");

  var title = document.title.replace(/[-|].*(Claude|ChatGPT|Gemini).*/i, "").trim() || (siteName + " Conversation");
  var date = new Date().toISOString();
  var nl = "\\n";
  var md = "---" + nl;
  md += "title: " + JSON.stringify(title) + nl;
  md += "source: " + siteName + nl;
  md += "exported_at: " + date + nl;
  md += "message_count: " + ordered.length + nl;
  md += "---" + nl + nl;
  md += "# " + title + nl + nl;
  ordered.forEach(function(m, i) {
    md += m.role + nl + nl + m.text + nl + nl;
    if (i < ordered.length - 1) md += "---" + nl + nl;
  });

  var blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60) + ".md";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 2000);
  console.log("[Exporter] Saved " + a.download);
})();`;
