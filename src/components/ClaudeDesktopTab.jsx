import { PathHints } from "./PathHints.jsx";
import { SessionWorkspace } from "./SessionWorkspace.jsx";
import { parseClaudeCodeJsonl } from "../parsers/claudeJsonl.js";

export function ClaudeDesktopTab() {
  return (
    <div>
      <PathHints
        title="Where to Find Your Session Files"
        intro={
          <>
            Claude Desktop App stores your project transcripts as local <code style={{ color: "#a78bfa" }}>.jsonl</code> files. Copy the path below and use <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>G</kbd> (Mac) in the file picker to jump straight to it.
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
        sourceLabel="Claude Desktop session"
        parseFile={async (file, text) => parseClaudeCodeJsonl(text)}
      />
    </div>
  );
}
