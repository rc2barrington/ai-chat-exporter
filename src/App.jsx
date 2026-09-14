import { useState } from "react";
import "./App.css";
import { BrowserSetup } from "./components/BrowserSetup.jsx";
import { ExportWorkspace } from "./components/ExportWorkspace.jsx";
import { EDITION, VERSION, localSources, SOURCE_NAMES } from "./edition.js";

const sources = [
  { id: "browser", icon: "◎", name: "Browser chats", detail: "ChatGPT, Gemini, Claude & more" },
  ...localSources().map(id => ({ id, icon: "›_", name: SOURCE_NAMES[id], detail: "Saved conversations on this computer" })),
];
export default function App() {
  const initial = new URLSearchParams(location.search).get("source");
  const [source, setSource] = useState(sources.some(s => s.id === initial) ? initial : "browser");
  const active = sources.find(s => s.id === source);
  return <div className="app-shell">
    <header className="site-header"><a className="brand" href="./"><span className="brand-icon">↓</span>AI Chat Exporter<span className="version">{VERSION} · {EDITION}</span></a>{EDITION === "public" && <a className="github-link" href="https://github.com/rc2barrington/ai-chat-exporter">View on GitHub ↗</a>}</header>
    <div className="app-layout">
      <aside className="source-sidebar"><span className="eyebrow">1 · Choose a source</span><nav aria-label="Conversation source">{sources.map(s => <button key={s.id} className={source === s.id ? "source active" : "source"} aria-pressed={source === s.id} onClick={() => setSource(s.id)}><span className="source-icon">{s.icon}</span><span><strong>{s.name}</strong><small>{s.detail}</small></span>{source === s.id && <span className="active-dot" />}</button>)}</nav>
        <div className="privacy-card"><span className="privacy-dot" /><strong>Private by design</strong><p>Your conversations stay on your computer. No sign-up, uploads to our servers, or usage tracking.</p></div>
        <a className="sidebar-help" href={`https://github.com/rc2barrington/ai-chat-exporter${EDITION === "private" ? "-private" : ""}/issues`}>Report a problem ↗</a>
      </aside>
      <main><div className="page-heading"><h1>{source === "browser" ? "Export browser chats" : `Export ${active.name} chats`}</h1><p>{source === "browser" ? "Save conversations and attachments as Markdown." : "Find a conversation by its name, select it, and export."}</p></div>
        {source === "browser" ? <BrowserSetup /> : <ExportWorkspace key={source} source={source} />}
        <footer>AI Chat Exporter <span>·</span> Made to keep your conversations yours.</footer>
      </main>
    </div>
  </div>;
}
