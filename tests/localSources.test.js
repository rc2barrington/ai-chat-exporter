import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import App from "../src/App.jsx";
import { SOURCE_NAMES, localSources, requireSource } from "../src/appConfig.js";
import { createLocalSessions, localSessionsMiddleware } from "../server/localSessions.js";
import { parseClaudeCodeJsonl } from "../src/parsers/claudeJsonl.js";
import { sessionFiles } from "../src/utils/sessionExport.js";

const roots = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
it("reads Codex, Claude Code and OpenCode", () => {
  expect(localSources()).toEqual(["codex", "claude-code", "opencode"]);
  for (const source of localSources()) expect(() => requireSource(source)).not.toThrow();
  expect(() => requireSource("typo")).toThrow(/Unsupported/);
});
it("offers every local source in the sidebar", () => {
  vi.stubGlobal("location", { hostname: "example.test", search: "" });
  const html = renderToStaticMarkup(createElement(App));
  for (const source of localSources()) expect(html).toContain(`<strong>${SOURCE_NAMES[source]}</strong>`);
});
it("ignores an unknown source in the URL", () => {
  vi.stubGlobal("location", { hostname: "example.test", search: "?source=typo" });
  expect(renderToStaticMarkup(createElement(App))).toContain("Export browser chats");
});
it("rejects unknown sources before reading storage", async () => {
  const store = createLocalSessions();
  await expect(store.list("typo")).rejects.toThrow(/Unsupported/);
  await expect(store.get("typo", "id")).rejects.toThrow(/Unsupported/);
  await expect(store.attachment("typo", "id", 0)).rejects.toThrow(/Unsupported/);
  for (const suffix of ["", "&id=id", "&id=id&attachment=0"]) {
    const read = vi.fn(); let body;
    const res = { setHeader() {}, end(text) { body = JSON.parse(text); } };
    await localSessionsMiddleware({ list: read, get: read, attachment: read })({ method: "GET", headers: { host: "127.0.0.1:9999", "x-ai-exporter": "local-sessions" }, url: `/api/local-sessions?source=typo${suffix}` }, res, () => {});
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
  const store = createLocalSessions({ claudeHome: root });
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
