// Parses Claude Desktop App (and Claude Code) .jsonl session files.
//
// Each line is a JSON object. Known top-level shapes:
//   { type: "ai-title", aiTitle: string }
//   { type: "user", message: { content: string | block[] }, timestamp }
//   { type: "assistant", message: { content: block[] }, timestamp, requestId }
//
// Block types we render: text, thinking, tool_use, tool_result.

export function parseClaudeCodeJsonl(fileContent) {
  const lines = fileContent.split("\n");
  const messages = [];
  let title = "";
  let firstTimestamp = null;
  let lastTimestamp = null;
  let currentRequestId = null;

  const noteTimestamp = (ts) => {
    if (!ts) return;
    const t = new Date(ts).getTime();
    if (Number.isNaN(t)) return;
    if (firstTimestamp == null || t < firstTimestamp) firstTimestamp = t;
    if (lastTimestamp == null || t > lastTimestamp) lastTimestamp = t;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj.type === "ai-title" && obj.aiTitle) title = obj.aiTitle;
    noteTimestamp(obj.timestamp);

    if (obj.type === "user") {
      currentRequestId = null;
      const content = obj.message?.content;
      let text = "";
      const toolResults = [];
      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text) {
            text += block.text;
          } else if (block.type === "tool_result") {
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.tool_use_id,
              content: normalizeToolResultContent(block.content),
              is_error: Boolean(block.is_error),
            });
          }
        }
      }
      // tool_result blocks come back inside the "user" turn but represent
      // tool output, not user typing. Attach them to the prior assistant turn.
      if (toolResults.length && messages.length > 0) {
        const prev = messages[messages.length - 1];
        if (prev.role === "## Claude") {
          prev.blocks.push(...toolResults);
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
          if (block.type === "text" && block.text) {
            blocks.push({ type: "text", text: block.text });
          } else if (block.type === "thinking" && block.thinking) {
            blocks.push({ type: "thinking", thinking: block.thinking });
          } else if (block.type === "tool_use") {
            blocks.push({
              type: "tool_use",
              id: block.id,
              name: block.name,
              input: block.input,
            });
          }
        }
      }
      if (blocks.length > 0) {
        const last = messages[messages.length - 1];
        if (
          currentRequestId &&
          currentRequestId === obj.requestId &&
          last &&
          last.role === "## Claude"
        ) {
          last.blocks.push(...blocks);
          last.timestamp = obj.timestamp;
        } else {
          messages.push({
            role: "## Claude",
            blocks,
            timestamp: obj.timestamp,
            requestId: obj.requestId,
          });
          currentRequestId = obj.requestId;
        }
      }
    }
  }

  if (!title) title = "Claude Desktop Session";

  const startedAt = firstTimestamp ? new Date(firstTimestamp).toISOString() : "";
  const endedAt = lastTimestamp ? new Date(lastTimestamp).toISOString() : "";
  const date = startedAt ? new Date(startedAt).toLocaleString() : "";

  return {
    title,
    date,
    startedAt,
    endedAt,
    messages,
    source: "Claude Desktop",
  };
}

function normalizeToolResultContent(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === "string") return b;
        if (b && b.type === "text") return b.text || "";
        return "";
      })
      .join("\n");
  }
  return JSON.stringify(content);
}
