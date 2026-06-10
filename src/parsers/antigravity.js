// Parses Google Antigravity IDE transcripts. Two on-disk formats exist
// depending on the build:
//
//   1. conversation_history.md (older / "antigravity-ide" builds)
//        ~/.gemini/antigravity-ide/brain/<uuid>/conversation_history.md
//        ~/.gemini/antigravity-ide/brain/<uuid>/conversation_history.md.metadata.json
//
//   2. transcript.jsonl (current "antigravity" builds)
//        ~/.gemini/antigravity/brain/<uuid>/.system_generated/logs/transcript.jsonl
//
// Both normalize into the same shape as the Claude parser so the rest of the
// app stays source-agnostic.
//
// --- conversation_history.md ---------------------------------------------
// The markdown format looks like:
//   # Conversation History
//
//   ## User Message 1
//   > the user's text (blockquote, may span multiple lines)
//
//   ## Assistant Response 1
//   the assistant's text (free-form markdown)
//
//   ## User Message 2
//   ...
//
// We split on the section headers.
//
// --- transcript.jsonl -----------------------------------------------------
// One JSON object per line:
//   { step_index, source, type, status, created_at, content, thinking?,
//     tool_calls?: [{ name, args }], error? }
//
// source is one of USER_EXPLICIT | MODEL | SYSTEM.
//   USER_EXPLICIT/USER_INPUT  -> a "You" turn (content is the user's text)
//   MODEL/*                   -> an assistant turn. thinking -> thinking block,
//                                content -> text (or tool_result for tool-output
//                                step types), tool_calls -> tool_use blocks.
//   SYSTEM/*                  -> internal scaffolding (ephemeral status,
//                                conversation-history dumps, checkpoints) — skipped.

const SECTION_RE = /^##\s+(User Message|Assistant Response)\s+(\d+)\s*$/m;

// Derive the session UUID from a transcript path. The .jsonl lives at
// .../brain/<uuid>/.system_generated/logs/transcript.jsonl, so the UUID is the
// segment right before ".system_generated". For conversation_history.md — or a
// transcript.jsonl that was mirrored out to a flat <uuid>/transcript.jsonl
// layout — it's the immediate parent folder.
export function deriveSessionId(relativePath) {
  const parts = String(relativePath || "").split("/").filter(Boolean);
  const sysIdx = parts.indexOf(".system_generated");
  if (sysIdx > 0) return parts[sysIdx - 1];
  return parts.length >= 2 ? parts[parts.length - 2] : "";
}

export function parseAntigravityMd(fileContent, opts = {}) {
  const { sidecarMetadata, sessionId } = opts;

  // Drop the top-level "# Conversation History" header if present.
  const body = fileContent.replace(/^#\s+Conversation History\s*\n+/i, "");

  const messages = [];
  const sections = splitSections(body);
  for (const sec of sections) {
    const text = sec.body.trim();
    if (!text) continue;
    if (sec.kind === "User Message") {
      messages.push({
        role: "## You",
        blocks: [{ type: "text", text: stripBlockquote(text) }],
      });
    } else {
      messages.push({
        role: "## Antigravity",
        blocks: [{ type: "text", text }],
      });
    }
  }

  const updatedAt = sidecarMetadata?.updatedAt || "";
  const title =
    sidecarMetadata?.title ||
    deriveTitleFromFirstUser(messages) ||
    (sessionId ? `Antigravity Session ${sessionId.slice(0, 8)}` : "Antigravity Session");

  return {
    title,
    date: updatedAt ? new Date(updatedAt).toLocaleString() : "",
    startedAt: "",
    endedAt: updatedAt || "",
    messages,
    source: "Google Antigravity",
    sessionId: sessionId || "",
  };
}

// MODEL step types whose `content` is the OUTPUT of a tool action (rendered as
// a tool_result) rather than assistant prose.
const TOOL_OUTPUT_TYPES = new Set([
  "RUN_COMMAND",
  "VIEW_FILE",
  "CODE_ACTION",
  "LIST_DIRECTORY",
  "GREP_SEARCH",
  "FIND",
  "SEARCH_WEB",
  "READ_URL_CONTENT",
  "INVOKE_SUBAGENT",
]);

// Antigravity wraps each user turn as:
//   <USER_REQUEST> the real prompt </USER_REQUEST>
//   <ADDITIONAL_METADATA> … </ADDITIONAL_METADATA>
//   <USER_SETTINGS_CHANGE> … </USER_SETTINGS_CHANGE>
// Keep only the request body so titles and exports show the actual message,
// not the "<USER_REQUEST>" tag or IDE scaffolding.
function cleanUserContent(content) {
  if (!content) return "";
  const m = content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
  let text = m ? m[1] : content;
  text = text
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, "")
    .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi, "")
    // strip any leftover standalone wrapper tags
    .replace(/^\s*<\/?[A-Za-z_][^>]*>\s*$/gm, "");
  return text.trim();
}

