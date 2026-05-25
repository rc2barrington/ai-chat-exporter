import { describe, it, expect } from "vitest";
import { parseAntigravityMd } from "../src/parsers/antigravity.js";

const sample = `# Conversation History

## User Message 1
> first line
> second line of question

## Assistant Response 1
Here's the answer.

\`\`\`bash
ls
\`\`\`

## User Message 2
> only one line

## Assistant Response 2
Final answer.
`;

describe("parseAntigravityMd", () => {
  it("splits user/assistant blocks and strips blockquote markers", () => {
    const out = parseAntigravityMd(sample, {
      sidecarMetadata: { updatedAt: "2026-05-08T23:20:11.029138Z" },
      sessionId: "e57a657e-5615-47cc-ab03-9171e30246c2",
    });
    expect(out.messages).toHaveLength(4);
    expect(out.messages[0].role).toBe("## You");
    expect(out.messages[0].blocks[0].text).toBe("first line\nsecond line of question");
    expect(out.messages[1].role).toBe("## Antigravity");
    expect(out.messages[1].blocks[0].text).toContain("```bash");
    expect(out.source).toBe("Google Antigravity");
    expect(out.endedAt).toBe("2026-05-08T23:20:11.029138Z");
  });

  it("derives a title from the first user message when no sidecar title", () => {
    const out = parseAntigravityMd(sample);
    expect(out.title.startsWith("first line")).toBe(true);
  });

  it("falls back to session id when no messages provide a title", () => {
    const out = parseAntigravityMd("# Conversation History\n", { sessionId: "abcdef12-rest" });
    expect(out.title).toContain("abcdef12");
    expect(out.messages).toHaveLength(0);
  });
});
