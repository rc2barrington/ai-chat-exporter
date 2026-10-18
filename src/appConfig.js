// One app, one set of sources. The local app reads every source listed here.
export const VERSION = "1.2.8";
export const REPOSITORY = "rc2barrington/ai-chat-exporter";
export const LOCAL_PORT = 4179;
export const SOURCE_NAMES = { codex: "Codex", "claude-code": "Claude Code", opencode: "OpenCode" };

export function localSources() {
  return Object.keys(SOURCE_NAMES);
}

export function requireSource(source) {
  if (!localSources().includes(source)) throw new Error("Unsupported local source.");
}
