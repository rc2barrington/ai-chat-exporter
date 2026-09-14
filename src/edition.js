// The public snapshot replaces only this setting, not the shared exporters.
export const EDITION = "public";
export const VERSION = "1.0.0";
export function localSources(edition = EDITION) {
  if (edition === "private") return ["codex", "opencode"];
  if (edition === "public") return ["codex", "claude-code"];
  throw new Error("Unknown exporter edition.");
}
export const LOCAL_PORT = EDITION === "private" ? 4178 : 4179;
export const SOURCE_NAMES = { codex: "Codex", opencode: "OpenCode", "claude-code": "Claude Code" };
export function requireSource(source, edition = EDITION) {
  if (!localSources(edition).includes(source)) throw new Error("Unsupported local source in this edition.");
}
