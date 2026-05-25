import { PathHints } from "./PathHints.jsx";
import { SessionWorkspace } from "./SessionWorkspace.jsx";
import { parseAntigravityMd } from "../parsers/antigravity.js";
import { readFileAsText } from "../utils/files.js";

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
            The Google Antigravity IDE writes each session's transcript to a per-session folder under <code style={{ color: "#a78bfa" }}>~/.gemini/antigravity-ide/brain/</code>. Drop the whole <code style={{ color: "#a78bfa" }}>brain/</code> folder here to bulk-scan everything, or pick a single <code style={{ color: "#a78bfa" }}>conversation_history.md</code>.
          </>
        }
        paths={[
          { label: "macOS / Linux", value: "~/.gemini/antigravity-ide/brain/" },
          { label: "Windows", value: "explorer %USERPROFILE%\\.gemini\\antigravity-ide\\brain\\" },
          { label: "Alternate (older builds)", value: "~/.gemini/antigravity/brain/" },
        ]}
      />

      <SessionWorkspace
        accept=".md"
        showToolToggles={false}
        sourceLabel="Antigravity conversation_history.md"
        parseFile={async (file, text, allFiles) => {
          if (!file.name.toLowerCase().endsWith("conversation_history.md")) {
            // Skip stray markdown files (e.g. .resolved siblings or scratch notes)
            if (file.name === "conversation_history.md") {
              // (already handled by the check above; this is defensive)
            } else if (!/conversation_history\.md$/i.test(file.name)) {
              return null;
            }
          }

          const folderPath = (file.relativePath || file.webkitRelativePath || file.name).replace(/[^/]+$/, "");
          const sessionId = folderPath.split("/").filter(Boolean).pop() || "";

          // Look up sidecar metadata.json if present in the dropped set.
          let sidecarMetadata = null;
          const sidecar = allFiles.find((f) => {
            const fp = (f.relativePath || f.webkitRelativePath || f.name);
            return fp.endsWith("conversation_history.md.metadata.json") && fp.startsWith(folderPath);
          });
          if (sidecar) {
            try {
              const raw = await readFileAsText(sidecar);
              sidecarMetadata = JSON.parse(raw);
            } catch {
              // ignore malformed sidecar
            }
          }

          return parseAntigravityMd(text, { sidecarMetadata, sessionId });
        }}
      />
    </div>
  );
}
