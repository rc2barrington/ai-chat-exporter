import { readFileSync } from "node:fs";
import vm from "node:vm";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

// Records every blob the offscreen document hands out, by URL.
function blobUrls() {
  const blobs = new Map();
  return { blobs, URL: { createObjectURL(blob) { const url = `blob:test/${blobs.size}`; blobs.set(url, blob); return url; }, revokeObjectURL() {} } };
}
// Reads a folder export back as { path: text }.
async function folderOf(response, blobs) {
  const out = {};
  for (const file of response.files) out[file.path] = await blobs.get(file.url).text();
  return out;
}
import "../chrome-extension/exportCore.js";
import "../chrome-extension/exportTransport.js";

const source = readFileSync(
  new URL("../chrome-extension/offscreen.js", import.meta.url),
  "utf8"
);

describe("offscreen packaging", () => {
  it('excludes user messages and their files from replies-only archives', async () => {
    let onMessage;
    const { blobs, URL } = blobUrls();
    const context = {
      AbortController, Blob, console, fetch, setTimeout, clearTimeout,
      AIChatExporterCore: globalThis.AIChatExporterCore,
      AIChatExporterTransport: globalThis.AIChatExporterTransport,
      setInterval: () => 1,
      URL,
      chrome: { runtime: {
        connect: () => ({ onDisconnect: { addListener() {} } }),
        onMessage: { addListener(fn) { onMessage = fn; } },
        sendMessage(_request, callback) { callback?.(); },
      } },
    };
    vm.runInNewContext(source, context);
    const response = await new Promise(resolve => onMessage({ action: 'zipAndDownload', options: { repliesOnly: true, includeMedia: true }, data: {
      title: 'Replies', siteName: 'Perplexity', messageCount: 2,
      messages: [{ role: '## You', text: 'USER SECRET ![upload](media/user.png)' }, { role: '## Perplexity', text: 'ANSWER ![output](media/answer.png)' }],
      savedMedia: ['user.png', 'answer.png'].map(filename => ({ filename, type: 'image/png', base64: 'YWJj' })),
      remoteQueue: [], failedFetches: [], appendix: 'USER APPENDIX',
    } }, {}, resolve));
    expect(response.status).toBe('success');
    expect(response.folder).toMatch(/^replies-\d{4}-\d{2}-\d{2}$/);
    const folder = await folderOf(response, blobs);
    expect(Object.keys(folder)).toEqual(['replies.md', 'media/answer.png']);
    const md = folder['replies.md'];
    expect(md).toContain('ANSWER');
    expect(md).not.toContain('USER');
    expect(md).toContain('message_count: 1');
    expect(md).toContain('export_scope: ai-replies-only');
  });
  it("packages chunked transfers with exact deduplication and authoritative history status", async () => {
    let onMessage;
    const { blobs, URL } = blobUrls();
    const context = {
      AbortController, Blob, console, fetch, setTimeout, clearTimeout,
      AIChatExporterCore: globalThis.AIChatExporterCore,
      AIChatExporterTransport: globalThis.AIChatExporterTransport,
      setInterval: () => 1,
      URL,
      chrome: { runtime: {
        connect: () => ({ onDisconnect: { addListener() {} } }),
        onMessage: { addListener(fn) { onMessage = fn; } },
        sendMessage(_request, callback) { callback?.(); },
      } },
    };
    vm.runInNewContext(source, context);
    const request = data => new Promise(resolve => onMessage(data, {}, resolve));
    await globalThis.AIChatExporterTransport.send({ title: "Complete", siteName: "ChatGPT", messageCount: 1,
      history: { status: "complete", basis: "Authoritative chain" },
      mediaDiagnostics: { historyRootReached: false },
      messages: [{ role: "## You", text: "FIRST ![one](media/a.png) ![two](media/b.png) LAST" }],
      savedMedia: ["a.png", "b.png"].map(filename => ({ filename, type: "image/png", base64: "YWJj" })),
    }, "test", request);
    const response = await request({ action: "zipAndDownload", transferId: "test", options: { includeMedia: true } });
    expect(response.status).toBe("success");
    const folder = await folderOf(response, blobs);
    expect(Object.keys(folder)).toEqual(["complete.md", "media/a.png"]);
    const text = folder["complete.md"];
    expect(text).toContain("history_status: complete");
    expect(text).not.toContain("false");
    expect(text).toContain("FIRST ![one](media/a.png) ![two](media/a.png) LAST");
    expect(folder["media/a.png"]).toBe("abc");
  });
  it("saves a chat with attachments as a folder named after the chat, without an error-report entry", async () => {
    let onMessage;
    const { blobs, URL } = blobUrls();
    const context = {
      AbortController, Blob, console, fetch, setTimeout, clearTimeout,
      setInterval: () => 1,
      URL,
      chrome: { runtime: {
        connect() { return { onDisconnect: { addListener() {} }, postMessage() {} }; },
        onMessage: { addListener(fn) { onMessage = fn; } },
        sendMessage(_message, callback) { callback?.(); },
      } },
    };
    vm.runInNewContext(source, context);
    const response = await new Promise(resolve => onMessage({ action: "zipAndDownload", options: { includeMedia: true }, data: {
      title: "Mixed media", siteName: "Google AI Mode", date: new Date().toISOString(), messageCount: 1,
      messages: [{ role: "## You", text: "![Saved](media/saved.txt) ![Missing](media/missing.png)" }],
      appendix: "## Conversation files\n\n- [Saved](media/saved.txt)\n- [Missing](media/missing.png)\n",
      savedMedia: [{ filename: "saved.txt", base64: "aGVsbG8=" }], remoteQueue: [],
      failedFetches: [{ filename: "missing.png", url: "https://example.test/missing.png", error: "HTTP 404" }],
    } }, {}, resolve));
    expect(response.status).toBe("success");
    expect(response.filename).toBeUndefined();
    expect(response.folder).toMatch(/^mixed-media-\d{4}-\d{2}-\d{2}$/);
    const folder = await folderOf(response, blobs);
    expect(Object.keys(folder)).toEqual(["mixed-media.md", "media/saved.txt"]);
    expect(folder["media/saved.txt"]).toBe("hello");
    const markdown = folder["mixed-media.md"];
    expect(markdown).toContain("## Conversation files");
    expect(markdown).toContain("- [Saved](media/saved.txt)");
    expect(markdown).toContain("- [Missing] [fetch failed](https://example.test/missing.png)");
  });

  it.each([false, true])("returns Markdown when no media was saved (failed attachments: %s)", async (failures) => {
    let onMessage;
    let createdBlob;
    const context = {
      AbortController,
      Blob,
      console,
      fetch,
      FileReader: class {},
      JSZip,
      setTimeout,
      clearTimeout,
      setInterval: () => 1,
      URL: {
        createObjectURL(blob) {
          createdBlob = blob;
          return "blob:extension-test/large-export";
        },
        revokeObjectURL() {},
      },
      chrome: {
        runtime: {
          lastError: null,
          connect() {
            return {
              onDisconnect: { addListener() {} },
              postMessage() {},
            };
          },
          onMessage: {
            addListener(listener) {
              onMessage = listener;
            },
          },
          sendMessage(_message, callback) {
            if (callback) callback();
          },
        },
      },
    };
    vm.runInNewContext(source, context, { filename: "offscreen.js" });

    const response = await new Promise((resolve, reject) => {
      const keepChannelOpen = onMessage({
        action: "zipAndDownload",
        options: { includeMedia: failures },
        data: {
          title: "Synthetic long chat",
          siteName: "ChatGPT",
          date: "2026-08-23T00:00:00.000Z",
          messageCount: 1,
          messages: [{ role: "## You", text: "x".repeat(2_000_000) }],
          savedMedia: [],
          remoteQueue: [],
          failedFetches: failures ? [{ filename: "missing.png", url: "https://example.test/missing.png", error: "HTTP 404" }] : [],
        },
      }, {}, resolve);
      if (keepChannelOpen !== true) reject(new Error("message channel did not stay open"));
    });

    expect(response).toMatchObject({
      status: "success",
      downloadUrl: "blob:extension-test/large-export",
      filename: "synthetic-long-chat.md",
    });
    expect(response).not.toHaveProperty("dataUrl");
    expect(createdBlob).toBeInstanceOf(Blob);
    expect(createdBlob.size).toBeGreaterThan(2_000_000);
  });

  it("aborts an in-flight remote media request and creates no file", async () => {
    let onMessage;
    let fetchedSignal;
    let createdObjectUrl = false;
    const context = {
      AbortController,
      Blob,
      console,
      fetch(_url, options) {
        fetchedSignal = options.signal;
        return new Promise((resolve, reject) => {
          const rejectAsAborted = () => {
            const error = new Error("request aborted");
            error.name = "AbortError";
            reject(error);
          };
          if (fetchedSignal.aborted) rejectAsAborted();
          else fetchedSignal.addEventListener("abort", rejectAsAborted, { once: true });
        });
      },
      FileReader: class {},
      JSZip,
      setTimeout,
      clearTimeout,
      setInterval: () => 1,
      URL: {
        createObjectURL() {
          createdObjectUrl = true;
          return "blob:extension-test/should-not-exist";
        },
        revokeObjectURL() {},
      },
      chrome: {
        runtime: {
          lastError: null,
          connect() {
            return {
              onDisconnect: { addListener() {} },
              postMessage() {},
            };
          },
          onMessage: {
            addListener(listener) {
              onMessage = listener;
            },
          },
          sendMessage(_message, callback) {
            if (callback) callback();
          },
        },
      },
    };
    vm.runInNewContext(source, context, { filename: "offscreen.js" });

    const packageResponse = new Promise(resolve => {
      const keepChannelOpen = onMessage({
        action: "zipAndDownload",
        runId: 41,
        options: { includeMedia: true },
        data: {
          title: "Cancelled chat",
          siteName: "ChatGPT",
          date: "2026-08-23T00:00:00.000Z",
          messageCount: 1,
          messages: [{ role: "## You", text: "attachment" }],
          savedMedia: [],
          remoteQueue: [{
            url: "https://example.test/stalled-image.png",
            filename: "stalled-image.png",
          }],
          failedFetches: [],
        },
      }, {}, resolve);
      expect(keepChannelOpen).toBe(true);
    });

    const staleCancelResponse = await new Promise(resolve => {
      const keepChannelOpen = onMessage({
        action: "cancelOffscreenExport",
        runId: "stale-run",
      }, {}, resolve);
      expect(keepChannelOpen).toBe(true);
    });
    expect(staleCancelResponse).toEqual({ status: "idle" });
    expect(fetchedSignal.aborted).toBe(false);

    const cancelResponse = await new Promise(resolve => {
      const keepChannelOpen = onMessage({
        action: "cancelOffscreenExport",
        runId: 41,
      }, {}, resolve);
      expect(keepChannelOpen).toBe(true);
    });

    await expect(packageResponse).resolves.toMatchObject({
      status: "cancelled",
      error: "Export cancelled.",
    });
    expect(cancelResponse).toEqual({ status: "cancelling" });
    expect(fetchedSignal.aborted).toBe(true);
    expect(createdObjectUrl).toBe(false);
  });
});
