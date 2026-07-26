import { PathHints } from "./PathHints.jsx";
import { SessionWorkspace } from "./SessionWorkspace.jsx";
import { parseClaudeCodeJsonl } from "../parsers/claudeJsonl.js";

export function ClaudeCodeTab() {
  return (
    <div>
      <PathHints
        title="Where to Find Your Session Files"
        intro={
          <>
            Claude Code stores every session as a local <code style={{ color: "#a78bfa" }}>.jsonl</code> transcript, one folder per project. Copy the path below and use <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>G</kbd> (Mac) in the file picker to jump straight to it.
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
      />
    </div>
  );
}
