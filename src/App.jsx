import { useState, useRef } from "react";
import "./App.css";

// The console snippet for browser export (ChatGPT, Claude.ai, Gemini)
const consoleCode = `// AI Conversation Exporter (Claude, ChatGPT & Gemini)
(async function() {
  var isChatGPT = !!document.querySelector('[data-message-author-role]');
  var isClaude = !!document.querySelector('[data-testid="user-message"]');
  var isGemini = !!document.querySelector('user-query');

  if (!isChatGPT && !isClaude && !isGemini) {
    alert("No messages found. Make sure you're on a Claude.ai, ChatGPT, or Gemini conversation page.");
    return;
  }

  var siteName = isChatGPT ? "ChatGPT" : (isClaude ? "Claude" : "Gemini");
  
  // Find the scroll container
  var scrollEl = document.documentElement;
  var firstMsg;
  if (isChatGPT) firstMsg = document.querySelector('[data-message-author-role]');
  else if (isClaude) firstMsg = document.querySelector('[data-testid="user-message"]');
  else if (isGemini) firstMsg = document.querySelector('user-query');
  
  var p = firstMsg;
  while (p && p.parentElement) {
    p = p.parentElement;
    var style = window.getComputedStyle(p);
    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && p.scrollHeight > p.clientHeight + 100) {
      scrollEl = p;
      break;
    }
  }

  console.log("Scrolling through conversation to load all messages...");
  
  if (scrollEl === document.documentElement) {
    window.scrollTo(0, 0);
  } else {
    scrollEl.scrollTop = 0;
  }
  await new Promise(function(r) { setTimeout(r, 500); });

  // First pass: quick scroll to warm up
  var lastScrollTop = -1;
  var attempts = 0;
  while (attempts < 500) {
    var clientHeight = scrollEl === document.documentElement ? window.innerHeight : scrollEl.clientHeight;
    if (scrollEl === document.documentElement) {
      window.scrollBy(0, clientHeight - 50);
    } else {
      scrollEl.scrollTop += clientHeight - 50;
    }
    await new Promise(function(r) { setTimeout(r, 100); });
    var newScroll = scrollEl === document.documentElement ? window.scrollY : scrollEl.scrollTop;
    if (newScroll === lastScrollTop) break;
    lastScrollTop = newScroll;
    attempts++;
  }

  // Scroll back to top
  if (scrollEl === document.documentElement) {
    window.scrollTo(0, 0);
  } else {
    scrollEl.scrollTop = 0;
  }
  await new Promise(function(r) { setTimeout(r, 500); });

  // Second pass: scroll and capture messages at each position
  lastScrollTop = -1;
  var allMessages = new Map();
  var globalOrder = 0;

  while (true) {
    if (isClaude) {
      var userMsgEls = document.querySelectorAll('[data-testid="user-message"]');
      if (userMsgEls.length > 0) {
        var container = null;
        var el = userMsgEls[0];
        var depth = 0;
        while (el.parentElement) {
          el = el.parentElement;
          depth++;
          if (el.children.length > 3 && depth >= 4) { container = el; break; }
        }
        if (container) {
          for (var i = 0; i < container.children.length; i++) {
            var child = container.children[i];
            var text = (child.innerText || "").trim();
            if (!text) continue;
            var key = text.slice(0, 150);
            if (!allMessages.has(key)) {
              var userMsg = child.querySelector('[data-testid="user-message"]');
              if (userMsg) {
                allMessages.set(key, { role: "## You", content: userMsg.innerText.trim(), order: globalOrder++ });
              } else {
                allMessages.set(key, { role: "## Claude", content: text, order: globalOrder++ });
              }
            }
          }
        }
      }
    } else if (isChatGPT) {
      var msgEls = document.querySelectorAll('[data-message-author-role]');
      msgEls.forEach(function(el) {
        var text = (el.innerText || "").trim();
        if (!text) return;
        var roleAttr = el.getAttribute('data-message-author-role');
        var role = roleAttr === 'user' ? "## You" : "## ChatGPT";
        var key = text.slice(0, 150);
        if (!allMessages.has(key)) {
          allMessages.set(key, { role: role, content: text, order: globalOrder++ });
        }
      });
    } else if (isGemini) {
      var msgEls = document.querySelectorAll('user-query, model-response');
      msgEls.forEach(function(el) {
        var text = (el.innerText || "").trim();
        if (!text) return;
        var role = el.tagName.toLowerCase() === 'user-query' ? "## You" : "## Gemini";
        var key = text.slice(0, 150);
        if (!allMessages.has(key)) {
          allMessages.set(key, { role: role, content: text, order: globalOrder++ });
        }
      });
    }

    var clientHeight = scrollEl === document.documentElement ? window.innerHeight : scrollEl.clientHeight;
    if (scrollEl === document.documentElement) {
      window.scrollBy(0, clientHeight - 50);
    } else {
      scrollEl.scrollTop += clientHeight - 50;
    }
    
    await new Promise(function(r) { setTimeout(r, 200); });
    var newScroll = scrollEl === document.documentElement ? window.scrollY : scrollEl.scrollTop;
    if (newScroll === lastScrollTop) break;
    lastScrollTop = newScroll;
  }

  var messages = Array.from(allMessages.values());
  messages.sort(function(a, b) { return a.order - b.order; });

  if (!messages.length) {
    alert("No messages found.");
    return;
  }

  console.log("Found " + messages.length + " messages");

  // Step 4: Build markdown and download
  var title = document.title.replace(/[-|].*(Claude|ChatGPT|Gemini).*/i, "").trim() || (siteName + " Conversation");
  var date = new Date().toLocaleString();
  var nl = String.fromCharCode(10);
  var md = "# " + title + nl + nl;
  md += "> Exported from " + siteName + " on " + date + nl + nl;
  md += "---" + nl + nl;
  messages.forEach(function(msg, i) {
    md += msg.role + nl + nl + msg.content + nl + nl;
    if (i < messages.length - 1) md += "---" + nl + nl;
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
  console.log("Exported " + messages.length + " messages: " + a.download);
})();`;

