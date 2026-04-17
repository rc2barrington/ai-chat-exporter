import { useState } from "react";

// The console snippet — readable, well-formatted version
const consoleCode = `// Claude Conversation Exporter (with auto-scroll)
(async function() {
  // Step 1: Find the scroll container
  var scrollEl = document.querySelector('[class*="overflow-y-auto"]');
  if (!scrollEl) {
    // fallback: try to find any scrollable ancestor
    var test = document.querySelector('[data-testid="user-message"]');
    if (test) {
      var p = test;
      while (p.parentElement) {
        p = p.parentElement;
        if (p.scrollHeight > p.clientHeight + 100) { scrollEl = p; break; }
      }
    }
  }

  if (!scrollEl) {
    alert("Could not find scrollable conversation area.");
    return;
  }

  // Step 2: Scroll through the entire conversation to load all messages
  console.log("\\u23f3 Scrolling through conversation to load all messages...");
  scrollEl.scrollTop = 0;
  await new Promise(function(r) { setTimeout(r, 500); });

  var lastScrollTop = -1;
  var scrollAttempts = 0;
  while (scrollAttempts < 500) {
    scrollEl.scrollTop += scrollEl.clientHeight - 50;
    await new Promise(function(r) { setTimeout(r, 150); });
    if (scrollEl.scrollTop === lastScrollTop) break;
    lastScrollTop = scrollEl.scrollTop;
    scrollAttempts++;
    if (scrollAttempts % 20 === 0) {
      var pct = Math.round((scrollEl.scrollTop / (scrollEl.scrollHeight - scrollEl.clientHeight)) * 100);
      console.log("   Scrolling... " + pct + "%");
    }
  }

  // Scroll back to top and give it a moment
  scrollEl.scrollTop = 0;
  await new Promise(function(r) { setTimeout(r, 500); });

  // Now scroll once more slowly to ensure everything is in the DOM
  lastScrollTop = -1;
  var allMessages = new Map();

  while (true) {
    // Capture visible messages at this scroll position
    var userMsgEls = document.querySelectorAll('[data-testid="user-message"]');
    if (userMsgEls.length > 0) {
      // Find container
      var container = null;
      var el = userMsgEls[0];
      while (el.parentElement) {
        el = el.parentElement;
        if (el.children.length > 20) { container = el; break; }
      }
      if (container) {
        for (var i = 0; i < container.children.length; i++) {
          var child = container.children[i];
          var text = (child.innerText || "").trim();
          if (!text) continue;
          // Use position as key to avoid duplicates
          var key = text.slice(0, 100);
          if (!allMessages.has(key)) {
            var userMsg = child.querySelector('[data-testid="user-message"]');
            if (userMsg) {
              allMessages.set(key, { role: "## \\ud83e\\uddd1 You", content: userMsg.innerText.trim(), pos: child.offsetTop });
            } else {
              allMessages.set(key, { role: "## \\ud83e\\udd16 Claude", content: text, pos: child.offsetTop });
            }
          }
        }
      }
    }

    scrollEl.scrollTop += scrollEl.clientHeight - 50;
    await new Promise(function(r) { setTimeout(r, 200); });
    if (scrollEl.scrollTop === lastScrollTop) break;
    lastScrollTop = scrollEl.scrollTop;
  }

  // Sort by position and deduplicate
  var messages = Array.from(allMessages.values());
  messages.sort(function(a, b) { return a.pos - b.pos; });

  if (!messages.length) {
    alert("No messages found.");
    return;
  }

  console.log("\\ud83d\\udcca Found " + messages.length + " messages");

  // Step 3: Build the markdown and download
  var title = document.title.replace(/[-|].*Claude.*/i, "").trim() || "Claude Conversation";
  var date = new Date().toLocaleString();
  var md = "# " + title + "\\n\\n";
  md += "> Exported from Claude.ai on " + date + "\\n\\n";
  md += "---\\n\\n";
  messages.forEach(function(msg, i) {
    md += msg.role + "\\n\\n" + msg.content + "\\n\\n";
    if (i < messages.length - 1) md += "---\\n\\n";
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
  console.log("\\u2705 Exported " + messages.length + " messages: " + a.download);
})();`;

