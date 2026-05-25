import { useMemo } from "react";
import { renderMarkdown } from "../utils/markdownRender.js";

// Renders a single parsed session as the macOS-style live preview window.
// Text content is run through marked + DOMPurify so fenced code, lists,
// and inline formatting look right instead of as plain strings.
export function SessionPreview({ session, includeThinking, includeTools, includeResults }) {
  const items = useMemo(() => {
    return session.messages.map((msg) => {
      const isUser = msg.role === "## You";
      const blocks = isUser
        ? msg.blocks
        : msg.blocks.filter((b) => {
            if (b.type === "thinking") return includeThinking;
            if (b.type === "tool_use") return includeTools;
            if (b.type === "tool_result") return includeTools && includeResults;
            return true;
          });
      return { isUser, blocks, role: msg.role };
    }).filter((m) => m.blocks.length > 0);
  }, [session, includeThinking, includeTools, includeResults]);

  return (
    <div className="preview-window">
      <div className="preview-header">
        <div>
          <span className="preview-dot" style={{ backgroundColor: "#ef4444" }}></span>
          <span className="preview-dot" style={{ backgroundColor: "#f59e0b" }}></span>
          <span className="preview-dot" style={{ backgroundColor: "#10b981" }}></span>
        </div>
        <span className="preview-title">{session.title}.md</span>
        <span style={{ width: 42 }}></span>
      </div>

      <div className="preview-body">
        <div style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: 16, marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#ffffff", marginBottom: 8 }}># {session.title}</h2>
          <div style={{ color: "#64748b", fontStyle: "italic", fontSize: 12 }}>
            {session.date
              ? `> Exported from ${session.source || "Claude Desktop"} on ${session.date}`
              : `> Exported from ${session.source || "Claude Desktop"}`}
          </div>
        </div>

        {items.map((m, idx) => {
          const roleLabel = m.isUser ? "🧑 You" : roleEmojiFor(session.source) + " " + roleNameFor(session.source);
          return (
            <div key={idx} className={`preview-chat-bubble ${m.isUser ? "user" : "assistant"}`}>
              <div className="bubble-role">{roleLabel}</div>
              {m.blocks.map((block, bIdx) => {
                if (block.type === "text") {
                  return (
                    <div
                      key={bIdx}
                      className="bubble-content markdown-body"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(block.text) }}
                    />
                  );
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
                if (block.type === "tool_result") {
                  return (
                    <div key={bIdx} className="preview-tool-use" style={block.is_error ? { borderColor: "#ef4444" } : null}>
                      <div className="tool-name">{block.is_error ? "⚠ Tool Error" : "✓ Tool Result"}</div>
                      <pre className="tool-payload">{String(block.content || "")}</pre>
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
  );
}

function roleNameFor(source) {
  if (source === "Google Antigravity") return "Antigravity";
  return "Claude";
}
function roleEmojiFor(source) {
  if (source === "Google Antigravity") return "✨";
  return "🤖";
}
