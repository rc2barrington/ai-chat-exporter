import { PathHints } from "./PathHints.jsx";
import { SessionWorkspace } from "./SessionWorkspace.jsx";
import { parseClaudeCodeJsonl } from "../parsers/claudeJsonl.js";

// ~/.claude is a hidden folder. Chrome's drag-and-drop and
// <input webkitdirectory> paths both silently skip dot-directories, so those
// intake routes can never see a Claude Code transcript no matter what the user
// drags in. The File System Access API *does* enumerate dot-entries, which is
// why the button below is the only reliable way in.
function ClaudeCodeRescueHelp() {
  return (
    <div style={{ marginTop: 16, fontSize: 13, lineHeight: 1.7, color: "#cbd5e1" }}>
      <p style={{ marginBottom: 10 }}>
        <code style={{ color: "#a78bfa" }}>~/.claude</code> is a hidden folder, so dragging it in or
        browsing to it in the file dialog will not work. Use the{" "}
        <strong style={{ color: "#e2e8f0" }}>“Open my Claude Code chats”</strong> button above.
      </p>
      <p style={{ marginBottom: 10 }}>
        In the folder picker, press <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>G</kbd> (Mac) or{" "}
        <kbd>Ctrl</kbd> + <kbd>L</kbd> (Windows/Linux), type{" "}
        <code style={{ color: "#a78bfa" }}>~/.claude</code>, and choose that folder.
      </p>
      <p>
        If that still will not open, just pick your <strong style={{ color: "#e2e8f0" }}>home
        folder</strong> instead — it is visible in the dialog, and the scan looks inside{" "}
        <code style={{ color: "#a78bfa" }}>.claude</code> for you without touching anything else.
      </p>
    </div>
  );
}

// Keep the walk on the path toward .claude/projects. Without this, picking the
// home folder would descend into every repo, Library and media folder there.
function enterDir(name, path) {
  const segments = path.split("/");
  if (segments.includes(".claude")) return true;
  if (name.startsWith(".")) return name === ".claude";
  // Still hunting for .claude: only look just below the chosen root.
  return segments.length <= 2;
}

export function ClaudeCodeTab() {
  return (
    <div>
      <PathHints
        title="Where to Find Your Session Files"
        intro={
          <>
            Claude Code stores every session as a local <code style={{ color: "#a78bfa" }}>.jsonl</code> transcript, one folder per project. Use the button below to open them in one click — <code style={{ color: "#a78bfa" }}>~/.claude</code> is hidden, so dragging the folder in will not work.
          </>
        }
        paths={[
          { label: "macOS", value: "~/.claude/projects/" },
          { label: "Linux", value: "~/.claude/projects/" },
          { label: "Windows", value: "explorer %USERPROFILE%\\.claude\\projects\\" },
        ]}
      />

      <SessionWorkspace
        accept=".jsonl,.json"
        showToolToggles
        sourceLabel="Claude Code session"
        parseFile={async (file, text) => parseClaudeCodeJsonl(text)}
        noMatchHelp={<ClaudeCodeRescueHelp />}
        folderAccess={{
          id: "claude-projects",
          label: "Open my Claude Code chats",
          reopenLabel: "Reload my Claude Code chats",
          hint: "Click once and choose ~/.claude (press Cmd+Shift+G in the dialog and type it), or just pick your home folder. Your browser remembers the choice, so next time this opens straight to your chats. Everything stays on your machine.",
          emptyHint:
            "No Claude Code transcripts found there. Your sessions live in ~/.claude/projects/ — reopen the picker, press Cmd+Shift+G, and type ~/.claude, or pick your home folder and let the scan find it.",
          include: (name) => name.toLowerCase().endsWith(".jsonl"),
          enterDir,
        }}
      />
    </div>
  );
}
