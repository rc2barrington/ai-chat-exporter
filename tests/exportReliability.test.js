import { expect, it } from "vitest";
import JSZip from "jszip";
import "../chrome-extension/exportCore.js";
import "../chrome-extension/exportTransport.js";
import { parseCodexJsonl } from "../src/parsers/codexJsonl.js";
import { parseOpenCode } from "../src/parsers/opencode.js";
import { sessionFiles } from "../src/utils/sessionExport.js";

const core = globalThis.AIChatExporterCore;
const transport = globalThis.AIChatExporterTransport;
it("transfers over 64 MiB with bounded individual messages and exact attachment bytes", async () => {
  const receiver = transport.receiver();
  const base64 = "YWJj".repeat(2 * 1024 * 1024);
  const data = { title: "Large export", messageCount: 2, messages: [{ text: "First" }, { text: "Last" }], savedMedia: Array.from({ length: 9 }, (_, i) => ({ filename: `${i}.bin`, base64 })) };
  expect(JSON.stringify(data).length).toBeGreaterThan(64 * 1024 * 1024);
  let largest = 0;
  await transport.send(data, "large", async message => {
    largest = Math.max(largest, JSON.stringify(message).length);
    receiver.receive(message); return { status: "ok" };
  });
  expect(largest).toBeLessThan(1024 * 1024);
  const received = receiver.take("large");
  expect(received.messages).toEqual(data.messages);
  expect(received.savedMedia).toHaveLength(9);
  for (const file of received.savedMedia) {
    expect(file.blob.size).toBe(6 * 1024 * 1024);
    expect(await file.blob.slice(0, 6).text()).toBe("abcabc");
    expect(await file.blob.slice(-6).text()).toBe("abcabc");
    expect(file.base64).toBeUndefined();
  }
}, 30000);

it("refuses out-of-order/incomplete transfers and discards a cancelled transfer", async () => {
  const receiver = transport.receiver();
  receiver.receive({ transferId: "bad", operation: "begin" });
  expect(() => receiver.take("bad")).toThrow(/did not finish/);
  expect(() => receiver.receive({ transferId: "bad", operation: "finish" })).toThrow(/Incomplete/);
  expect(() => receiver.receive({ transferId: "bad", operation: "chunk", field: "meta", sequence: 1, chunk: "{}", last: true })).toThrow(/Out-of-order/);
  let calls = 0;
  await expect(transport.send({ messages: [{ text: "large".repeat(100000) }] }, "cancel", async message => { receiver.receive(message); calls++; return { status: "ok" }; }, () => { if (calls > 2) throw new Error("Cancelled"); })).rejects.toThrow("Cancelled");
  expect(() => receiver.take("cancel")).toThrow(/did not finish/);
});

it("deduplicates only byte-identical images and keeps every occurrence in Markdown", async () => {
  const image = (filename, text) => ({ filename, blob: new Blob([text], { type: "image/png" }) });
  const messages = [{ text: "![one](media/a.png) ![two](media/b.png) ![three](media/c.png)" }];
  const result = await core.deduplicateImages([image("a.png", "123"), image("b.png", "123"), image("c.png", "124"), { filename: "notes.md", blob: new Blob(["123"]) }], messages);
  expect(result.savedMedia.map(m => m.filename)).toEqual(["a.png", "c.png", "notes.md"]);
  expect(result.duplicates).toBe(1);
  expect(messages[0].text).toBe("![one](media/a.png) ![two](media/a.png) ![three](media/c.png)");
});

it("stamps every ZIP file AND directory with current local wall-clock time", async () => {
  const zip = new JSZip();
  zip.file("chat/media/a.png", "bytes", { date: new Date(1980, 0, 1) });
  const now = new Date(); core.stampZip(zip, now);
  const buffer = await zip.generateAsync({ type: "uint8array" });
  const reopened = await JSZip.loadAsync(buffer);
  for (const entry of Object.values(reopened.files)) {
    const d = entry.date;
    expect([d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()]).toEqual([now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()]);
    expect(Math.abs(d.getTime() - core.zipLocalDate(now).getTime())).toBeLessThan(2000);
  }
  expect(Object.keys(reopened.files)).toEqual(["chat/", "chat/media/", "chat/media/a.png"]);
});

