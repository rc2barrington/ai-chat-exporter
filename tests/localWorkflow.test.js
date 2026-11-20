import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ExportWorkspace } from "../src/components/ExportWorkspace.jsx";
afterEach(() => vi.unstubAllGlobals());
it.each(["codex", "opencode", "claude-code"])("keeps %s file import out of the normal hosted workflow", source => {
  vi.stubGlobal("location", { hostname: "example.test", search: "" });
  const html = renderToStaticMarkup(createElement(ExportWorkspace, { source }));
  expect(html).toContain(`?source=${source}`);
  expect(html).toContain("Open my");
  expect(html).toContain("Advanced: import files manually");
  expect(html).not.toContain('type="file"');
  expect(html).not.toContain("Choose chats to export");
  expect(html).not.toContain("opencode export SESSION_ID");
});

// Codex chats save as the .md file alone unless the folder is turned on.
it.each([["codex", false], ["claude-code", true], ["opencode", true]])("starts %s with the attachment folder on: %s", (source, on) => {
  vi.stubGlobal("location", { hostname: "127.0.0.1", search: "" });
  const html = renderToStaticMarkup(createElement(ExportWorkspace, { source }));
  const box = /<input type="checkbox"([^>]*)\/>Save attachments in a folder with the chat/.exec(html);
  expect(box).not.toBeNull();
  expect(box[1].includes("checked")).toBe(on);
});

// Export options are remembered for each kind of chat.
it("remembers each source's export options, such as leaving out tool results", () => {
  vi.stubGlobal("location", { hostname: "127.0.0.1", search: "" });
  const store = new Map([["ai-chat-exporter:options:claude-code", JSON.stringify({ includeResults: false, includeTools: false, attachmentFolder: "yes" })]]);
  vi.stubGlobal("localStorage", { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) });
  const checked = (source, label) => {
    const html = renderToStaticMarkup(createElement(ExportWorkspace, { source }));
    for (const match of html.matchAll(/<input type="checkbox"([^>]*)\/>([^<]*)</g)) if (match[2].startsWith(label)) return match[1].includes("checked");
    throw new Error(`No ${label} option`);
  };
  expect(checked("claude-code", "Include tool results")).toBe(false);
  expect(checked("claude-code", "Include tool calls")).toBe(false);
  // A value that is not true or false is ignored.
  expect(checked("claude-code", "Save attachments in a folder")).toBe(true);
  expect(checked("opencode", "Include tool results")).toBe(true);
  vi.unstubAllGlobals();
});
