import { describe, it, expect } from "vitest";
import { generatePlainText, stripMarkdown } from "../src/generators/plainText.js";

const session = (messages) => ({ title: "T", source: "Claude Code", messages });

describe("generatePlainText", () => {
  it("keeps only assistant responses and drops user turns", () => {
    const out = generatePlainText(
      session([
        { role: "## You", blocks: [{ type: "text", text: "USER ASK" }] },
        { role: "## Claude", blocks: [{ type: "text", text: "FIRST REPLY" }] },
        { role: "## You", blocks: [{ type: "text", text: "SECOND ASK" }] },
        { role: "## Claude", blocks: [{ type: "text", text: "SECOND REPLY" }] },
      ])
    );
    expect(out).toContain("FIRST REPLY");
    expect(out).toContain("SECOND REPLY");
    expect(out).not.toContain("USER ASK");
    expect(out).not.toContain("SECOND ASK");
  });

  it("omits thinking and tool blocks, keeping only text", () => {
    const out = generatePlainText(
      session([
        {
          role: "## Claude",
          blocks: [
            { type: "thinking", thinking: "INTERNAL REASONING" },
            { type: "tool_use", name: "Bash", input: { command: "SECRET" } },
            { type: "tool_result", content: "TOOL OUTPUT" },
            { type: "text", text: "VISIBLE ANSWER" },
          ],
        },
      ])
    );
    expect(out.trim()).toBe("VISIBLE ANSWER");
  });

  it("emits no title, metadata, or role labels", () => {
    const out = generatePlainText(
      session([{ role: "## Claude", blocks: [{ type: "text", text: "BODY" }] }])
    );
    expect(out).not.toContain("T");
    expect(out).not.toContain("Claude Code");
    expect(out).not.toContain("##");
    expect(out.trim()).toBe("BODY");
  });

  it("separates consecutive responses with a blank line", () => {
    const out = generatePlainText(
      session([
        { role: "## Claude", blocks: [{ type: "text", text: "ONE" }] },
        { role: "## Claude", blocks: [{ type: "text", text: "TWO" }] },
      ])
    );
    expect(out).toBe("ONE\n\nTWO\n");
  });

  it("returns an empty string when there are no assistant responses", () => {
    expect(generatePlainText(session([{ role: "## You", blocks: [{ type: "text", text: "hi" }] }]))).toBe("");
    expect(generatePlainText(session([]))).toBe("");
    expect(generatePlainText(null)).toBe("");
  });
});

describe("stripMarkdown", () => {
  it("removes inline emphasis and code markers", () => {
    expect(stripMarkdown("**bold** and *italic* and `code`")).toBe("bold and italic and code");
    expect(stripMarkdown("__bold__ and _italic_ and ~~struck~~")).toBe("bold and italic and struck");
  });

  it("strips heading hashes and blockquote markers", () => {
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
});
