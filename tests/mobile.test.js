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
  // An answer that might still be loading gets a short retry, never seconds.
  expect(plain.elapsed).toBeLessThanOrEqual(1600);
  const writing = await runOnPage('<div jsname="RH7zg"><span jsname="y5v2y">Q</span><div data-container-id="main-col"><p data-complete="false">Partial</p></div></div>', "https://www.google.com/search?q=x&udm=50");
  expect(writing.error).toMatch(/incomplete/);
  expect(writing.elapsed).toBeLessThanOrEqual(1600);
});

it("builds a Share Sheet Shortcut for Safari pages that runs the script and saves the file", () => {
  const xml = buildShortcutPlist("SCRIPT & <TEXT>");
  for (const id of ["runjavascriptonwebpage", "detect.dictionary", "getvalueforkey", "conditional", "alert", "exit", "setitemname", "documentpicker.save"]) expect(xml).toContain(`is.workflow.actions.${id}`);
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
