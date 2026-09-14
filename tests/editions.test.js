import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import App from "../src/App.jsx";
import { EDITION, localSources, requireSource } from "../src/edition.js";
import { createLocalSessions, localSessionsMiddleware } from "../server/localSessions.js";
import { parseClaudeCodeJsonl } from "../src/parsers/claudeJsonl.js";
import { sessionFiles } from "../src/utils/sessionExport.js";

const roots = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
it("exposes exactly the intended sources in each edition", () => {
  expect(localSources("private")).toEqual(["codex", "opencode"]);
  expect(localSources("public")).toEqual(["codex", "claude-code"]);
  expect(() => requireSource("claude-code", "private")).toThrow(/Unsupported/);
  expect(() => requireSource("opencode", "public")).toThrow(/Unsupported/);
  expect(() => localSources("typo")).toThrow(/Unknown/);
});
it("does not offer a disabled source even when supplied in the URL", () => {
  const disabled = EDITION === "public" ? "opencode" : "claude-code";
  vi.stubGlobal("location", { hostname: "example.test", search: `?source=${disabled}` });
  const html = renderToStaticMarkup(createElement(App));
  expect(html).toContain("Export browser chats");
  expect(html).not.toContain(EDITION === "public" ? "OpenCode" : "Claude Code");
});
it.each([["private", "claude-code"], ["public", "opencode"]])("blocks disabled %s sources before reading storage", async (edition, source) => {
  const store = createLocalSessions({ edition });
  await expect(store.list(source)).rejects.toThrow(/Unsupported/);
  await expect(store.get(source, "id")).rejects.toThrow(/Unsupported/);
  await expect(store.attachment(source, "id", 0)).rejects.toThrow(/Unsupported/);
  for (const suffix of ["", "&id=id", "&id=id&attachment=0"]) {
    const read = vi.fn(); let body;
    const res = { setHeader() {}, end(text) { body = JSON.parse(text); } };
    await localSessionsMiddleware({ list: read, get: read, attachment: read }, edition)({ method: "GET", headers: { host: "127.0.0.1:9999", "x-ai-exporter": "local-sessions" }, url: `/api/local-sessions?source=${source}${suffix}` }, res, () => {});
    expect(read).not.toHaveBeenCalled(); expect(res.statusCode).toBe(400); expect(body.error).toMatch(/Unsupported/);
  }
});
it("discovers Claude Code titles without listing subagents, symlinks, or opening prompts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "exporter-claude-fixture-")); roots.push(root);
  const project = path.join(root, "projects", "example"); await mkdir(project, { recursive: true });
  const id = "00000000-0000-0000-0000-000000000001";
  const content = [
    { type: "user", sessionId: id, message: { content: "PRIVATE PROMPT FIXTURE" } },
    { type: "custom-title", customTitle: "Named project" },
  ].map(JSON.stringify).join("\n");
  await writeFile(path.join(project, id + ".jsonl"), content);
  await mkdir(path.join(project, "subagents"));
  await writeFile(path.join(project, "subagents", id + ".jsonl"), content);
  await symlink(path.join(project, id + ".jsonl"), path.join(project, "00000000-0000-0000-0000-000000000002.jsonl"));
  const store = createLocalSessions({ edition: "public", claudeHome: root });
  const list = await store.list("claude-code");
  expect(list).toHaveLength(1); expect(list[0].title).toBe("Named project");
  expect(JSON.stringify(list)).not.toContain("PRIVATE PROMPT FIXTURE");
  expect((await store.get("claude-code", id)).messages[0].blocks[0].text).toBe("PRIVATE PROMPT FIXTURE");
  await expect(store.get("claude-code", "../../auth")).rejects.toThrow(/Scan/);
});
it("bundles an embedded Claude Code Markdown document under its conversation name", async () => {
  const parsed = parseClaudeCodeJsonl(JSON.stringify({ type: "user", message: { content: [{ type: "document", title: "notes.md", source: { type: "base64", media_type: "text/markdown", data: btoa("# Complete notes") } }] } }));
  parsed.title = "Example project";
  const result = await sessionFiles(parsed, {}, async entry => (await fetch(entry.url)).blob(), new AbortController().signal);
  expect(result.failures).toEqual([]);
  expect(result.files.map(f => f.filename)).toEqual(["example-project.md", "media/1-notes.md"]);
  expect(new TextDecoder().decode(result.files[1].content)).toBe("# Complete notes");
});