const steps = [
  {
    num: "01",
    title: "Open a Chat conversation",
    detail: "Go to chatgpt.com, gemini.google.com, or claude.ai and open any conversation you want to export.",
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
    detail: 'Click the "Copy Script" button above, paste into the console with Cmd+V, and press Enter. The .md file downloads instantly.',
    icon: "📥",
  },
];

const parseClaudeCodeJsonl = (fileContent) => {
  const lines = fileContent.split("\n");
  const messages = [];
  let title = "";
  let date = "";
  let currentRequestId = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === "ai-title" && obj.aiTitle) {
        title = obj.aiTitle;
      }
      if (obj.timestamp && !date) {
        date = new Date(obj.timestamp).toLocaleString();
      }

      if (obj.type === "user") {
        currentRequestId = null; // reset for new user msg
        const content = obj.message?.content;
        let text = "";
        if (typeof content === "string") {
          text = content;
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text") {
              text += block.text;
            }
          }
        }
        if (text.trim()) {
          messages.push({
            role: "## You",
            blocks: [{ type: "text", text: text.trim() }],
            timestamp: obj.timestamp,
          });
        }
      } else if (obj.type === "assistant") {
        const content = obj.message?.content;
        const blocks = [];
        if (typeof content === "string") {
          blocks.push({ type: "text", text: content });
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text") {
              blocks.push({ type: "text", text: block.text });
            } else if (block.type === "thinking") {
              blocks.push({ type: "thinking", thinking: block.thinking });
            } else if (block.type === "tool_use") {
              blocks.push({ type: "tool_use", name: block.name, input: block.input });
            }
          }
        }
        if (blocks.length > 0) {
          if (currentRequestId && currentRequestId === obj.requestId && messages.length > 0 && messages[messages.length - 1].role === "## Claude") {
            // merge into last message
            messages[messages.length - 1].blocks.push(...blocks);
            messages[messages.length - 1].timestamp = obj.timestamp;
          } else {
            messages.push({
              role: "## Claude",
              blocks: blocks,
              timestamp: obj.timestamp,
              requestId: obj.requestId
            });
            currentRequestId = obj.requestId;
          }
        }
      }
    } catch {
      // Ignore parse errors on individual malformed lines
    }
  }

  if (!title) title = "Claude Desktop Session";
  return { title, date, messages };
};

