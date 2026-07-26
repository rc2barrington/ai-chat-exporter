import { useState } from "react";
import "./App.css";
import { BrowserChatsTab } from "./components/BrowserChatsTab.jsx";
import { ClaudeCodeTab } from "./components/ClaudeCodeTab.jsx";
import { AntigravityTab } from "./components/AntigravityTab.jsx";

const TABS = [
  { key: "web", label: "🌐 Browser Chats", render: () => <BrowserChatsTab /> },
  { key: "cli", label: "💻 Claude Code", render: () => <ClaudeCodeTab /> },
  { key: "antigravity", label: "✨ Google Antigravity", render: () => <AntigravityTab /> },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("web");
  const active = TABS.find((t) => t.key === activeTab) || TABS[0];

  return (
    <div className="app-container">
      <div className="max-width-wrapper">
        <div style={{ marginBottom: 40, textAlign: "left" }}>
          <div className="header-badge">AI Chat Utility Tool</div>
          <h1 className="title-primary">
            Conversation
            <br />
            <span className="title-highlight">Exporter</span>
          </h1>
          <p className="subtitle">
            Export any web-based AI chat, local Claude Code session, or Google Antigravity transcript as a beautifully formatted Markdown file. 100% private and runs entirely locally.
          </p>
        </div>

        <div className="tab-container">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              className={`tab-button ${activeTab === tab.key ? "active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {active.render()}

        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.05)",
            paddingTop: 24,
            color: "#475569",
            fontSize: 12,
            lineHeight: 1.8,
            textAlign: "center",
          }}
        >
          <strong>Privacy Note:</strong> This application is hosted on GitHub Pages but processes all conversations locally in your browser. No chat history or uploaded file data is sent to any server.
        </div>
      </div>
    </div>
  );
}
