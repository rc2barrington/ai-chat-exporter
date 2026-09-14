import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseCodexJsonl } from "../src/parsers/codexJsonl.js";
import { parseOpenCode } from "../src/parsers/opencode.js";
import { codexFallbackTitle, isInternalCodexSession } from "../src/parsers/codexMetadata.js";
import { EDITION, VERSION, requireSource, localSources } from "../src/edition.js";
import { createClaudeSessions } from "./claudeSessions.js";

export const LOCAL_APP_VERSION = VERSION;

export function createLocalSessions({ edition = EDITION, claudeHome = process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude"), codexHome = process.env.CODEX_HOME || path.join(homedir(), ".codex"),
  openCodeHome = path.join(process.env.XDG_DATA_HOME || path.join(homedir(), ".local", "share"), "opencode") } = {}) {
  const files = new Map();
  const claude = createClaudeSessions(claudeHome);
  const attachmentLists = new Map();
  async function database(fn) {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(openCodeHome, "opencode.db"), { readOnly: true });
    try { return fn(db); } finally { db.close(); }
  }
  async function list(source) {
    requireSource(source, edition);
    if (source === "claude-code") return claude.list();
    if (source === "opencode") return database(db => {
      const columns = new Set(db.prepare("PRAGMA table_info(session)").all().map(c => c.name));
      return db.prepare("SELECT id,title,time_created,time_updated FROM session" +
        (columns.has("parent_id") ? " WHERE parent_id IS NULL OR parent_id = ''" : "") +
        " ORDER BY time_updated DESC").all().map(s => ({ id: s.id, title: s.title || "Untitled OpenCode chat", updatedAt: new Date(s.time_updated).toISOString() }));
    });
    if (source !== "codex") throw new Error("Unsupported local source.");
    files.clear();
    const titles = new Map();
    const records = new Map();
    try {
      const databases = (await readdir(codexHome)).filter(name => /^state_\d+\.sqlite$/.test(name)).sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]));
      if (databases.length) {
        const { DatabaseSync } = await import("node:sqlite");
        const index = new DatabaseSync(path.join(codexHome, databases[0]), { readOnly: true });
        try {
          const columns = new Set(index.prepare("PRAGMA table_info(threads)").all().map(c => c.name));
          const fields = ["id", "name", "title", "source", "thread_source", "agent_path", "rollout_path"].filter(c => columns.has(c));
          for (const row of index.prepare(`SELECT ${fields.join(",")} FROM threads`).all()) {
            records.set(row.id, row);
            const name = row.name?.trim() || (!columns.has("name") && row.title?.length < 200 && !row.title.includes("\n") ? row.title : "");
            if (name) titles.set(row.id, name);
          }
        }
        finally { index.close(); }
      }
    } catch { /* Older Codex versions may only have the JSONL session index. */ }
    try {
      const indexNames = new Map();
      for (const line of (await readFile(path.join(codexHome, "session_index.jsonl"), "utf8")).split("\n")) {
        try { const row = JSON.parse(line); if (row.thread_name) indexNames.set(row.id, row.thread_name); } catch { /* partial final line */ }
      }
      for (const [id, name] of indexNames) if (!titles.has(id)) titles.set(id, name);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const results = [];
    const seen = new Set();
    async function walk(dir, root) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const filename = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(filename, root);
        else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          const sessionID = entry.name.match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i)?.[0];
          if (isInternalCodexSession(records.get(sessionID))) continue;
          const id = sessionID || createHash("sha256").update(filename).digest("hex");
          if (seen.has(id)) continue;
          seen.add(id);
          const details = await stat(filename);
          const title = titles.get(sessionID) || codexFallbackTitle(entry.name);
          files.set(id, { filename, root, title });
          results.push({ id, title, updatedAt: details.mtime.toISOString() });
        }
      }
    }
    for (const name of ["sessions", "archived_sessions"]) {
      try { const root = await realpath(path.join(codexHome, name)); await walk(root, root); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async function get(source, id) {
    requireSource(source, edition);
    if (source === "claude-code") return claude.get(id);
    if (source === "opencode") return database(db => {
      db.exec("BEGIN");
      try {
        const row = db.prepare("SELECT * FROM session WHERE id=?").get(id);
        if (!row) throw new Error("Session not found.");
        const entries = db.prepare("SELECT id,data FROM message WHERE session_id=? ORDER BY time_created,id").all(id);
        const parts = db.prepare("SELECT message_id,data FROM part WHERE session_id=? ORDER BY time_created,id").all(id);
        const byMessage = new Map();
        for (const part of parts) {
          if (!byMessage.has(part.message_id)) byMessage.set(part.message_id, []);
          byMessage.get(part.message_id).push(JSON.parse(part.data));
        }
        return parseOpenCode({ info: { ...row, time: { created: row.time_created, updated: row.time_updated },
          revert: row.revert ? JSON.parse(row.revert) : null },
        messages: entries.map(m => ({ info: { ...JSON.parse(m.data), id: m.id }, parts: byMessage.get(m.id) || [] })) });
      } finally { db.exec("ROLLBACK"); }
    });
    if (source !== "codex") throw new Error("Unsupported local source.");
    const file = files.get(id);
    if (!file) throw new Error("Scan sessions again before opening this session.");
    const resolved = await realpath(file.filename);
    if (!resolved.startsWith(file.root + path.sep)) throw new Error("Session path is outside its storage folder.");
    return parseCodexJsonl(await readFile(resolved, "utf8"), { fileName: path.basename(resolved), title: file.title });
  }
  async function open(source, id) {
    const session = await get(source, id);
    attachmentLists.set(source + ":" + id, session.attachments || []);
    return session;
  }
  async function attachment(source, id, index) {
    requireSource(source, edition);
    const entry = attachmentLists.get(source + ":" + id)?.[index];
    if (!entry || !entry.url.startsWith("file:")) throw new Error("This attachment is not available as a local file. Open the session again.");
    const filename = await realpath(fileURLToPath(entry.url));
    if (!(await stat(filename)).isFile()) throw new Error("Attachment is not a file.");
    return { bytes: await readFile(filename), type: entry.mime || "application/octet-stream" };
  }
  return { list, get: open, attachment };
}

export function localSessionsMiddleware(store = createLocalSessions(), edition = EDITION) {
  return async (req, res, next) => {
    if (!req.url.startsWith("/api/local-sessions")) return next();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    const host = req.headers.host || "";
    const origin = req.headers.origin;
    if (!/^127\.0\.0\.1:\d+$/.test(host) || (origin && origin !== `http://${host}`) ||
        req.headers["x-ai-exporter"] !== "local-sessions" || req.method !== "GET") {
      res.statusCode = 403;
      return res.end(JSON.stringify({ error: "Only the local exporter can read sessions." }));
    }
    try {
      const url = new URL(req.url, `http://${host}`);
      if (url.pathname !== "/api/local-sessions") throw new Error("Unknown endpoint.");
      if (url.searchParams.get("status") === "1") return res.end(JSON.stringify({ app: "ai-chat-exporter", version: LOCAL_APP_VERSION, edition, sources: localSources(edition) }));
      const source = url.searchParams.get("source");
      requireSource(source, edition);
      const id = url.searchParams.get("id");
      if (url.searchParams.has("attachment")) {
        const index = url.searchParams.get("attachment");
        if (!id || !/^\d+$/.test(index)) throw new Error("Invalid attachment request.");
        const file = await store.attachment(source, id, Number(index));
        res.setHeader("Content-Type", file.type);
        res.setHeader("X-Content-Type-Options", "nosniff");
        return res.end(file.bytes);
      }
      res.end(JSON.stringify(id ? await store.get(source, id) : await store.list(source)));
    } catch (error) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: error.code === "ENOENT" ? "No local session storage found for this source." : error.message }));
    }
  };
}
