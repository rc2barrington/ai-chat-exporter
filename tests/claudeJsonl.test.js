import { describe, it, expect } from "vitest";
import { parseClaudeCodeJsonl } from "../src/parsers/claudeJsonl.js";

const line = (obj) => JSON.stringify(obj) + "\n";

describe("parseClaudeCodeJsonl", () => {
  it("parses a basic user/assistant exchange", () => {
    const jsonl =
      line({ type: "ai-title", aiTitle: "Hello world chat" }) +
      line({ type: "user", message: { content: "hi there" }, timestamp: "2026-05-01T12:00:00Z" }) +
      line({
        type: "assistant",
        requestId: "r1",
        message: { content: [{ type: "text", text: "hello!" }] },
        timestamp: "2026-05-01T12:00:01Z",
      });
    const out = parseClaudeCodeJsonl(jsonl);
    expect(out.title).toBe("Hello world chat");
    expect(out.messages).toHaveLength(2);
    expect(out.messages[0].role).toBe("## You");
    expect(out.messages[0].blocks[0].text).toBe("hi there");
    expect(out.messages[1].role).toBe("## Claude");
    expect(out.startedAt).toBe("2026-05-01T12:00:00.000Z");
    expect(out.endedAt).toBe("2026-05-01T12:00:01.000Z");
  });

  it("merges consecutive assistant turns sharing a requestId", () => {
    const jsonl =
      line({ type: "user", message: { content: "go" }, timestamp: "2026-05-01T12:00:00Z" }) +
      line({
        type: "assistant",
        requestId: "r1",
        message: { content: [{ type: "thinking", thinking: "ponder" }] },
        timestamp: "2026-05-01T12:00:01Z",
      }) +
      line({
        type: "assistant",
        requestId: "r1",
        message: { content: [{ type: "text", text: "answer" }] },
        timestamp: "2026-05-01T12:00:02Z",
      });
    const out = parseClaudeCodeJsonl(jsonl);
    expect(out.messages).toHaveLength(2);
    expect(out.messages[1].blocks).toHaveLength(2);
    expect(out.messages[1].blocks[0].type).toBe("thinking");
    expect(out.messages[1].blocks[1].type).toBe("text");
  });

  it("attaches tool_result blocks (from user turn) to the prior assistant turn", () => {
    const jsonl =
      line({ type: "user", message: { content: "run ls" }, timestamp: "2026-05-01T12:00:00Z" }) +
      line({
        type: "assistant",
        requestId: "r1",
        message: { content: [{ type: "tool_use", id: "t1", name: "bash", input: { cmd: "ls" } }] },
        timestamp: "2026-05-01T12:00:01Z",
      }) +
      line({
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "t1", content: "file1\nfile2", is_error: false }],
        },
        timestamp: "2026-05-01T12:00:02Z",
      });
    const out = parseClaudeCodeJsonl(jsonl);
    // user turn with only a tool_result shouldn't show as a separate "You" message
    expect(out.messages).toHaveLength(2);
    const lastBlocks = out.messages[1].blocks;
    expect(lastBlocks[0].type).toBe("tool_use");
    expect(lastBlocks[1].type).toBe("tool_result");
    expect(lastBlocks[1].content).toBe("file1\nfile2");
  });

  it("skips malformed JSONL lines without crashing", () => {
    const jsonl =
      "not json\n" +
      line({ type: "user", message: { content: "ok" } }) +
      "{ broken\n";
    const out = parseClaudeCodeJsonl(jsonl);
    expect(out.messages).toHaveLength(1);
  });

  it("computes min/max timestamps even when lines arrive out of order", () => {
    const jsonl =
      line({ type: "user", message: { content: "a" }, timestamp: "2026-05-01T12:00:05Z" }) +
      line({ type: "assistant", message: { content: [{ type: "text", text: "b" }] }, timestamp: "2026-05-01T12:00:01Z" });
    const out = parseClaudeCodeJsonl(jsonl);
    expect(out.startedAt).toBe("2026-05-01T12:00:01.000Z");
    expect(out.endedAt).toBe("2026-05-01T12:00:05.000Z");
  });
});