const generateMarkdown = (session, includeThinking, includeTools) => {
  const nl = "\n";
  let md = `# ${session.title}${nl}${nl}`;
  if (session.date) {
    md += `> Exported from Claude Desktop on ${session.date}${nl}${nl}`;
  } else {
    md += `> Exported from Claude Desktop${nl}${nl}`;
  }
  md += `---${nl}${nl}`;

  const validMessages = [];
  session.messages.forEach((msg) => {
    let content = "";
    if (msg.role === "## You") {
      content = msg.blocks.map(b => b.text).join('\n').trim();
    } else {
      content = msg.blocks
        .map((block) => {
          if (block.type === "text") {
            return block.text;
          } else if (block.type === "thinking" && includeThinking) {
            return `<details>\n<summary>Thinking Process</summary>\n\n${block.thinking}\n\n</details>`;
          } else if (block.type === "tool_use" && includeTools) {
            return `\n**Tool Use: \`${block.name}\`**\n\`\`\`json\n${JSON.stringify(block.input, null, 2)}\n\`\`\``;
          }
          return "";
        })
        .filter(Boolean)
        .join("\n\n")
        .trim();
    }

    if (content) {
      validMessages.push({ role: msg.role, content });
    }
  });

  validMessages.forEach((msg, idx) => {
    md += `${msg.role}${nl}${nl}${msg.content}${nl}${nl}`;
    if (idx < validMessages.length - 1) {
      md += `---${nl}${nl}`;
    }
  });

  return md;
};

