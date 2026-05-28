import { PathHints } from "./PathHints.jsx";
import { SessionWorkspace } from "./SessionWorkspace.jsx";
import { parseAntigravityMd, parseAntigravityJsonl } from "../parsers/antigravity.js";
import { readFileAsText } from "../utils/files.js";

// Derive the session UUID from a transcript path. The .jsonl lives at
// .../brain/<uuid>/.system_generated/logs/transcript.jsonl, so the UUID is the
// segment right before ".system_generated". For conversation_history.md it's
// just the immediate parent folder.
function deriveSessionId(relativePath) {
  const parts = relativePath.split("/").filter(Boolean);
  const sysIdx = parts.indexOf(".system_generated");
  if (sysIdx > 0) return parts[sysIdx - 1];
  // parent folder of the file
  return parts.length >= 2 ? parts[parts.length - 2] : "";
}

// When the user drops a folder, we look for sibling .metadata.json files to
// enrich each session with its updatedAt timestamp. We also derive a
// session UUID from the parent folder name.
export function AntigravityTab() {
  return (
    <div>
      <PathHints
        title="Where to Find Your Antigravity Conversations"
        intro={
          <>
            The Google Antigravity IDE writes each session's transcript to a per-session folder under <code style={{ color: "#a78bfa" }}>~/.gemini/antigravity/brain/</code>. Drop the whole <code style={{ color: "#a78bfa" }}>brain/</code> folder here to bulk-scan everything. Newer builds store a <code style={{ color: "#a78bfa" }}>transcript.jsonl</code> under each session's <code style={{ color: "#a78bfa" }}>.system_generated/logs/</code>; older builds use <code style={{ color: "#a78bfa" }}>conversation_history.md</code>. Both work.
          </>
        }
        paths={[
          { label: "macOS / Linux", value: "~/.gemini/antigravity/brain/" },
          { label: "Windows", value: "explorer %USERPROFILE%\\.gemini\\antigravity\\brain\\" },
          { label: "Alternate (older builds)", value: "~/.gemini/antigravity-ide/brain/" },
        ]}
      />

      <SessionWorkspace
        accept=".jsonl,.md"
        showToolToggles={true}
        sourceLabel="Antigravity transcript"
        folderAccess={{
          id: "antigravity-brain",
          label: "Open my Antigravity chats",
          reopenLabel: "Reload my Antigravity chats",
          hint: "Click once and choose your ~/.gemini/antigravity/brain/ folder. Your browser remembers it, so next time this opens straight to your chats (no navigating). Everything stays on your machine.",
          include: (name) => {
            const n = name.toLowerCase();
            return (
              n.endsWith("transcript.jsonl") ||
              n.endsWith("conversation_history.md") ||
              n.endsWith("conversation_history.md.metadata.json")
            );
          },
        }}
        parseFile={async (file, text, allFiles) => {
          const relPath = file.relativePath || file.webkitRelativePath || file.name;
          const lower = file.name.toLowerCase();
          const sessionId = deriveSessionId(relPath);

          // Newer builds: per-session transcript.jsonl
          if (lower.endsWith("transcript.jsonl")) {
            return parseAntigravityJsonl(text, { sessionId });
          }

          // Older builds: conversation_history.md (+ optional .metadata.json sidecar)
          if (lower.endsWith("conversation_history.md")) {
            const folderPath = relPath.replace(/[^/]+$/, "");
            let sidecarMetadata = null;
            const sidecar = allFiles.find((f) => {
              const fp = f.relativePath || f.webkitRelativePath || f.name;
              return fp.endsWith("conversation_history.md.metadata.json") && fp.startsWith(folderPath);
            });
            if (sidecar) {
              try {
                sidecarMetadata = JSON.parse(await readFileAsText(sidecar));
              } catch {
                // ignore malformed sidecar
              }
            }
            return parseAntigravityMd(text, { sidecarMetadata, sessionId });
          }

          // Anything else (e.g. the .metadata.json sidecar itself) is not a session.
          return null;
        }}
      />
    </div>
  );
}
