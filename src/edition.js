// The public snapshot flips only the EDITION line below. Everything else about
// an edition lives in EDITIONS, so both builds read the same table and a
// change to one edition can never silently drift from the other.
export const EDITION = "public";
export const VERSION = "1.1.0";

export const EDITIONS = {
  private: { sources: ["codex", "claude-code", "opencode"], port: 4178, repository: "rc2barrington/ai-chat-exporter-private" },
  public: { sources: ["codex", "claude-code"], port: 4179, repository: "rc2barrington/ai-chat-exporter" },
};

export function editionConfig(edition = EDITION) {
  const config = EDITIONS[edition];
  if (!config) throw new Error("Unknown exporter edition.");
  return config;
}

export function localSources(edition = EDITION) {
  return [...editionConfig(edition).sources];
}

export const LOCAL_PORT = editionConfig().port;
export const SOURCE_NAMES = { codex: "Codex", "claude-code": "Claude Code", opencode: "OpenCode" };

export function requireSource(source, edition = EDITION) {
  if (!localSources(edition).includes(source)) throw new Error("Unsupported local source in this edition.");
}