export function parseAntigravityJsonl(fileContent, opts = {}) {
  const { sidecarMetadata, sessionId } = opts;

  const messages = [];
  let firstTs = "";
  let lastTs = "";
  let current = null; // accumulates consecutive MODEL lines into one assistant turn

  const flush = () => {
    if (current && current.blocks.length) messages.push(current);
    current = null;
  };

  for (const raw of fileContent.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // skip malformed line
    }

    const ts = typeof o.created_at === "string" ? o.created_at : "";
    if (ts) {
      if (!firstTs || ts < firstTs) firstTs = ts;
      if (!lastTs || ts > lastTs) lastTs = ts;
    }

    // Internal scaffolding — not part of the conversation.
    if (o.source === "SYSTEM") continue;

    const content = typeof o.content === "string" ? o.content.trim() : "";

    if (o.source === "USER_EXPLICIT") {
      flush();
      const userText = cleanUserContent(content);
      if (userText) {
        messages.push({
          role: "## You",
          blocks: [{ type: "text", text: userText }],
          timestamp: ts,
        });
      }
      continue;
    }

    if (o.source === "MODEL") {
      if (!current) current = { role: "## Antigravity", blocks: [], timestamp: ts };

      if (typeof o.thinking === "string" && o.thinking.trim()) {
        current.blocks.push({ type: "thinking", thinking: o.thinking.trim() });
      }

      if (Array.isArray(o.tool_calls)) {
        for (const tc of o.tool_calls) {
          if (!tc) continue;
          current.blocks.push({
            type: "tool_use",
            id: "",
            name: tc.name || o.type || "tool",
            input: tc.args ?? {},
          });
        }
      }

      if (content) {
        if (TOOL_OUTPUT_TYPES.has(o.type)) {
          current.blocks.push({
            type: "tool_result",
            tool_use_id: "",
            content,
            is_error: o.status === "ERROR",
          });
        } else {
          current.blocks.push({ type: "text", text: content });
        }
      }

      if (typeof o.error === "string" && o.error.trim()) {
        current.blocks.push({
          type: "tool_result",
          tool_use_id: "",
          content: o.error.trim(),
          is_error: true,
        });
      }
    }
  }
  flush();

  const updatedAt = sidecarMetadata?.updatedAt || lastTs || "";
  const title =
    sidecarMetadata?.title ||
    deriveTitleFromFirstUser(messages) ||
    (sessionId ? `Antigravity Session ${sessionId.slice(0, 8)}` : "Antigravity Session");

  return {
    title,
    date: updatedAt ? new Date(updatedAt).toLocaleString() : "",
    startedAt: firstTs || "",
    endedAt: lastTs || updatedAt || "",
    messages,
    source: "Google Antigravity",
    sessionId: sessionId || "",
  };
}

function splitSections(body) {
  const out = [];
  const lines = body.split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(User Message|Assistant Response)\s+(\d+)\s*$/);
    if (m) {
      if (current) out.push(current);
      current = { kind: m[1], index: Number(m[2]), body: "" };
    } else if (current) {
      current.body += line + "\n";
    }
  }
  if (current) out.push(current);
  // Keep document order; reject malformed sections without bodies.
  return out.filter((s) => SECTION_RE.test(`## ${s.kind} ${s.index}`));
}

function stripBlockquote(text) {
  return text
    .split("\n")
    .map((l) => l.replace(/^>\s?/, ""))
    .join("\n")
    .trim();
}

function deriveTitleFromFirstUser(messages) {
  const firstUser = messages.find((m) => m.role === "## You");
  if (!firstUser) return "";
  const text = firstUser.blocks[0]?.text || "";
  const firstLine = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return "";
  return firstLine.length > 60 ? firstLine.slice(0, 57) + "..." : firstLine;
}
