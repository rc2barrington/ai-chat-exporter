import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import process from "node:process";
import { parseHTML } from "linkedom";
import { expect, it, vi } from "vitest";
import { buildMobileScript } from "../scripts/build-mobile.js";
import { buildShortcutPlist, SHORTCUT_NAME } from "../scripts/build-shortcut.js";
import { VERSION } from "../src/appConfig.js";

const committed = readFileSync(new URL("../mobile/google-ai-export.js", import.meta.url), "utf8");

// Safari's download as the script starts it: a link to a blob URL, clicked.
// `file()` is what Safari was asked to save, if anything.
function captureDownloads(document) {
  const blobs = new Map(), clicked = [];
  const create = document.createElement.bind(document);
  document.createElement = tag => {
    const element = create(tag);
    if (tag === "a") element.click = () => clicked.push({ name: element.download, blob: blobs.get(element.getAttribute("href")) });
    return element;
  };
  return {
    URL: class extends URL { static createObjectURL(blob) { const url = `blob:https://www.google.com/${blobs.size}`; blobs.set(url, blob); return url; } },
    file: async () => {
      expect(clicked.length).toBeLessThanOrEqual(1);
      return clicked[0] && { name: clicked[0].name, type: clicked[0].blob.type, text: await clicked[0].blob.text() };
    },
  };
}

// Runs the iPhone Shortcut script the way Shortcuts does: in the page, with a
// completion() callback that receives the result. `elapsed` is how long the
// script took in page time; Shortcuts stops it after a few seconds.
// `setup` can attach page behavior, such as Google's "Show more" handler.
async function runOnPage(html, href, setup) {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  setup?.(document);
  const download = captureDownloads(document);
  let result, elapsed;
  vi.useFakeTimers();
  try {
    const start = Date.now();
    const context = { document, location: { href }, URL: download.URL, Blob, JSON, console, Date,
      completion: value => { result = JSON.parse(value); elapsed = Date.now() - start; },
      setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id) };
    vm.runInNewContext(committed, context);
    await vi.runAllTimersAsync();
  } finally { vi.useRealTimers(); }
  return { result, elapsed, file: await download.file() };
}

it("ships the iPhone script built from the current Google adapter", () => {
  expect(committed).toBe(buildMobileScript());
  expect(committed).toContain(`AI Chat Exporter ${VERSION}`);
});

it("has Safari download a mobile Google AI Mode conversation as the extension's Markdown", async () => {
  const turn = (q, a) => `<div jsname="RH7zg"><span role="heading" aria-level="2"><span jsname="y5v2y">${q}</span></span><div data-container-id="main-col">${a}</div></div>`;
  const href = "https://www.google.com/search?q=heat+pumps&udm=50";
  const { result, elapsed, file } = await runOnPage(turn("How do heat pumps work?", "<p>They move heat.</p>") + turn("In winter?", "<p>Down to about -13°F.</p>"), href);
  // Shortcuts only gets the file name back; the chat goes to Safari.
  expect(result).toEqual({ filename: "how-do-heat-pumps-work.md" });
  expect(file.name).toBe("how-do-heat-pumps-work.md");
  expect(file.type).toBe("text/markdown");
  const md = file.text;
  expect(md.startsWith('---\ntitle: "How do heat pumps work?"\nsource: Google AI Mode\nsource_url: "' + href + '"\nexporter_version: "' + VERSION + '"\n')).toBe(true);
  expect(md).toContain("message_count: 4\nmedia_count: 0\n---\n\n# How do heat pumps work?\n\n## You\n\nHow do heat pumps work?\n\n---\n\n## Google AI Mode\n\nThey move heat.");
  expect(md.trimEnd().endsWith("## Google AI Mode\n\nDown to about -13°F.")).toBe(true);
  // A finished conversation is read straight away, with no waiting.
  expect(elapsed).toBe(0);
});

