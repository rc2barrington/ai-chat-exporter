import { describe, it, expect, vi } from "vitest";

// DOMPurify needs a browser DOM; the markdown renderer isn't what's under test.
vi.mock("../src/utils/markdownRender.js", () => ({
  renderMarkdown: (text) => `<p>${text}</p>`,
}));

const { generateHtml } = await import("../src/generators/html.js");

const session = {
  title: "Test Session",
  date: "2026-05-01 12:00",
  startedAt: "2026-05-01T12:00:00Z",
  endedAt: "2026-05-01T12:01:00Z",
  source: "Claude Desktop",
  messages: [
    { role: "## You", blocks: [{ type: "text", text: "hi there" }] },
    {
      role: "## Claude",
      blocks: [
        { type: "thinking", thinking: "internal reasoning" },
        { type: "text", text: "hello back" },
      ],
    },
  ],
};

describe("generateHtml", () => {
  it("interpolates the conversation body, title, and subtitle", () => {
    const html = generateHtml(session, {});
    expect(html).toContain("hi there");
    expect(html).toContain("hello back");
    expect(html).toContain("Test Session");
    expect(html).toContain("Exported from Claude Desktop on 2026-05-01 12:00");
    // Regression: these were once emitted literally due to escaped template expressions.
    expect(html).not.toContain("${bodyContent}");
    expect(html).not.toContain("${escapeHtml");
  });

  it("hides thinking when includeThinking is false", () => {
    const html = generateHtml(session, { includeThinking: false });
    expect(html).not.toContain("internal reasoning");
  });
});
