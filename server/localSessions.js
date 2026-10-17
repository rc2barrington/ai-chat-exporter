import { mkdir, open as openFile, readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createCodexParser } from "../src/parsers/codexJsonl.js";
import { forEachLine, inlineAttachmentStore } from "./lineFiles.js";
import { parseOpenCode } from "../src/parsers/opencode.js";
import { codexFallbackTitle, isInternalCodexSession } from "../src/parsers/codexMetadata.js";
import { VERSION, requireSource, localSources } from "../src/appConfig.js";
import { createClaudeSessions } from "./claudeSessions.js";

export const LOCAL_APP_VERSION = VERSION;

export function createLocalSessions({ claudeHome = process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude"), codexHome = process.env.CODEX_HOME || path.join(homedir(), ".codex"),
  openCodeHome = path.join(process.env.XDG_DATA_HOME || path.join(homedir(), ".local", "share"), "opencode") } = {}) {
  const files = new Map();
  const claude = createClaudeSessions(claudeHome);
  const attachmentLists = new Map();
  const inlineAttachments = new Map();
  async function database(fn) {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(openCodeHome, "opencode.db"), { readOnly: true });
    try { return fn(db); } finally { db.close(); }
  }
  async function list(source) {
    requireSource(source);
    if (source === "claude-code") return claude.list();
    if (source === "opencode") return database(db => {
      const columns = new Set(db.prepare("PRAGMA table_info(session)").all().map(c => c.name));
      // Models that answered in each session, oldest first.
      const models = new Map();
      const hasMessages = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='message'").get();
      if (hasMessages) for (const row of db.prepare("SELECT session_id, json_extract(data, '$.modelID') AS model FROM message" +
        " WHERE json_extract(data, '$.role') = 'assistant' AND json_extract(data, '$.modelID') IS NOT NULL ORDER BY time_created").all()) {
        const list = models.get(row.session_id) || [];
        if (!list.includes(row.model)) list.push(row.model);
        models.set(row.session_id, list);
      }
      return db.prepare("SELECT id,title,time_created,time_updated FROM session" +
        (columns.has("parent_id") ? " WHERE parent_id IS NULL OR parent_id = ''" : "") +
        " ORDER BY time_updated DESC").all().map(s => ({ id: s.id, title: s.title || "Untitled OpenCode chat", updatedAt: new Date(s.time_updated).toISOString(),
          ...(models.has(s.id) ? { models: models.get(s.id) } : {}) }));
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
    // A long Codex session continues in new rollout files ("pages") with the
    // same session id, each named after the time it started. Codex compresses
    // older pages as .jsonl.zst. Files with the same name in sessions and
    // archived_sessions, compressed or not, are copies of one page.
    const sessions = new Map();
    async function walk(dir, root) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const filename = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(filename, root);
        else if (entry.isFile() && /\.jsonl(?:\.zst)?$/.test(entry.name)) {
          const sessionID = entry.name.match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i)?.[0];
          if (isInternalCodexSession(records.get(sessionID))) continue;
          const id = sessionID || createHash("sha256").update(filename).digest("hex");
          const details = await stat(filename);
          if (!sessions.has(id)) sessions.set(id, { sessionID, parts: new Map() });
          const parts = sessions.get(id).parts;
          const page = entry.name.replace(/\.zst$/, "");
          const copy = parts.get(page);
          // Prefer an uncompressed copy, then the larger one.
          const plain = !filename.endsWith(".zst");
          if (!copy || (plain && !copy.plain) || (plain === copy.plain && details.size > copy.size)) parts.set(page, { filename, root, size: details.size, mtime: details.mtime, plain });
        }
      }
    }
    for (const name of ["sessions", "archived_sessions"]) {
      try { const root = await realpath(path.join(codexHome, name)); await walk(root, root); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    const results = [];
    for (const [id, { sessionID, parts: byName }] of sessions) {
      const parts = [...byName.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, part]) => part);
      // Sessions aborted before anyone spoke contain no conversation. Listing
      // them only adds rows that export to an empty file.
      let spoken = false;
      for (const part of parts) if (await hasCodexConversation(part.filename)) { spoken = true; break; }
      if (!spoken) continue;
      const title = titles.get(sessionID) || codexFallbackTitle(path.basename(parts[0].filename).replace(/\.zst$/, ""));
      files.set(id, { parts, title });
      results.push({ id, title, updatedAt: new Date(Math.max(...parts.map(part => part.mtime.getTime()))).toISOString() });
    }
    return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async function get(source, id, keep) {
    requireSource(source);
    if (source === "claude-code") return claude.get(id, keep);
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
    const parser = createCodexParser({ fileName: path.basename(file.parts[0].filename).replace(/\.zst$/, ""), title: file.title, storeAttachment: keep });
    for (const part of file.parts) {
      const resolved = await realpath(part.filename);
      if (!resolved.startsWith(part.root + path.sep)) throw new Error("Session path is outside its storage folder.");
      await forEachLine(resolved, line => { parser.push(line); });
    }
    return parser.finish();
  }
  async function open(source, id) {
    const inline = inlineAttachmentStore();
    const session = await get(source, id, record => inline.keep(record));
    // Claude Code attachments are produced after its tree is resolved, so
    // move their inline data here instead.
    session.attachments = (session.attachments || []).map(record => inline.keep(record));
    attachmentLists.set(source + ":" + id, session.attachments);
    inlineAttachments.set(source + ":" + id, inline.stored);
    return session;
  }
  async function attachment(source, id, index) {
    requireSource(source);
    const entry = attachmentLists.get(source + ":" + id)?.[index];
    if (entry?.url.startsWith("local:")) {
      const bytes = inlineAttachments.get(source + ":" + id)?.[Number(entry.url.slice(6))];
      if (!bytes) throw new Error("This attachment is no longer loaded. Open the session again.");
      return { bytes, type: entry.mime || "application/octet-stream" };
    }
    if (!entry || !entry.url.startsWith("file:")) throw new Error("This attachment is not available as a local file. Open the session again.");
    const filename = await realpath(fileURLToPath(entry.url));
    if (!(await stat(filename)).isFile()) throw new Error("Attachment is not a file.");
    return { bytes: await readFile(filename), type: entry.mime || "application/octet-stream" };
  }
  return { list, get: open, attachment };
}