it.each(["codex", "opencode"])("packages %s embedded images, duplicate references and full tool output", async source => {
  const url = "data:image/png;base64,YWJj";
  const output = "x".repeat(10000) + "THE END";
  const session = source === "codex" ? parseCodexJsonl([
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "FIRST" }, { type: "input_image", image_url: url }, { type: "input_image", image_url: url }] } },
    { type: "response_item", payload: { type: "function_call_output", output } },
  ].map(JSON.stringify).join("\n")) : parseOpenCode({ info: { title: "Test" }, messages: [
    { info: { role: "user" }, parts: [{ type: "text", text: "FIRST" }, ...[1, 2].map(i => ({ type: "file", filename: `${i}.png`, mime: "image/png", url }))] },
    { info: { role: "assistant" }, parts: [{ type: "tool", state: { output } }] },
  ] });
  const result = await sessionFiles(session, { includeTools: true, includeResults: true }, async a => (await fetch(a.url)).blob(), new AbortController().signal);
  expect(result.files).toHaveLength(2);
  expect(result.files[0].filename).toBe(source === "codex" ? "codex-session-name-unavailable.md" : "test.md");
  expect(result.files[1].filename).toMatch(/\.png$/);
  expect(result.duplicates).toBe(1);
  expect(result.failures).toEqual([]);
  expect(result.files[0].content).toContain("FIRST");
  expect(result.files[0].content).toContain(output);
  expect(result.files[0].content).not.toContain("attachment:");
  expect(result.files[0].content.match(/media\//g)).toHaveLength(2);
});

it("uses each chat name inside a local batch ZIP without breaking media paths", async () => {
  const { bundleZip } = await import("../src/utils/zip.js");
  const entries = [];
  for (const title of ["First chat", "Second chat"]) {
    const session = { title, messages: [{ role: "## You", blocks: [{ type: "text", text: "![Image](attachment:0)" }] }], attachments: [{ label: "image.png", image: true, mime: "image/png" }] };
    const result = await sessionFiles(session, {}, async () => new Blob(["image"], { type: "image/png" }), new AbortController().signal);
    for (const f of result.files) entries.push({ ...f, filename: title + "/" + f.filename });
  }
  const archive = await JSZip.loadAsync(await (await bundleZip(entries)).arrayBuffer());
  expect(archive.file("First chat/first-chat.md")).not.toBeNull();
  expect(archive.file("Second chat/second-chat.md")).not.toBeNull();
  expect(Object.keys(archive.files).some(name => name.endsWith("/conversation.md"))).toBe(false);
  expect(await archive.file("First chat/first-chat.md").async("string")).toContain("media/1-image.png");
});

// A screenshot returned by a tool belongs to the tool output. With tool output
// hidden, saving it would leave an unlinked file in the ZIP.
it("saves only the attachments the exported Markdown links to", async () => {
  const session = { title: "Tools", messages: [
    { role: "## You", blocks: [{ type: "text", text: "![Upload](attachment:0)" }] },
    { role: "## Codex", blocks: [{ type: "tool_result", content: "![Screenshot](attachment:1)" }, { type: "text", text: "Done" }] },
  ], attachments: [{ label: "upload.png", image: true, mime: "image/png" }, { label: "screenshot.png", image: true, mime: "image/png" }] };
  const load = async (_attachment, index) => new Blob([`image ${index}`], { type: "image/png" });
  const hidden = await sessionFiles(session, {}, load, new AbortController().signal);
  expect(hidden.files.map(f => f.filename)).toEqual(["tools.md", "media/1-upload.png"]);
  const shown = await sessionFiles(session, { includeTools: true, includeResults: true }, load, new AbortController().signal);
  expect(shown.files.map(f => f.filename)).toEqual(["tools.md", "media/1-upload.png", "media/2-screenshot.png"]);
  expect(shown.files[0].content).toContain("(<media/2-screenshot.png>)");
});

it("names a saved attachment after its file, not the temporary path it was uploaded from", async () => {
  const session = { title: "Paths", messages: [{ role: "## You", blocks: [{ type: "text", text: "![Shot](attachment:0)" }] }],
    attachments: [{ label: "/var/folders/zm/T/TemporaryItems/Screenshot 2026-10-16 at 11.22.04 PM.png", image: true, mime: "image/png" }] };
  const result = await sessionFiles(session, {}, async () => new Blob(["png"], { type: "image/png" }), new AbortController().signal);
  expect(result.files.map(f => f.filename)).toEqual(["paths.md", "media/1-Screenshot 2026-10-16 at 11.22.04 PM.png"]);
  expect(result.files[0].content).toContain("(<media/1-Screenshot 2026-10-16 at 11.22.04 PM.png>)");
});