const steps = [
  {
    num: "01",
    title: "Open a Claude conversation",
    detail: "Go to claude.ai and open any conversation you want to export.",
    icon: "💬",
  },
  {
    num: "02",
    title: "Open the Console",
    detail: "Press F12 (or Cmd+Option+J on Mac) to open DevTools, then click the Console tab.",
    icon: "🛠",
  },
  {
    num: "03",
    title: "Paste & run the script",
    detail: "Click the \"Copy Script\" button above, paste into the console with Cmd+V, and press Enter. The .md file downloads instantly.",
    icon: "📥",
  },
];

export default function App() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(consoleCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0f",
      color: "#e8e6e1",
      fontFamily: "'Courier New', Courier, monospace",
      padding: "48px 24px",
      boxSizing: "border-box",
    }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 48 }}>
          <div style={{
            display: "inline-block",
            background: "#1a1a2e",
            border: "1px solid #2a2a4a",
            borderRadius: 4,
            padding: "4px 12px",
            fontSize: 11,
            color: "#6b7fff",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            marginBottom: 20,
          }}>
            Claude.ai Utility Tool
          </div>
          <h1 style={{
            fontSize: "clamp(28px, 5vw, 44px)",
            fontWeight: 700,
            margin: "0 0 12px",
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
            fontFamily: "Georgia, serif",
            color: "#f0ede8",
          }}>
            Conversation<br />
            <span style={{ color: "#6b7fff" }}>Exporter</span>
          </h1>
          <p style={{
            color: "#888",
            fontSize: 15,
            lineHeight: 1.7,
            margin: 0,
            maxWidth: 480,
          }}>
            Export any Claude conversation as a clean Markdown file. Just copy the script, paste it into your browser console, and hit Enter. No extensions, no sign-in, no data leaves your browser.
          </p>
        </div>

        {/* Main Copy Button */}
        <div style={{
          background: "#0f0f1e",
          border: "1px solid #1e1e3a",
          borderRadius: 12,
          padding: 32,
          marginBottom: 40,
          textAlign: "center",
        }}>
          <p style={{
            color: "#666",
            fontSize: 13,
            marginBottom: 24,
            marginTop: 0,
            letterSpacing: "0.05em",
          }}>
            COPY THE EXPORT SCRIPT
          </p>

          <button
            onClick={handleCopy}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              background: copied
                ? "linear-gradient(135deg, #1a3a1a, #1a4a2a)"
                : "linear-gradient(135deg, #6b7fff, #5a6bef)",
              color: "#fff",
              padding: "16px 36px",
              borderRadius: 10,
              fontSize: 17,
              fontWeight: 700,
              fontFamily: "Georgia, serif",
              border: "none",
              cursor: "pointer",
              transition: "all 0.2s ease",
              boxShadow: copied
                ? "0 0 0 3px rgba(74,222,128,0.2), 0 8px 30px rgba(74,222,128,0.15)"
                : "0 0 0 3px rgba(107,127,255,0.15), 0 8px 30px rgba(107,127,255,0.25)",
              transform: copied ? "scale(0.98)" : "scale(1)",
              letterSpacing: "0.01em",
            }}
          >
            {copied ? "✓ Copied to Clipboard!" : "📋 Copy Script"}
          </button>

          <p style={{
            color: "#555",
            fontSize: 12,
            marginTop: 20,
            marginBottom: 0,
            lineHeight: 1.6,
          }}>
            Then paste into the Chrome console on any Claude conversation
          </p>
        </div>

        {/* Steps */}
        <div style={{ marginBottom: 40 }}>
          <p style={{
            color: "#666",
            fontSize: 13,
            marginBottom: 24,
            letterSpacing: "0.05em",
          }}>
            HOW TO USE IT
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {steps.map((step, i) => (
              <div key={i} style={{
                display: "flex",
                gap: 20,
                padding: "16px 20px",
                background: i % 2 === 0 ? "#0d0d1a" : "transparent",
                borderRadius: 8,
                alignItems: "flex-start",
              }}>
                <span style={{
                  fontSize: 22,
                  minWidth: 32,
                  textAlign: "center",
                  marginTop: 0,
                }}>
                  {step.icon}
                </span>
                <div>
                  <div style={{
                    color: "#d4d0cb",
                    fontSize: 14,
                    fontWeight: 600,
                    marginBottom: 4,
                    fontFamily: "Georgia, serif",
                  }}>
                    <span style={{
                      color: "#6b7fff",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.1em",
                      opacity: 0.7,
                      marginRight: 10,
                    }}>
                      {step.num}
                    </span>
                    {step.title}
                  </div>
                  <div style={{ color: "#666", fontSize: 13, lineHeight: 1.6 }}>
                    {step.detail}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Keyboard shortcut hint */}
        <div style={{
          background: "#0d0d1a",
          border: "1px solid #1a1a30",
          borderRadius: 12,
          padding: 24,
          marginBottom: 40,
        }}>
          <p style={{
            color: "#666",
            fontSize: 13,
            marginBottom: 16,
            marginTop: 0,
            letterSpacing: "0.05em",
          }}>
            QUICK REFERENCE — OPEN CONSOLE
          </p>
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "#888", fontSize: 13 }}>Mac (Chrome)</span>
              <div style={{ display: "flex", gap: 6 }}>
                {["⌘ Cmd", "⌥ Option", "J"].map((key, i) => (
                  <span key={i}>
                    <kbd style={{
                      background: "#151525",
                      border: "1px solid #252545",
                      borderRadius: 5,
                      padding: "4px 10px",
                      fontSize: 12,
                      color: "#aaa",
                      fontFamily: "monospace",
                    }}>
                      {key}
                    </kbd>
                    {i < 2 && <span style={{ color: "#444", margin: "0 2px" }}> + </span>}
                  </span>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "#888", fontSize: 13 }}>Windows / Linux</span>
              <kbd style={{
                background: "#151525",
                border: "1px solid #252545",
                borderRadius: 5,
                padding: "4px 10px",
                fontSize: 12,
                color: "#aaa",
                fontFamily: "monospace",
              }}>
                F12
              </kbd>
            </div>
          </div>
        </div>

        {/* Output preview */}
        <div style={{
          background: "#0d0d1a",
          border: "1px solid #1a1a30",
          borderRadius: 12,
          padding: 28,
          marginBottom: 40,
        }}>
          <p style={{ color: "#666", fontSize: 13, marginBottom: 16, marginTop: 0, letterSpacing: "0.05em" }}>
            WHAT THE OUTPUT LOOKS LIKE
          </p>
          <div style={{
            background: "#070710",
            border: "1px solid #151530",
            borderRadius: 8,
            padding: 20,
            fontSize: 13,
            lineHeight: 1.8,
            color: "#888",
            whiteSpace: "pre-wrap",
          }}>
<span style={{color:"#6b7fff"}}># My Conversation Title</span>{"\n\n"}
<span style={{color:"#555"}}>{"> "}Exported from Claude.ai on 4/16/2026, 10:32:00 AM</span>{"\n\n"}
<span style={{color:"#555"}}>---</span>{"\n\n"}
<span style={{color:"#a0c4ff"}}>## 🧑 You</span>{"\n\n"}
<span style={{color:"#ccc"}}>What is the capital of France?</span>{"\n\n"}
<span style={{color:"#555"}}>---</span>{"\n\n"}
<span style={{color:"#a8d8a8"}}>## 🤖 Claude</span>{"\n\n"}
<span style={{color:"#ccc"}}>The capital of France is Paris...</span>
          </div>
        </div>

        {/* View full script */}
        <details style={{
          background: "#0d0d1a",
          border: "1px solid #1a1a30",
          borderRadius: 12,
          padding: 24,
          marginBottom: 40,
        }}>
          <summary style={{
            color: "#666",
            fontSize: 13,
            cursor: "pointer",
            letterSpacing: "0.05em",
            userSelect: "none",
          }}>
            VIEW FULL SCRIPT SOURCE
          </summary>
          <pre style={{
            background: "#070710",
            border: "1px solid #151530",
            borderRadius: 8,
            padding: 16,
            marginTop: 16,
            fontSize: 11,
            lineHeight: 1.6,
            color: "#7a8a7a",
            overflow: "auto",
            maxHeight: 400,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}>
            {consoleCode}
          </pre>
        </details>

        {/* Note */}
        <div style={{
          borderTop: "1px solid #151520",
          paddingTop: 24,
          color: "#444",
          fontSize: 12,
          lineHeight: 1.8,
        }}>
          <strong style={{ color: "#555" }}>Privacy note:</strong> The script runs entirely in your browser. No data is sent anywhere — the .md file goes straight to your Downloads folder. Works on any Claude account you're logged into.
        </div>

      </div>
    </div>
  );
}
