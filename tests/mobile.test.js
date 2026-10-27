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
// completion() callback that receives the result.
async function runOnPage(html, href) {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  let result;
  const context = { document, location: { href }, URL, JSON, console, completion: value => { result = JSON.parse(value); },
    setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id) };
  vi.useFakeTimers();
  try {
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
});

it("explains what to do on a page that is not a Google AI answer", async () => {
  expect((await runOnPage("<p>Hello</p>", "https://example.com/")).error).toMatch(/Google AI Mode or AI Overview/);
  expect((await runOnPage("<p>Plain results</p>", "https://www.google.com/search?q=x")).error).toMatch(/No AI Overview/);
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
