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

// Runs the iPhone Shortcut script the way Shortcuts does: in the page, with a
// completion() callback that receives the result. `elapsed` is how long the
// script took in page time; Shortcuts stops it after a few seconds.
// `setup` can attach page behavior, such as Google's "Show more" handler.
async function runOnPage(html, href, setup) {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  setup?.(document);
  let result;
  vi.useFakeTimers();
  try {
    const start = Date.now();
    const context = { document, location: { href }, URL, JSON, console, Date,
      completion: value => { result = { ...JSON.parse(value), elapsed: Date.now() - start }; },
      setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id) };
    vm.runInNewContext(committed, context);
    await vi.runAllTimersAsync();
  } finally { vi.useRealTimers(); }
  return result;
}

it("ships the iPhone script built from the current Google adapter", () => {
  expect(committed).toBe(buildMobileScript());
  expect(committed).toContain(`AI Chat Exporter ${VERSION}`);
});

it("saves a mobile Google AI Mode conversation as the extension's Markdown", async () => {
  const turn = (q, a) => `<div jsname="RH7zg"><span role="heading" aria-level="2"><span jsname="y5v2y">${q}</span></span><div data-container-id="main-col">${a}</div></div>`;
  const href = "https://www.google.com/search?q=heat+pumps&udm=50";
  const result = await runOnPage(turn("How do heat pumps work?", "<p>They move heat.</p>") + turn("In winter?", "<p>Down to about -13°F.</p>"), href);
  expect(result.error).toBeUndefined();
  expect(result.filename).toBe("how-do-heat-pumps-work.md");
  const md = result.markdown;
  expect(md.startsWith('---\ntitle: "How do heat pumps work?"\nsource: Google AI Mode\nsource_url: "' + href + '"\nexporter_version: "' + VERSION + '"\n')).toBe(true);
  expect(md).toContain("message_count: 4\nmedia_count: 0\n---\n\n# How do heat pumps work?\n\n## You\n\nHow do heat pumps work?\n\n---\n\n## Google AI Mode\n\nThey move heat.");
  expect(md.trimEnd().endsWith("## Google AI Mode\n\nDown to about -13°F.")).toBe(true);
  // A finished conversation is read straight away, with no waiting.
  expect(result.elapsed).toBe(0);
});