// A chat reopened from history keeps every earlier turn inside one RH7zg
// block. 1.2.14 saved only the first question and answer of such a chat.
// 1.2.15 saved every turn but passed them all back through Shortcuts, and on
// the iPhone a 50 to 100 turn chat then spun without finishing.
it("saves every turn of a chat reopened from history, and hands Shortcuts only the file name", async () => {
  const box = i => `<div jsname="CS7uPe" data-complete="true"><span role="heading"><span jsname="y5v2y">Question ${i}</span></span><div data-container-id="main-col"><div jsname="KFl8ub"><p>Answer ${i}</p></div></div></div>`;
  const html = `<div jsname="RH7zg">${Array.from({ length: 80 }, (_, i) => box(i + 1)).join("")}</div>`;
  const { result, elapsed, file } = await runOnPage(html, "https://www.google.com/search?q=Question+1&udm=50");
  expect(result).toEqual({ filename: "question-1.md" });
  expect(elapsed).toBe(0);
  expect(file.text).toContain("message_count: 160\n");
  expect(file.text.match(/^## You$/gm)).toHaveLength(80);
  expect(file.text).toContain("## You\n\nQuestion 80\n\n---\n\n## Google AI Mode\n\nAnswer 80");
});

// Measured in iPhone Safari: one AI Mode answer carried a 412,215 character
// inline JPEG, so the Markdown was 416 KB.
it("keeps inline pictures out of the Markdown so the file stays small", async () => {
  const inline = `data:image/jpeg;base64,${"A".repeat(412215)}`;
  const html = `<div jsname="RH7zg"><span jsname="y5v2y">How do heat pumps work?</span><div data-container-id="main-col"><p>They move heat.</p><img src="${inline}" alt="Heat pump diagram"><img src="https://encrypted-tbn1.gstatic.com/images?q=tbn:x" alt="Outdoor unit"></div></div>`;
  const { result, elapsed, file } = await runOnPage(html, "https://www.google.com/search?q=heat+pumps&udm=50");
  expect(result.error).toBeUndefined();
  expect(elapsed).toBe(0);
  expect(file.text.length).toBeLessThan(1000);
  expect(file.text).toContain("They move heat.\n\n[Image: Heat pump diagram]\n\n![Outdoor unit](https://encrypted-tbn1.gstatic.com/images?q=tbn:x)");
});

// Replays ActionExtension.js from the iOS 26 Shortcuts app: the script becomes
// the body of new Function("completion", script), and every completion() reply
// also carries the page's full HTML. Safari allows the whole round trip two
// seconds, and Google's AI Mode page measured 3.8 MB of HTML in iPhone Safari.
it("keeps Apple's reply to the file name, not the whole page, and leaves the page as it was", async () => {
  const filler = `<script>${"x".repeat(3_000_000)}</script>`;
  const { document } = parseHTML(`<!DOCTYPE html><html><head>${filler}</head><body><div jsname="RH7zg"><span jsname="y5v2y">How do heat pumps work?</span><div data-container-id="main-col"><p>They move heat.</p></div></div></body></html>`);
  const download = captureDownloads(document);
  const replies = [];
  const context = { document, location: { href: "https://www.google.com/search?q=heat+pumps&udm=50" }, URL: download.URL, Blob, JSON, console, Date, setTimeout, clearTimeout, SCRIPT: committed, replies };
  vm.runInNewContext(`new Function("completion", SCRIPT)(function (result) {
    var doctype = document.doctype;
    replies.push({ userResult: JSON.stringify(result), document: (doctype ? "<!DOCTYPE " + doctype.name + ">\\n" : "") + document.documentElement.outerHTML });
  });`, context);
  expect(replies).toHaveLength(1);
  expect(JSON.parse(JSON.parse(replies[0].userResult))).toEqual({ filename: "how-do-heat-pumps-work.md" });
  expect((await download.file()).text).toContain("## Google AI Mode\n\nThey move heat.");
  expect(replies[0].document.length).toBeLessThan(100);
  expect(JSON.stringify(replies[0]).length).toBeLessThan(200);
  // The page reads normally again once the reply is sent, and the download
  // link is gone from it.
  expect(document.documentElement.outerHTML.length).toBeGreaterThan(3_000_000);
  expect(Object.hasOwn(document.documentElement, "outerHTML")).toBe(false);
  expect(document.querySelector("a")).toBeNull();
});

// Google expands the overview a moment after the tap, and its "Show more"
// button keeps aria-expanded="false" afterwards, as on the live mobile page.
it("expands a collapsed AI Overview and saves all of it well inside the Shortcuts time limit", async () => {
  const html = '<div id="m-x-content"><div data-container-id="main-col"><p>The sky is blue because of <strong>Rayleigh scattering</strong>.</p>' +
    '<div id="rest" aria-hidden="true"><p>Shorter blue waves scatter the most.</p></div></div></div>' +
    '<div role="button" aria-expanded="false" aria-controls="m-x-content"><span>Show more</span></div>';
  const href = "https://www.google.com/search?q=why+is+the+sky+blue";
  const { result, elapsed, file } = await runOnPage(html, href, document => document.querySelector('[aria-controls="m-x-content"]')
    .addEventListener("click", () => queueMicrotask(() => document.querySelector("#rest").removeAttribute("aria-hidden"))));
  expect(result).toEqual({ filename: "why-is-the-sky-blue.md" });
  expect(file.text).toContain('source_url: "' + href + '"');
  expect(file.text).toContain("## Google AI Overview\n\nThe sky is blue because of **Rayleigh scattering**.\n\nShorter blue waves scatter the most.");
  expect(elapsed).toBeLessThanOrEqual(150);
});

it("explains what to do on a page that is not a Google AI answer, and saves nothing", async () => {
  const elsewhere = await runOnPage("<p>Hello</p>", "https://example.com/");
  expect(elsewhere.result.error).toMatch(/Google AI Mode or AI Overview/);
  expect(elsewhere.file).toBeUndefined();
  const plain = await runOnPage("<p>Plain results</p>", "https://www.google.com/search?q=x");
  expect(plain.result.error).toMatch(/No AI Overview/);
  expect(plain.file).toBeUndefined();
  // An answer that might still be loading gets a short retry that leaves most
  // of Safari's two seconds for sending the reply.
  expect(plain.elapsed).toBeLessThanOrEqual(800);
  const writing = await runOnPage('<div jsname="RH7zg"><span jsname="y5v2y">Q</span><div data-container-id="main-col"><p data-complete="false">Partial</p></div></div>', "https://www.google.com/search?q=x&udm=50");
  expect(writing.result.error).toMatch(/incomplete/);
  expect(writing.elapsed).toBeLessThanOrEqual(800);
  expect(writing.file).toBeUndefined();
});

it("builds a Share Sheet Shortcut for Safari pages that runs the script and shows its errors", () => {
  const xml = buildShortcutPlist("SCRIPT & <TEXT>");
  for (const id of ["runjavascriptonwebpage", "detect.dictionary", "getvalueforkey", "conditional", "alert"]) expect(xml).toContain(`is.workflow.actions.${id}`);
  // Safari saves the file, so the chat never passes through Shortcuts and no
  // Save File step can wait on a folder picker. Errors are shown in an alert,
  // which needs no permission, unlike a notification.
  for (const id of ["documentpicker.save", "setitemname", "notification"]) expect(xml).not.toContain(`is.workflow.actions.${id}`);
  expect(xml).toContain("<string>Couldn't save this chat</string>");
  expect(xml).toContain("<string>WFSafariWebPageContentItem</string>");
  expect(xml).toContain("<string>ActionExtension</string>");
  expect(xml).toContain("SCRIPT &amp; &lt;TEXT&gt;");
  if (process.platform === "darwin") {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "shortcut-test-")), "t.shortcut");
    writeFileSync(file, xml);
    expect(() => execFileSync("plutil", ["-lint", file])).not.toThrow();
  }
  // Apple's signed format starts with "AEA1".
  const signed = new URL(`../public/downloads/${SHORTCUT_NAME}.shortcut`, import.meta.url);
  expect(existsSync(signed)).toBe(true);
  expect(readFileSync(signed).subarray(0, 4).toString()).toBe("AEA1");
  // Rebuild with `node scripts/build-shortcut.js` on a Mac when this fails.
  const signedScript = readFileSync(new URL("../mobile/shortcut-script.sha256", import.meta.url), "utf8").trim();
  expect(signedScript).toBe(createHash("sha256").update(buildMobileScript()).digest("hex"));
});
