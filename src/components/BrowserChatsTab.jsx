import { useState } from "react";
import { consoleCode } from "../parsers/browserScript.js";
import { copyToClipboard } from "../utils/download.js";

const steps = [
  {
    num: "01",
    title: "Open a chat conversation",
    detail: "Go to chatgpt.com, gemini.google.com, or claude.ai and open any conversation you want to export.",
    icon: "💬",
  },
  {
    num: "02",
    title: "Open the console",
    detail: "Press F12 (or Cmd+Option+J on Mac) to open DevTools, then click the Console tab.",
    icon: "🛠",
  },
  {
    num: "03",
    title: "Paste & run the script",
    detail: 'Click "Copy Script" above, paste into the console with Cmd+V, and press Enter. The .md file downloads instantly.',
    icon: "📥",
  },
];

export function BrowserChatsTab() {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(consoleCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div>
      <div className="card-panel" style={{ border: "1px solid rgba(124, 58, 237, 0.3)", background: "linear-gradient(135deg, rgba(124, 58, 237, 0.05) 0%, rgba(79, 70, 229, 0.05) 100%)", marginBottom: 24 }}>
        <p className="card-title" style={{ color: "#a78bfa", marginBottom: 12 }}>⚡ Chrome Extension (Recommended)</p>
        <div style={{ fontSize: 13, lineHeight: 1.6, color: "#cbd5e1" }}>
          <p style={{ marginBottom: 12, fontWeight: 500 }}>
            Export chat tabs directly from any page without copy-pasting code into the developer console.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, textAlign: "left", background: "rgba(0, 0, 0, 0.2)", padding: 16, borderRadius: 10, border: "1px solid rgba(255, 255, 255, 0.02)", marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 8 }}><span style={{ color: "#a78bfa", fontWeight: 700 }}>1.</span> <span>Open Google Chrome and navigate to <code>chrome://extensions/</code></span></div>
            <div style={{ display: "flex", gap: 8 }}><span style={{ color: "#a78bfa", fontWeight: 700 }}>2.</span> <span>Enable <strong>Developer mode</strong> in the upper right.</span></div>
            <div style={{ display: "flex", gap: 8 }}><span style={{ color: "#a78bfa", fontWeight: 700 }}>3.</span> <span>Click <strong>Load unpacked</strong> and select the <code>chrome-extension/</code> folder in this project directory.</span></div>
          </div>
        </div>
      </div>

      <div className="card-panel" style={{ textAlign: "center" }}>
        <p className="card-title">Or: Copy the Browser Export Script</p>
        <button onClick={handleCopy} className="btn-primary" style={{ marginBottom: 12 }}>
          {copied ? "✓ Copied to Clipboard!" : "📋 Copy Console Script"}
        </button>
        <p style={{ color: "#64748b", fontSize: 13, lineHeight: 1.6, marginTop: 12 }}>
          Pasting this script in your browser console scrolls, dedupes (by element identity, not text prefix), preserves fenced code blocks, and downloads your conversation with a YAML frontmatter header.
        </p>
      </div>

      <div style={{ marginBottom: 32 }}>
        <p className="card-title">How to Use</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {steps.map((step, i) => (
            <div key={i} className="step-item">
              <span className="step-icon">{step.icon}</span>
              <div>
                <div className="step-title">
                  <span className="step-number">{step.num}</span>
                  {step.title}
                </div>
                <div className="step-detail">{step.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card-panel">
        <p className="card-title">Console Shortcuts</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#cbd5e1", fontSize: 14 }}>macOS (Chrome/Firefox/Safari)</span>
            <div style={{ display: "flex", gap: 6 }}>
              {["⌘ Cmd", "⌥ Option", "J"].map((k, idx) => (
                <span key={idx}>
                  <kbd>{k}</kbd>
                  {idx < 2 && <span style={{ color: "#475569", margin: "0 2px" }}>+</span>}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#cbd5e1", fontSize: 14 }}>Windows / Linux</span>
            <kbd>F12</kbd>
          </div>
        </div>
      </div>

      <details className="card-panel" style={{ cursor: "pointer" }}>
        <summary className="card-title" style={{ userSelect: "none" }}>View full script source</summary>
        <pre
          style={{
            background: "#050508",
            border: "1px solid rgba(255,255,255,0.05)",
            borderRadius: 8,
            padding: 16,
            marginTop: 16,
            fontSize: 11,
            lineHeight: 1.6,
            color: "#64748b",
            overflow: "auto",
            maxHeight: 300,
            whiteSpace: "pre-wrap",
            fontFamily: "JetBrains Mono, monospace",
          }}
        >
          {consoleCode}
        </pre>
      </details>
    </div>
  );
}