// A chat reopened from history keeps every earlier turn inside one RH7zg
// block. 1.2.14 saved only the first question and answer of such a chat.
it("saves every turn of a chat reopened from history", async () => {
  const box = i => `<div jsname="CS7uPe" data-complete="true"><span role="heading"><span jsname="y5v2y">Question ${i}</span></span><div data-container-id="main-col"><div jsname="KFl8ub"><p>Answer ${i}</p></div></div></div>`;
  const html = `<div jsname="RH7zg">${Array.from({ length: 80 }, (_, i) => box(i + 1)).join("")}</div>`;
  const result = await runOnPage(html, "https://www.google.com/search?q=Question+1&udm=50");
  expect(result.error).toBeUndefined();
  expect(result.elapsed).toBe(0);
  expect(result.markdown).toContain("message_count: 160\n");
  expect(result.markdown.match(/^## You$/gm)).toHaveLength(80);
  expect(result.markdown).toContain("## You\n\nQuestion 80\n\n---\n\n## Google AI Mode\n\nAnswer 80");
});

// Measured in iPhone Safari: one AI Mode answer carried a 412,215 character
// inline JPEG, so the Markdown handed to Shortcuts was 416 KB.
it("keeps inline pictures out of the Markdown so Shortcuts gets a small result", async () => {
  const inline = `data:image/jpeg;base64,${"A".repeat(412215)}`;
  const html = `<div jsname="RH7zg"><span jsname="y5v2y">How do heat pumps work?</span><div data-container-id="main-col"><p>They move heat.</p><img src="${inline}" alt="Heat pump diagram"><img src="https://encrypted-tbn1.gstatic.com/images?q=tbn:x" alt="Outdoor unit"></div></div>`;
  const result = await runOnPage(html, "https://www.google.com/search?q=heat+pumps&udm=50");
  expect(result.error).toBeUndefined();
  expect(result.elapsed).toBe(0);
  expect(result.markdown.length).toBeLessThan(1000);
  expect(result.markdown).toContain("They move heat.\n\n[Image: Heat pump diagram]\n\n![Outdoor unit](https://encrypted-tbn1.gstatic.com/images?q=tbn:x)");
});

// Replays ActionExtension.js from the iOS 26 Shortcuts app: the script becomes
// the body of new Function("completion", script), and every completion() reply
// also carries the page's full HTML. Safari allows the whole round trip two
// seconds, and Google's AI Mode page measured 3.8 MB of HTML in iPhone Safari.
it("keeps Apple's reply to the result, not the whole page, and leaves the page as it was", () => {
  const filler = `<script>${"x".repeat(3_000_000)}</script>`;
  const { document } = parseHTML(`<!DOCTYPE html><html><head>${filler}</head><body><div jsname="RH7zg"><span jsname="y5v2y">How do heat pumps work?</span><div data-container-id="main-col"><p>They move heat.</p></div></div></body></html>`);
  const replies = [];
  const context = { document, location: { href: "https://www.google.com/search?q=heat+pumps&udm=50" }, URL, JSON, console, Date, setTimeout, clearTimeout, SCRIPT: committed, replies };
  vm.runInNewContext(`new Function("completion", SCRIPT)(function (result) {
    var doctype = document.doctype;
    replies.push({ userResult: JSON.stringify(result), document: (doctype ? "<!DOCTYPE " + doctype.name + ">\\n" : "") + document.documentElement.outerHTML });
  });`, context);
  expect(replies).toHaveLength(1);
  const { markdown } = JSON.parse(JSON.parse(replies[0].userResult));
  expect(markdown).toContain("## Google AI Mode\n\nThey move heat.");
  expect(replies[0].document.length).toBeLessThan(100);
  expect(JSON.stringify(replies[0]).length).toBeLessThan(2000);
  // The page reads normally again once the reply is sent.
  expect(document.documentElement.outerHTML.length).toBeGreaterThan(3_000_000);
  expect(Object.hasOwn(document.documentElement, "outerHTML")).toBe(false);
});

// Google expands the overview a moment after the tap, and its "Show more"
// button keeps aria-expanded="false" afterwards, as on the live mobile page.
it("expands a collapsed AI Overview and saves all of it well inside the Shortcuts time limit", async () => {
  const html = '<div id="m-x-content"><div data-container-id="main-col"><p>The sky is blue because of <strong>Rayleigh scattering</strong>.</p>' +
    '<div id="rest" aria-hidden="true"><p>Shorter blue waves scatter the most.</p></div></div></div>' +
    '<div role="button" aria-expanded="false" aria-controls="m-x-content"><span>Show more</span></div>';
  const href = "https://www.google.com/search?q=why+is+the+sky+blue";
  const result = await runOnPage(html, href, document => document.querySelector('[aria-controls="m-x-content"]')
    .addEventListener("click", () => queueMicrotask(() => document.querySelector("#rest").removeAttribute("aria-hidden"))));
  expect(result.error).toBeUndefined();
  expect(result.filename).toBe("why-is-the-sky-blue.md");
  expect(result.markdown).toContain('source_url: "' + href + '"');
  expect(result.markdown).toContain("## Google AI Overview\n\nThe sky is blue because of **Rayleigh scattering**.\n\nShorter blue waves scatter the most.");
  expect(result.elapsed).toBeLessThanOrEqual(150);
});

it("explains what to do on a page that is not a Google AI answer", async () => {
  expect((await runOnPage("<p>Hello</p>", "https://example.com/")).error).toMatch(/Google AI Mode or AI Overview/);
  const plain = await runOnPage("<p>Plain results</p>", "https://www.google.com/search?q=x");
  expect(plain.error).toMatch(/No AI Overview/);
  // An answer that might still be loading gets a short retry that leaves most
  // of Safari's two seconds for sending the reply.
  expect(plain.elapsed).toBeLessThanOrEqual(800);
  const writing = await runOnPage('<div jsname="RH7zg"><span jsname="y5v2y">Q</span><div data-container-id="main-col"><p data-complete="false">Partial</p></div></div>', "https://www.google.com/search?q=x&udm=50");
  expect(writing.error).toMatch(/incomplete/);
  expect(writing.elapsed).toBeLessThanOrEqual(800);
});

it("builds a Share Sheet Shortcut for Safari pages that runs the script and saves the file", () => {
  const xml = buildShortcutPlist("SCRIPT & <TEXT>");
  for (const id of ["runjavascriptonwebpage", "detect.dictionary", "getvalueforkey", "conditional", "alert", "exit", "setitemname", "documentpicker.save"]) expect(xml).toContain(`is.workflow.actions.${id}`);
  // No folder picker: from Safari's Share menu iOS 26 waits on it with no time
  // limit. The file goes straight to Downloads, a location every iPhone can
  // resolve, and the confirmation is an alert, which needs no permission.
  expect(xml).toMatch(/<key>WFAskWhereToSave<\/key>\s*<false\/>/);
  expect(xml).not.toMatch(/<key>WFAskWhereToSave<\/key>\s*<true\/>/);
  expect(xml).toMatch(/<key>WFFolder<\/key>\s*<dict>\s*<key>fileLocation<\/key>\s*<dict>\s*<key>WFFileLocationType<\/key>\s*<string>Downloads<\/string>\s*<key>relativeSubpath<\/key>\s*<string><\/string>\s*<\/dict>/);
  expect(xml).not.toContain("is.workflow.actions.notification");
  expect(xml).toContain("<string>￼ is in Files › iCloud Drive › Downloads.</string>");
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