export default function App() {
  const [activeTab, setActiveTab] = useState("web"); // 'web' | 'cli'
  const [copied, setCopied] = useState(false);
  const [cliCopied, setCliCopied] = useState("");

  // CLI Exporter State
  const [includeThinking, setIncludeThinking] = useState(true);
  const [includeTools, setIncludeTools] = useState(false);
  const [parsedSession, setParsedSession] = useState(null);
  const [availableSessions, setAvailableSessions] = useState([]);
  const [selectedSessions, setSelectedSessions] = useState(new Set());
  const [dragActive, setDragActive] = useState(false);
  const [parseError, setParseError] = useState("");

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(consoleCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleCliPathCopy = (path, name) => {
    navigator.clipboard.writeText(path);
    setCliCopied(name);
    setTimeout(() => setCliCopied(""), 2000);
  };

  // Drag and Drop Handling
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const processFiles = async (files) => {
    if (!files || files.length === 0) return;
    
    setParseError("");
    const validFiles = Array.from(files).filter(f => f.name.endsWith('.jsonl') || f.name.endsWith('.json'));
    
    if (validFiles.length === 0) {
      setParseError("No valid .jsonl or .json session files found.");
      return;
    }

    if (validFiles.length === 1) {
      // Single file upload mode
      const file = validFiles[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        const parsed = parseClaudeCodeJsonl(text);
        if (!parsed.messages || parsed.messages.length === 0) {
          setParseError("No valid chat messages found in this session file.");
          setParsedSession(null);
        } else {
          setParsedSession({ ...parsed, fileName: file.name });
          setAvailableSessions([]);
        }
      };
      reader.onerror = () => {
        setParseError("Error reading the session file.");
        setParsedSession(null);
      };
      reader.readAsText(file);
      return;
    }

    // Multiple files (folder upload)
    const sessions = [];
    const readPromises = validFiles.map(file => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const text = e.target.result;
          const parsed = parseClaudeCodeJsonl(text);
          if (parsed.messages && parsed.messages.length > 0) {
            sessions.push({ ...parsed, fileName: file.name });
          }
          resolve();
        };
        reader.onerror = () => resolve();
        reader.readAsText(file);
      });
    });

    await Promise.all(readPromises);
    
    // Sort sessions by date (newest first)
    sessions.sort((a, b) => {
      const dateA = new Date(a.date || 0).getTime();
      const dateB = new Date(b.date || 0).getTime();
      return dateB - dateA;
    });

    if (sessions.length === 0) {
      setParseError("No valid chat messages found in any of the files.");
    } else {
      setAvailableSessions(sessions);
      setSelectedSessions(new Set()); // Reset selections
      setParsedSession(null);
    }
  };

  const getAllFiles = async (dataTransferItemList) => {
    const filePromises = [];
    for (let i = 0; i < dataTransferItemList.length; i++) {
      const item = dataTransferItemList[i];
      if (item.kind === "file") {
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
        if (entry) {
          filePromises.push(scanEntry(entry));
        } else {
          filePromises.push(Promise.resolve([item.getAsFile()]));
        }
      }
    }
    const nestedFiles = await Promise.all(filePromises);
    return nestedFiles.reduce((acc, val) => acc.concat(val), []);
  };

  const scanEntry = (entry) => {
    return new Promise((resolve) => {
      if (entry.isFile) {
        entry.file(file => resolve([file]), () => resolve([]));
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const allFiles = [];
        const readEntries = () => {
          dirReader.readEntries(async (entries) => {
            if (entries.length === 0) {
              resolve(allFiles);
            } else {
              const promises = entries.map(e => scanEntry(e));
              const files = await Promise.all(promises);
              allFiles.push(...files.reduce((a, b) => a.concat(b), []));
              readEntries();
            }
          }, () => resolve([]));
        };
        readEntries();
      } else {
        resolve([]);
      }
    });
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.items) {
      const files = await getAllFiles(e.dataTransfer.items);
      if (files.length > 0) {
        processFiles(files);
      }
    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
  };

  const downloadSingleSession = (session) => {
    const md = generateMarkdown(session, includeThinking, includeTools);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    
    const sanitizedTitle = session.title
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 60);
    a.download = `${sanitizedTitle || "claude-desktop-export"}.md`;
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const handleDownload = () => {
    if (parsedSession) {
      downloadSingleSession(parsedSession);
    }
  };

  const handleBulkDownload = async () => {
    if (selectedSessions.size === 0) return;
    const selectedArray = availableSessions.filter((_, idx) => selectedSessions.has(idx));
    for (const session of selectedArray) {
      downloadSingleSession(session);
      await new Promise(r => setTimeout(r, 200)); // Small delay to prevent browser blocking
    }
  };

  const toggleSessionSelection = (idx, e) => {
    e.stopPropagation();
    const newSelected = new Set(selectedSessions);
    if (newSelected.has(idx)) {
      newSelected.delete(idx);
    } else {
      newSelected.add(idx);
    }
    setSelectedSessions(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedSessions.size === availableSessions.length) {
      setSelectedSessions(new Set());
    } else {
      const allIds = new Set(availableSessions.map((_, i) => i));
      setSelectedSessions(allIds);
    }
  };

  return (
    <div className="app-container">
      <div className="max-width-wrapper">
        
        {/* Header */}
        <div style={{ marginBottom: 40, textAlign: "left" }}>
          <div className="header-badge">AI Chat Utility Tool</div>
          <h1 className="title-primary">
            Conversation<br />
            <span className="title-highlight">Exporter</span>
          </h1>
          <p className="subtitle">
            Export any web-based AI chat or local Claude Desktop App session as a beautifully formatted Markdown file. 100% private and runs entirely locally.
          </p>
        </div>

        {/* Tab Selector */}
        <div className="tab-container">
          <button 
            className={`tab-button ${activeTab === "web" ? "active" : ""}`}
            onClick={() => setActiveTab("web")}
          >
            🌐 Browser Chats
          </button>
          <button 
            className={`tab-button ${activeTab === "cli" ? "active" : ""}`}
            onClick={() => setActiveTab("cli")}
          >
            💻 Claude Desktop App
          </button>
        </div>

        {/* ==================== BROWSER CHATS TAB ==================== */}
        {activeTab === "web" && (
          <div>
            <div className="card-panel" style={{ textAlign: "center" }}>
              <p className="card-title">Copy the Browser Export Script</p>
              
              <button
                onClick={handleCopy}
                className="btn-primary"
                style={{ marginBottom: 12 }}
              >
                {copied ? "✓ Copied to Clipboard!" : "📋 Copy Console Script"}
              </button>

              <p style={{ color: "#64748b", fontSize: 13, lineHeight: 1.6, marginTop: 12 }}>
                Pasting this script in your browser console automatically scrolls, bundles, and downloads your active conversation.
              </p>
            </div>

            {/* How to use */}
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

            {/* Shortcut hints */}
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

            {/* Console source toggle */}
            <details className="card-panel" style={{ cursor: "pointer" }}>
              <summary className="card-title" style={{ userSelect: "none" }}>View full script source</summary>
              <pre style={{
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
                fontFamily: "JetBrains Mono, monospace"
              }}>
                {consoleCode}
              </pre>
            </details>
          </div>
        )}

        {/* ==================== CLAUDE DESKTOP APP TAB ==================== */}
        {activeTab === "cli" && (
          <div>
            {/* Guide */}
            <div className="card-panel">
              <p className="card-title">Where to Find Your Session Files</p>
              <p style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
                Claude Desktop App stores your project transcripts as local <code style={{ color: "#a78bfa" }}>.jsonl</code> files. Copy the path below and use <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>G</kbd> (Mac) in the file upload window to jump straight to it.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <div style={{ fontSize: 12, color: "#64748b", fontWeight: "600", marginBottom: 6 }}>macOS</div>
                  <div className="path-box">
                    <span className="path-text">~/.claude/projects/</span>
                    <button 
                      className="path-copy-btn" 
                      onClick={() => handleCliPathCopy("~/.claude/projects/", "mac")}
                    >
                      {cliCopied === "mac" ? "✓ Copied" : "📋 Copy"}
                    </button>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 12, color: "#64748b", fontWeight: "600", marginBottom: 6 }}>Linux</div>
                  <div className="path-box">
                    <span className="path-text">~/.claude/projects/</span>
                    <button 
                      className="path-copy-btn" 
                      onClick={() => handleCliPathCopy("~/.claude/projects/", "linux")}
                    >
                      {cliCopied === "linux" ? "✓ Copied" : "📋 Copy"}
                    </button>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 12, color: "#64748b", fontWeight: "600", marginBottom: 6 }}>Windows</div>
                  <div className="path-box">
                    <span className="path-text">explorer %USERPROFILE%\.claude\projects\</span>
                    <button 
                      className="path-copy-btn" 
                      onClick={() => handleCliPathCopy("explorer %USERPROFILE%\\.claude\\projects\\", "win")}
                    >
                      {cliCopied === "win" ? "✓ Copied" : "📋 Copy"}
                    </button>
                  </div>
                </div>
              </div>
              <p style={{ color: "#64748b", fontSize: 12, marginTop: 16, lineHeight: 1.5 }}>
                💡 <em>Tip: Each project has a subfolder. Inside, you'll find session files named like <code style={{ color: "#475569" }}>a2fc-c759...jsonl</code>. Upload the file corresponding to the chat session you wish to export.</em>
              </p>
            </div>

            {/* Config & Dropzone */}
            <div className="card-panel">
              <p className="card-title">Export Settings</p>
              
              <div className="config-group">
                <div className="config-item">
                  <div className="config-info">
                    <span className="config-label">Include Thinking Logs</span>
                    <span className="config-subtext">Exports Claude's internal reasoning inside a collapsible element</span>
                  </div>
                  <label className="switch">
                    <input 
                      type="checkbox" 
                      checked={includeThinking}
                      onChange={(e) => setIncludeThinking(e.target.checked)} 
                    />
                    <span className="slider"></span>
                  </label>
                </div>

                <div className="config-item">
                  <div className="config-info">
                    <span className="config-label">Include Tool Executions</span>
                    <span className="config-subtext">Exports terminal command runs, file edits, and tool results</span>
                  </div>
                  <label className="switch">
                    <input 
                      type="checkbox" 
                      checked={includeTools}
                      onChange={(e) => setIncludeTools(e.target.checked)} 
                    />
                    <span className="slider"></span>
                  </label>
                </div>
              </div>

              {/* Drag Zone */}
              {!parsedSession && availableSessions.length === 0 && (
                <div 
                  className={`dropzone ${dragActive ? "active" : ""}`}
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                >
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    style={{ display: "none" }} 
                    accept=".jsonl,.json" 
                    multiple
                    onChange={handleFileChange}
                  />
                  <input 
                    type="file" 
                    ref={folderInputRef}
                    style={{ display: "none" }} 
                    webkitdirectory="true"
                    directory="true"
                    onChange={handleFileChange}
                  />
                  <span className="dropzone-icon">📥</span>
                  <span className="dropzone-title">
                    Drag & drop your Claude Desktop session file(s) here
                  </span>
                  <span className="dropzone-desc">Supports .jsonl and .json files.</span>
                  <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 20 }}>
                    <button 
                      className="btn-primary" 
                      onClick={(e) => { e.stopPropagation(); fileInputRef.current.click(); }}
                      style={{ padding: "10px 20px", fontSize: 13 }}
                    >
                      Browse Files
                    </button>
                    <button 
                      className="btn-primary" 
                      onClick={(e) => { e.stopPropagation(); folderInputRef.current.click(); }}
                      style={{ padding: "10px 20px", fontSize: 13, background: "#6366f1" }}
                    >
                      📁 Scan Projects Folder
                    </button>
                  </div>
                </div>
              )}

              {/* Sessions List */}
              {!parsedSession && availableSessions.length > 0 && (
                <div className="sessions-list" style={{ animation: "fadeIn 0.3s ease", marginTop: 24 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h3 style={{ color: "#f8fafc", margin: 0, display: "flex", alignItems: "center", gap: 12 }}>
                      Found {availableSessions.length} Sessions
                      <button 
                        onClick={toggleSelectAll}
                        style={{ fontSize: 12, padding: "4px 8px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#94a3b8", borderRadius: 4, cursor: "pointer" }}
                      >
                        {selectedSessions.size === availableSessions.length ? "Deselect All" : "Select All"}
                      </button>
                    </h3>
                    <div style={{ display: "flex", gap: 8 }}>
                      {selectedSessions.size > 0 && (
                        <button 
                          className="btn-primary btn-success"
                          onClick={handleBulkDownload}
                          style={{ fontSize: 13, padding: "8px 16px" }}
                        >
                          💾 Download {selectedSessions.size} Files
                        </button>
                      )}
                      <button 
                        className="btn-secondary"
                        onClick={() => { setAvailableSessions([]); setSelectedSessions(new Set()); }}
                        style={{ fontSize: 13, padding: "8px 16px", background: "rgba(255,255,255,0.1)", border: "none", color: "#e2e8f0", borderRadius: 6, cursor: "pointer" }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 400, overflowY: "auto", paddingRight: 8 }}>
                    {availableSessions.map((sess, idx) => (
                      <div 
                        key={idx} 
                        className="session-list-item"
                        onClick={() => setParsedSession(sess)}
                        style={{ 
                          display: "flex",
                          alignItems: "center",
                          gap: 16,
                          background: "rgba(255,255,255,0.03)", 
                          border: "1px solid rgba(255,255,255,0.06)", 
                          padding: "12px 16px", 
                          borderRadius: 8, 
                          cursor: "pointer",
                          transition: "background 0.2s"
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}
                        onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
                      >
                        <input 
                          type="checkbox"
                          checked={selectedSessions.has(idx)}
                          onChange={(e) => toggleSessionSelection(idx, e)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ width: 18, height: 18, cursor: "pointer", accentColor: "#6366f1" }}
                        />
                        <div style={{ flex: 1 }}>
                          <h4 style={{ margin: "0 0 6px", color: "#e2e8f0", fontSize: 15 }}>{sess.title}</h4>
                          <div style={{ fontSize: 12, color: "#94a3b8", display: "flex", gap: 12 }}>
                            <span>📅 {sess.date || "Unknown date"}</span>
                            <span>💬 {sess.messages.length} messages</span>
                            <span style={{ color: "#475569" }}>📄 {sess.fileName}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {parseError && (
                <div style={{ color: "#ef4444", fontSize: 13, marginTop: 14, textAlign: "center", fontWeight: 500 }}>
                  ⚠️ {parseError}
                </div>
              )}
            </div>

            {/* File Processed State */}
            {parsedSession && (
              <div style={{ animation: "fadeIn 0.4s ease" }}>
                
                {/* Meta details card */}
                <div className="card-panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 20 }}>
                  <div>
                    <h3 style={{ fontSize: 18, fontWeight: 700, color: "#f8fafc", margin: "0 0 4px" }}>
                      {parsedSession.title}
                    </h3>
                    <div style={{ fontSize: 13, color: "#64748b" }}>
                      <span>📄 {parsedSession.fileName}</span>
                      <span style={{ margin: "0 8px" }}>•</span>
                      <span>💬 {parsedSession.messages.length} messages</span>
                      {parsedSession.date && (
                        <>
                          <span style={{ margin: "0 8px" }}>•</span>
                          <span>📅 {parsedSession.date}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 12 }}>
                    {availableSessions.length > 0 ? (
                      <button onClick={() => setParsedSession(null)} className="btn-secondary" style={{ padding: "10px 16px", background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
                        ← Back to List
                      </button>
                    ) : (
                      <button onClick={() => setParsedSession(null)} className="btn-secondary" style={{ padding: "10px 16px", background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
                        Change File
                      </button>
                    )}
                    <button onClick={handleDownload} className="btn-primary btn-success">
                      💾 Download Markdown
                    </button>
                  </div>
                </div>

                {/* Conversation Preview */}
                <div style={{ marginBottom: 40 }}>
                  <p className="card-title">Live Preview</p>
                  
                  <div className="preview-window">
                    <div className="preview-header">
                      <div>
                        <span className="preview-dot" style={{ backgroundColor: "#ef4444" }}></span>
                        <span className="preview-dot" style={{ backgroundColor: "#f59e0b" }}></span>
                        <span className="preview-dot" style={{ backgroundColor: "#10b981" }}></span>
                      </div>
                      <span className="preview-title">{parsedSession.title}.md</span>
                      <span style={{ width: 42 }}></span>
                    </div>

                    <div className="preview-body">
                      {/* Top Header of Markdown */}
                      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: 16, marginBottom: 24 }}>
                        <h2 style={{ fontSize: 20, fontWeight: 800, color: "#ffffff", marginBottom: 8 }}># {parsedSession.title}</h2>
                        <div style={{ color: "#64748b", fontStyle: "italic", fontSize: 12 }}>
                          {parsedSession.date ? `> Exported from Claude Desktop on ${parsedSession.date}` : `> Exported from Claude Desktop`}
                        </div>
                      </div>

                      {/* Message lists */}
                      {parsedSession.messages.map((msg, idx) => {
                        const isUser = msg.role === "## You";
                        
                        // Parse content blocks dynamically
                        const renderedBlocks = isUser 
                          ? msg.blocks 
                          : msg.blocks.filter(b => {
                              if (b.type === "thinking" && !includeThinking) return false;
                              if (b.type === "tool_use" && !includeTools) return false;
                              return true;
                            });

                        if (renderedBlocks.length === 0) return null;

                        return (
                          <div key={idx} className={`preview-chat-bubble ${isUser ? "user" : "assistant"}`}>
                            <div className="bubble-role">{isUser ? "🧑 You" : "🤖 Claude"}</div>
                            
                            {renderedBlocks.map((block, bIdx) => {
                              if (block.type === "text") {
                                return <div key={bIdx} className="bubble-content">{block.text}</div>;
                              }
                              
                              if (block.type === "thinking") {
                                return (
                                  <details key={bIdx} className="preview-thinking" open>
                                    <summary>Thinking Process</summary>
                                    <pre>{block.thinking}</pre>
                                  </details>
                                );
                              }

                              if (block.type === "tool_use") {
                                return (
                                  <div key={bIdx} className="preview-tool-use">
                                    <div className="tool-name">🛠 Tool Executed: {block.name}</div>
                                    <pre className="tool-payload">{JSON.stringify(block.input, null, 2)}</pre>
                                  </div>
                                );
                              }

                              return null;
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

              </div>
            )}
          </div>
        )}

        {/* Footer Note */}
        <div style={{
          borderTop: "1px solid rgba(255,255,255,0.05)",
          paddingTop: 24,
          color: "#475569",
          fontSize: 12,
          lineHeight: 1.8,
          textAlign: "center"
        }}>
          <strong>Privacy Note:</strong> This application is hosted on GitHub Pages but processes all conversations locally in your browser. Absolutely no chat history or uploaded file data is sent to external servers or tracked.
        </div>

      </div>
    </div>
  );
}
