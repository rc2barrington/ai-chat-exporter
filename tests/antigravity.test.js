import { describe, it, expect } from "vitest";
import { parseAntigravityMd, parseAntigravityJsonl } from "../src/parsers/antigravity.js";

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

const jsonlSample = [
  { step_index: 0, source: "USER_EXPLICIT", type: "USER_INPUT", created_at: "2026-05-20T10:00:00Z", content: "fix the bug\nsecond line" },
  { step_index: 1, source: "SYSTEM", type: "EPHEMERAL_MESSAGE", created_at: "2026-05-20T10:00:01Z", content: "thinking..." },
  { step_index: 2, source: "MODEL", type: "PLANNER_RESPONSE", created_at: "2026-05-20T10:00:02Z", thinking: "Let me look at the file.", content: "I'll inspect it.", tool_calls: [{ name: "view_file", args: { AbsolutePath: "/a/b.js", StartLine: 1, EndLine: 20 } }] },
  { step_index: 3, source: "MODEL", type: "VIEW_FILE", status: "DONE", created_at: "2026-05-20T10:00:03Z", content: "line1\nline2" },
  { step_index: 4, source: "MODEL", type: "RUN_COMMAND", status: "ERROR", created_at: "2026-05-20T10:00:04Z", content: "command not found" },
  { step_index: 5, source: "MODEL", type: "PLANNER_RESPONSE", created_at: "2026-05-20T10:00:05Z", content: "Done." },
  { step_index: 6, source: "USER_EXPLICIT", type: "USER_INPUT", created_at: "2026-05-20T10:00:06Z", content: "thanks" },
]
  .map((o) => JSON.stringify(o))
  .join("\n");

describe("parseAntigravityJsonl", () => {
  it("maps user/model lines into normalized blocks and skips SYSTEM noise", () => {
    const out = parseAntigravityJsonl(jsonlSample, { sessionId: "5f673b81-fa86-4c2f" });

    // user turn, one merged assistant turn, user turn
    expect(out.messages).toHaveLength(3);
    expect(out.messages[0].role).toBe("## You");
    expect(out.messages[0].blocks[0].text).toBe("fix the bug\nsecond line");

    const assistant = out.messages[1];
    expect(assistant.role).toBe("## Antigravity");
    const types = assistant.blocks.map((b) => b.type);
    expect(types).toEqual(["thinking", "tool_use", "text", "tool_result", "tool_result", "text"]);

    const toolUse = assistant.blocks.find((b) => b.type === "tool_use");
    expect(toolUse.name).toBe("view_file");
    expect(toolUse.input.AbsolutePath).toBe("/a/b.js");

    const errResult = assistant.blocks.filter((b) => b.type === "tool_result");
    expect(errResult[1].is_error).toBe(true);

    expect(out.messages[2].role).toBe("## You");
    expect(out.source).toBe("Google Antigravity");
  });

  it("computes startedAt/endedAt from min/max created_at", () => {
    const out = parseAntigravityJsonl(jsonlSample);
    expect(out.startedAt).toBe("2026-05-20T10:00:00Z");
    expect(out.endedAt).toBe("2026-05-20T10:00:06Z");
  });

  it("derives a title from the first user line and tolerates blank/malformed lines", () => {
    const messy = "\n" + jsonlSample.split("\n")[0] + "\nnot json at all\n";
    const out = parseAntigravityJsonl(messy, { sessionId: "abcdef12-zzz" });
    expect(out.title.startsWith("fix the bug")).toBe(true);
    expect(out.messages).toHaveLength(1);
  });
});
