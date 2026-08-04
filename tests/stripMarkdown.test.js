import { describe, it, expect } from "vitest";
import { stripMarkdown } from "../src/utils/stripMarkdown.js";
import { buildConsoleCode, consoleCode } from "../src/parsers/browserScript.js";

describe("stripMarkdown", () => {
  it("removes inline emphasis and code markers", () => {
    expect(stripMarkdown("**bold** and *italic* and `code`")).toBe("bold and italic and code");
    expect(stripMarkdown("__bold__ and _italic_ and ~~struck~~")).toBe("bold and italic and struck");
  });

  it("strips heading hashes and blockquote markers without eating blank lines", () => {
    expect(stripMarkdown("# Title\n\n> quoted")).toBe("Title\n\nquoted");
  });

  it("converts links to their text and images to alt text", () => {
    expect(stripMarkdown("see [the docs](https://example.com)")).toBe("see the docs");
    expect(stripMarkdown("![a diagram](img.png)")).toBe("a diagram");
  });

  it("keeps fenced code contents verbatim, including asterisks", () => {
    const out = stripMarkdown("Try:\n\n```js\nconst a = b * c;\nlet d = **e;\n```");
    expect(out).toContain("const a = b * c;");
    expect(out).toContain("let d = **e;");
    expect(out).not.toContain("```");
  });

  it("does not corrupt prose that literally contains the placeholder word", () => {
    const out = stripMarkdown("The word FENCE0 appears here.\n\n```\ncode\n```");
    expect(out).toContain("The word FENCE0 appears here.");
    expect(out).toContain("code");
  });

  it("normalizes bullet markers but removes horizontal rules", () => {
    expect(stripMarkdown("* one\n+ two\n- three")).toBe("- one\n- two\n- three");
    expect(stripMarkdown("above\n\n---\n\nbelow")).toBe("above\n\nbelow");
  });

  it("collapses runs of blank lines and trims", () => {
    expect(stripMarkdown("\n\na\n\n\n\nb\n\n")).toBe("a\n\nb");
  });

  it("returns an empty string for empty input", () => {
    expect(stripMarkdown("")).toBe("");
    expect(stripMarkdown(null)).toBe("");
  });
});

describe("buildConsoleCode", () => {
  it("produces a syntactically valid script in both modes", () => {
    expect(() => new Function(buildConsoleCode())).not.toThrow();
    expect(() => new Function(buildConsoleCode({ repliesOnlyText: true }))).not.toThrow();
  });

  it("defaults to markdown mode", () => {
    expect(consoleCode).toContain("var REPLIES_ONLY_TXT = false;");
    expect(buildConsoleCode()).toContain("var REPLIES_ONLY_TXT = false;");
  });

  it("sets the flag in replies-only mode", () => {
    expect(buildConsoleCode({ repliesOnlyText: true })).toContain("var REPLIES_ONLY_TXT = true;");
  });

  it("embeds the shared stripMarkdown implementation so the two cannot drift", () => {
    const code = buildConsoleCode({ repliesOnlyText: true });
    // A distinctive line from the real implementation, not a reimplementation.
    expect(code).toContain("!\\[([^\\]]*)\\]\\([^)]*\\)");
  });

  // Regression: the production build minifies stripMarkdown's identifier, so
  // pasting the function as a bare declaration left the script calling an
  // undefined name. The embedded copy must be bound to an explicit variable.
  it("binds the embedded stripper to a name minification cannot change", () => {
    const code = buildConsoleCode({ repliesOnlyText: true });
    expect(code).toContain("var stripMarkdown = function");
    expect(code).toContain("stripMarkdown(body)");
  });

  it("the embedded stripper still works when its identifier is renamed", () => {
    // Simulate what terser does: rename the declared function.
    const renamed = buildConsoleCode({ repliesOnlyText: true }).replace(
      /var stripMarkdown = function stripMarkdown\(/,
      "var stripMarkdown = function b("
    );
    const start = renamed.indexOf("var stripMarkdown = function");
    let depth = 0;
    let end = start;
    for (let i = renamed.indexOf("{", start); i < renamed.length; i++) {
      if (renamed[i] === "{") depth++;
      else if (renamed[i] === "}") {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    const fn = new Function(renamed.slice(start, end) + "; return stripMarkdown;")();
    expect(fn("**bold** and `code`")).toBe("bold and code");
  });

  it("saves .txt in replies-only mode and skips media", () => {
    const code = buildConsoleCode({ repliesOnlyText: true });
    expect(code).toContain("safeBase + '.txt'");
    expect(code).toContain("if (REPLIES_ONLY_TXT) mediaQueue.length = 0;");
    expect(code).toContain("m.role !== '## You'");
  });

  it("still supports Grok detection in both modes", () => {
    for (const code of [buildConsoleCode(), buildConsoleCode({ repliesOnlyText: true })]) {
      expect(code).toContain("captureGrok");
      expect(code).toContain("grok\\.com");
    }
  });
});