// True when a rollout holds at least one user or assistant message. Stops at
// the first one, so even very large files are only read briefly.
async function hasCodexConversation(filename) {
  let found = false;
  await forEachLine(filename, line => {
    if (/"type":\s*"response_item"/.test(line) && /"type":\s*"message"/.test(line) && /"role":\s*"(?:user|assistant)"/.test(line)) { found = true; return false; }
  });
  return found;
}

// Exports are saved straight into Downloads: a Markdown file, or a folder
// holding the Markdown and media/. A name is one path segment, never hidden
// or a parent reference, and files are only written into folders this app
// created.
const safeName = name => typeof name === "string" && name.length > 0 && name.length <= 200 &&
  !name.includes("/") && !name.includes("\\") && ![...name].some(char => char.charCodeAt(0) < 32) && !name.startsWith(".");
function exportSaver(downloadsDir) {
  const created = new Set();
  async function freshFile(name) {
    const dot = name.lastIndexOf(".");
    for (let n = 1; n < 1000; n++) {
      const candidate = n === 1 ? name : `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
      try { return { name: candidate, handle: await openFile(path.join(downloadsDir, candidate), "wx") }; }
      catch (error) { if (error.code !== "EEXIST") throw error; }
    }
    throw new Error("No free file name in Downloads.");
  }
  async function freshFolder(name) {
    for (let n = 1; n < 1000; n++) {
      const candidate = n === 1 ? name : `${name} (${n})`;
      try { await mkdir(path.join(downloadsDir, candidate)); created.add(candidate); return candidate; }
      catch (error) { if (error.code !== "EEXIST") throw error; }
    }
    throw new Error("No free folder name in Downloads.");
  }
  async function writeBody(handle, req) {
    try { for await (const chunk of req) await handle.write(chunk); }
    finally { await handle.close(); }
  }
  return async function save(params, req) {
    const file = params.get("file"), folder = params.get("folder"), relative = params.get("path") || "";
    if (file) {
      if (!safeName(file) || !file.endsWith(".md")) throw new Error("Invalid file name.");
      const target = await freshFile(file);
      await writeBody(target.handle, req);
      return { saved: target.name };
    }
    const parts = relative.split("/");
    if (!safeName(folder) || !parts.length || parts.length > 2 || parts.some(part => !safeName(part)) ||
        (parts.length === 2 && parts[0] !== "media")) throw new Error("Invalid export path.");
    const name = params.get("into") === "1" ? folder : await freshFolder(folder);
    if (!created.has(name)) throw new Error("This export folder was not created by the local app.");
    if (parts.length === 2) await mkdir(path.join(downloadsDir, name, "media"), { recursive: true });
    const target = path.join(downloadsDir, name, ...parts);
    if (!target.startsWith(path.join(downloadsDir, name) + path.sep)) throw new Error("Invalid export path.");
    const handle = await openFile(target, "wx");
    await writeBody(handle, req);
    return { folder: name, saved: `${name}/${relative}` };
  };
}

export function localSessionsMiddleware(store = createLocalSessions(), { downloadsDir = path.join(homedir(), "Downloads") } = {}) {
  const save = exportSaver(downloadsDir);
  return async (req, res, next) => {
    if (!req.url.startsWith("/api/local-sessions")) return next();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    const host = req.headers.host || "";
    const origin = req.headers.origin;
    const saving = req.method === "POST" && req.url.startsWith("/api/local-sessions/save?");
    if (!/^127\.0\.0\.1:\d+$/.test(host) || (origin && origin !== `http://${host}`) ||
        req.headers["x-ai-exporter"] !== "local-sessions" || (req.method !== "GET" && !saving)) {
      res.statusCode = 403;
      return res.end(JSON.stringify({ error: "Only the local exporter can read sessions." }));
    }
    try {
      const url = new URL(req.url, `http://${host}`);
      if (saving) return res.end(JSON.stringify(await save(url.searchParams, req)));
      if (url.pathname !== "/api/local-sessions") throw new Error("Unknown endpoint.");
      if (url.searchParams.get("status") === "1") return res.end(JSON.stringify({ app: "ai-chat-exporter", version: LOCAL_APP_VERSION, sources: localSources() }));
      const source = url.searchParams.get("source");
      requireSource(source);
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
