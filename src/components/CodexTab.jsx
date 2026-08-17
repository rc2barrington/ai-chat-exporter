import { PathHints } from "./PathHints.jsx";
import { SessionWorkspace } from "./SessionWorkspace.jsx";
import { parseCodexJsonl } from "../parsers/codexJsonl.js";

// ~/.codex is hidden, exactly like ~/.claude. Chrome's drag-and-drop and
// <input webkitdirectory> paths both skip dot-directories, so the File System
// Access API button is the only reliable way in.
function CodexRescueHelp() {
  return (
    <div style={{ marginTop: 16, fontSize: 13, lineHeight: 1.7, color: "#cbd5e1" }}>
      <p style={{ marginBottom: 10 }}>
        <code style={{ color: "#a78bfa" }}>~/.codex</code> is a hidden folder, so dragging it in or
        browsing to it in the file dialog will not work. Use the{" "}
        <strong style={{ color: "#e2e8f0" }}>“Open my Codex chats”</strong> button above.
      </p>
      <p style={{ marginBottom: 10 }}>
        In the folder picker, press <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>G</kbd> (Mac) or{" "}
        <kbd>Ctrl</kbd> + <kbd>L</kbd> (Windows/Linux), type{" "}
        <code style={{ color: "#a78bfa" }}>~/.codex</code>, and choose that folder.
      </p>
      <p>
        If that will not open, pick your <strong style={{ color: "#e2e8f0" }}>home folder</strong>{" "}
        instead — it is visible in the dialog, and the scan looks inside{" "}
        <code style={{ color: "#a78bfa" }}>.codex</code> for you without touching anything else.
      </p>
    </div>
  );
}

// Keep the walk on the path toward .codex/sessions. Without this, picking the
// home folder would descend into every repo and media folder there.
function enterDir(name, path) {
  const segments = path.split("/");
  if (segments.includes(".codex")) return true;
  if (name.startsWith(".")) return name === ".codex";
  return segments.length <= 2;
}

export function CodexTab() {
  return (
    <div>
      <PathHints
        title="Where to Find Your Session Files"
        intro={
          <>
            Codex writes every session to a local <code style={{ color: "#a78bfa" }}>.jsonl</code> rollout file, one folder per day. Use the button below to open them in one click — <code style={{ color: "#a78bfa" }}>~/.codex</code> is hidden, so dragging the folder in will not work.
          </>
        }
        paths={[
          { label: "macOS", value: "~/.codex/sessions/" },
          { label: "Linux", value: "~/.codex/sessions/" },
          { label: "Windows", value: "explorer %USERPROFILE%\\.codex\\sessions\\" },
        ]}
      />

      <SessionWorkspace
        accept=".jsonl"
        showToolToggles
        sourceLabel="Codex session"
        parseFile={async (file, text) => parseCodexJsonl(text, { fileName: file.name })}
        noMatchHelp={<CodexRescueHelp />}
        folderAccess={{
          id: "codex-sessions",
          label: "Open my Codex chats",
          reopenLabel: "Reload my Codex chats",
          hint: "Click once and choose ~/.codex (press Cmd+Shift+G in the dialog and type it), or just pick your home folder. Your browser remembers the choice, so next time this opens straight to your chats. Everything stays on your machine.",
          emptyHint:
            "No Codex transcripts found there. Your sessions live in ~/.codex/sessions/ — reopen the picker, press Cmd+Shift+G, and type ~/.codex, or pick your home folder and let the scan find it.",
          include: (name) => name.toLowerCase().endsWith(".jsonl"),
          enterDir,
        }}
      />
    </div>
  );
}
