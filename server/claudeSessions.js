import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { parseClaudeCodeJsonl } from "../src/parsers/claudeJsonl.js";

// Discover only top-level project sessions, not subagent logs or credentials.
export function createClaudeSessions(home) {
  const known = new Map();
  async function list() {
    known.clear();
    let root;
    try { root = await realpath(path.join(home, "projects")); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
    const results = [];
    for (const project of await readdir(root, { withFileTypes: true })) {
      if (!project.isDirectory() || project.isSymbolicLink()) continue;
      const directory = path.join(root, project.name);
      const names = new Map();
      try {
        const index = JSON.parse(await readFile(path.join(directory, "sessions-index.json"), "utf8"));
        for (const entry of index.entries || []) {
          if (!entry.isSidechain && entry.sessionId && (entry.customTitle || entry.summary)) names.set(entry.sessionId, entry.customTitle || entry.summary);
        }
      } catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\.jsonl$/i.test(entry.name)) continue;
        const filename = path.join(directory, entry.name);
        const id = entry.name.slice(0, -6);
        const info = await stat(filename);
        let customTitle = "", aiTitle = "";
        // Title records may be appended after the index. Never expose a prompt as a title.
        const input = createReadStream(filename, { encoding: "utf8" });
        try {
          for await (const line of createInterface({ input, crlfDelay: Infinity })) {
            if (!/"(?:custom-title|ai-title)"/.test(line)) continue;
            try {
              const row = JSON.parse(line);
              if (row.type === "custom-title" && typeof row.customTitle === "string") customTitle = row.customTitle;
              if (row.type === "ai-title" && typeof row.aiTitle === "string") aiTitle = row.aiTitle;
            } catch { /* Live logs can end with an incomplete record. */ }
          }
        } finally { input.destroy(); }
        const title = customTitle || aiTitle || names.get(id) || `Claude Code chat ${info.mtime.toISOString().slice(0, 10)} (${id.slice(0, 8)})`;
        if (known.has(id) && known.get(id).mtime >= info.mtimeMs) continue;
        known.set(id, { filename, root, title, mtime: info.mtimeMs });
      }
    }
    for (const [id, file] of known) results.push({ id, title: file.title, updatedAt: new Date(file.mtime).toISOString() });
    return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async function get(id) {
    const file = known.get(id);
    if (!file) throw new Error("Scan sessions again before opening this session.");
    const resolved = await realpath(file.filename);
    if (!resolved.startsWith(file.root + path.sep)) throw new Error("Session path is outside its storage folder.");
    return { ...parseClaudeCodeJsonl(await readFile(resolved, "utf8")), id, title: file.title };
  }
  return { list, get };
}
