// Parses Claude Code .jsonl session files.
//
// Each line is a JSON object. Types seen in the wild:
//   { type: "ai-title", aiTitle }        auto-generated session title
//   { type: "custom-title", customTitle } user-set title (wins over ai-title)
//   { type: "user", message: { content: string | block[] }, uuid, parentUuid }
//   { type: "assistant", message: { content: block[] }, requestId, uuid, ... }
//   plus bookkeeping lines we ignore: queue-operation, last-prompt, mode,
//   system, attachment, pr-link.
//
// Two structural facts drive this parser:
//
//   1. The transcript is a FOREST, not a list. Editing or retrying a message
//      forks a new branch and both branches stay in the file, so reading
//      linearly emits messages the user rewrote. A single file also holds
//      several independent root chains (resuming or clearing a session
//      starts a new root), so following one chain back from the newest leaf
//      would throw away whole conversation segments. We therefore keep
//      everything except the subtrees that are provably superseded: at each
//      fork, only the branch containing the newest activity survives.
//
//   2. Subagent (Task tool) transcripts are inlined with isSidechain: true.
//      They interleave with the main conversation and must not be treated
//      as the user talking.
//
// Block types we render: text, thinking, tool_use, tool_result.

export function parseClaudeCodeJsonl(fileContent) {
  const rows = [];
  for (const line of fileContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // A truncated final line is normal while a session is still live.
      continue;
    }
  }

  const superseded = findSupersededNodes(rows);

  const messages = [];
  let aiTitle = "";
  let customTitle = "";
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

  for (const obj of rows) {
    if (obj.type === "ai-title" && obj.aiTitle) aiTitle = obj.aiTitle;
    if (obj.type === "custom-title" && obj.customTitle) customTitle = obj.customTitle;

    if (obj.type !== "user" && obj.type !== "assistant") continue;

    // Drop messages the user rewrote: an edit or retry forks the log and
    // leaves the original branch behind.
    if (obj.uuid && superseded.has(obj.uuid)) continue;

    // Subagent transcripts are inlined in the same file; they are not the
    // user speaking and would interleave with the real conversation.
    if (obj.isSidechain) continue;

    // Injected context (system reminders, hook output) rides in on a user
    // line but was never typed by anyone.
    if (obj.isMeta) continue;

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
      const cleaned = cleanUserText(text);
      if (cleaned) {
        messages.push({
          role: "## You",
          blocks: [{ type: "text", text: cleaned }],
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
          } else if (block.type === "thinking" && (block.thinking || "").trim()) {
            // Encrypted thinking arrives as a signature with no text; skip it.
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

  const title = customTitle || aiTitle || "Claude Code Session";

  const startedAt = firstTimestamp ? new Date(firstTimestamp).toISOString() : "";
  const endedAt = lastTimestamp ? new Date(lastTimestamp).toISOString() : "";
  const date = startedAt ? new Date(startedAt).toLocaleString() : "";

  return {
    title,
    date,
    startedAt,
    endedAt,
    messages,
    source: "Claude Code",
  };
}

// Returns the set of uuids belonging to abandoned branches: at every fork,
// the child subtree that does NOT contain the newest activity is superseded.
// Everything else is kept, so independent root chains within one file all
// survive. Returns an empty set when the file carries no tree information
// (older transcripts had no uuids).
function findSupersededNodes(rows) {
  const withId = rows.filter((o) => o && o.uuid);
  const superseded = new Set();
  if (!withId.length) return superseded;

  const children = new Map();
  for (const o of withId) {
    if (!o.parentUuid) continue;
    if (!children.has(o.parentUuid)) children.set(o.parentUuid, []);
    children.get(o.parentUuid).push(o);
  }

  // Newest file-order index anywhere in each node's subtree. The log is
  // append-only, so a child always follows its parent and walking in
  // reverse guarantees children are resolved before their parent.
  const newestInSubtree = new Map();
  for (let i = withId.length - 1; i >= 0; i--) {
    const node = withId[i];
    let newest = i;
    for (const kid of children.get(node.uuid) || []) {
      const kidNewest = newestInSubtree.get(kid.uuid);
      if (kidNewest !== undefined && kidNewest > newest) newest = kidNewest;
    }
    newestInSubtree.set(node.uuid, newest);
  }

  for (const siblings of children.values()) {
    if (siblings.length < 2) continue;
    let winner = siblings[0];
    for (const s of siblings) {
      if (newestInSubtree.get(s.uuid) > newestInSubtree.get(winner.uuid)) winner = s;
    }
    for (const s of siblings) {
      if (s !== winner) markSubtree(s, children, superseded);
    }
  }

  return superseded;
}

function markSubtree(node, children, out) {
  const stack = [node];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur.uuid || out.has(cur.uuid)) continue;
    out.add(cur.uuid);
    for (const kid of children.get(cur.uuid) || []) stack.push(kid);
  }
}

// Slash commands and injected context are stored inline in the user's turn.
// Render the command the user actually typed and drop the scaffolding.
function cleanUserText(raw) {
  if (!raw) return "";
  let text = raw;

  const commandName = matchTag(text, "command-name");
  const commandArgs = matchTag(text, "command-args");

  // Wrappers that are machine-generated context, never user input.
  const dropTags = [
    "system-reminder",
    "local-command-stdout",
    "local-command-caveat",
    "command-message",
    "command-name",
    "command-args",
  ];
  for (const tag of dropTags) {
    text = text.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, "g"), "");
    text = text.replace(new RegExp(`<\\/?${tag}>`, "g"), "");
  }

  text = text.trim();

  if (commandName) {
    const invocation = [commandName, commandArgs].filter(Boolean).join(" ").trim();
    // Keep any prose the user typed alongside the command.
    return text ? `${invocation}\n\n${text}` : invocation;
  }

  return text;
}

function matchTag(text, tag) {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : "";
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
