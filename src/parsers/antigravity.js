// Parses Google Antigravity IDE conversation_history.md transcripts.
//
// Antigravity stores each session at:
//   ~/.gemini/antigravity-ide/brain/<session-uuid>/conversation_history.md
//   ~/.gemini/antigravity-ide/brain/<session-uuid>/conversation_history.md.metadata.json
//
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
// We split on the section headers and normalize into the same shape as the
// Claude parser so the rest of the app stays source-agnostic.

const SECTION_RE = /^##\s+(User Message|Assistant Response)\s+(\d+)\s*$/m;

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
  const firstLine = text.split("\n")[0].trim();
  if (!firstLine) return "";
  return firstLine.length > 60 ? firstLine.slice(0, 57) + "..." : firstLine;
}
