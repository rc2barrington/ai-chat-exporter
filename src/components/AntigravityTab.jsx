import { useState } from "react";
import { PathHints } from "./PathHints.jsx";
import { SessionWorkspace } from "./SessionWorkspace.jsx";
import { parseAntigravityMd, parseAntigravityJsonl, deriveSessionId } from "../parsers/antigravity.js";
import { readFileAsText } from "../utils/files.js";
import { copyToClipboard } from "../utils/download.js";

// Antigravity transcripts live inside a hidden ".system_generated" folder
// nested in each session folder. Chrome silently skips hidden entries when a
// folder is dragged in or scanned via the folder input, so those two intake
// paths see zero transcripts. This command mirrors every transcript (plus the
// older conversation_history.md format and its sidecar) into a visible
// ~/Downloads/antigravity-transcripts/<uuid>/ layout that any intake path can
// read; deriveSessionId() falls back to the parent folder, so session IDs
// survive the flattening. POSIX-safe so it runs in both zsh and bash.
const MIRROR_COMMAND =
  'for b in ~/.gemini/antigravity/brain ~/.gemini/antigravity-ide/brain; do [ -d "$b" ] || continue; find "$b" \\( -name transcript.jsonl -o -name conversation_history.md -o -name conversation_history.md.metadata.json \\) | while IFS= read -r f; do rel="${f#$b/}"; u="${rel%%/*}"; mkdir -p ~/Downloads/antigravity-transcripts/"$u"; cp "$f" ~/Downloads/antigravity-transcripts/"$u"/; done; done';

// Shown when a dropped/scanned folder yields no transcripts — almost always
// Chrome hiding the dot-folders rather than the user picking the wrong place.
function AntigravityRescueHelp() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const ok = await copyToClipboard(MIRROR_COMMAND);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };
  return (
    <div style={{ textAlign: "left", maxWidth: 640, margin: "14px auto 0", color: "#94a3b8", fontSize: 13, lineHeight: 1.6 }}>
      <p style={{ margin: "0 0 8px" }}>
        Antigravity stores transcripts inside a hidden <code style={{ color: "#a78bfa" }}>.system_generated</code> folder, and Chrome
        skips hidden folders when you drag a folder in or use “Scan Folder”. Two ways around it:
      </p>
      <p style={{ margin: "0 0 8px" }}>
        <strong style={{ color: "#e2e8f0" }}>1.</strong> Use the <strong style={{ color: "#e2e8f0" }}>“Open my Antigravity chats”</strong> button above — it reads the folder through a browser API that does see hidden files.
      </p>
      <p style={{ margin: "0 0 6px" }}>
        <strong style={{ color: "#e2e8f0" }}>2.</strong> Or run this in Terminal to copy your transcripts somewhere visible, then drag <code style={{ color: "#a78bfa" }}>~/Downloads/antigravity-transcripts</code> into the box:
      </p>
      <div className="path-box">
        <span className="path-text" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{MIRROR_COMMAND}</span>
        <button className="path-copy-btn" onClick={copy}>{copied ? "✓ Copied" : "📋 Copy"}</button>
      </div>
    </div>
  );
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
            The Google Antigravity IDE writes each session's transcript to a per-session folder under <code style={{ color: "#a78bfa" }}>~/.gemini/antigravity/brain/</code>. Use the <strong>“Open my Antigravity chats”</strong> button below to bulk-scan everything — newer builds keep each <code style={{ color: "#a78bfa" }}>transcript.jsonl</code> inside a hidden <code style={{ color: "#a78bfa" }}>.system_generated/logs/</code> folder that Chrome skips during drag-and-drop, so dragging the <code style={{ color: "#a78bfa" }}>brain/</code> folder in may find nothing. Older builds' <code style={{ color: "#a78bfa" }}>conversation_history.md</code> files work either way.
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
        noMatchHelp={<AntigravityRescueHelp />}
        folderAccess={{
          id: "antigravity-brain",
          label: "Open my Antigravity chats",
          reopenLabel: "Reload my Antigravity chats",
          hint: "Click once and choose your ~/.gemini/antigravity/brain/ folder. The folder is hidden, so in the file dialog press ⌘⇧G (Cmd+Shift+G) and type ~/.gemini/antigravity/brain to jump straight to it. Your browser remembers it, so next time this opens straight to your chats. Everything stays on your machine.",
          emptyHint:
            "That folder has no Antigravity transcripts in it. Your chats live in ~/.gemini/antigravity/brain/ — note there may be other empty folders also named \"antigravity\" (e.g. in Documents); those are not the right one. Reopen the picker, press ⌘⇧G, and type ~/.gemini/antigravity/brain to land on the correct folder.",
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
