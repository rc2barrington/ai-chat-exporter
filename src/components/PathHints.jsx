import { useState } from "react";
import { copyToClipboard } from "../utils/download.js";

export function PathHints({ title, intro, paths }) {
  const [copied, setCopied] = useState("");

  const copy = async (key, value) => {
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopied(key);
      setTimeout(() => setCopied(""), 1800);
    }
  };

  return (
    <div className="card-panel">
      <p className="card-title">{title}</p>
      {intro && (
        <p style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>{intro}</p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {paths.map((p) => (
          <div key={p.label}>
            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600, marginBottom: 6 }}>{p.label}</div>
            <div className="path-box">
              <span className="path-text">{p.value}</span>
              <button className="path-copy-btn" onClick={() => copy(p.label, p.value)}>
                {copied === p.label ? "✓ Copied" : "📋 Copy"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
