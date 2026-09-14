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

  it("drops the branch abandoned by an edited message, keeping the retry", () => {
    const jsonl =
      line({ type: "user", uuid: "u1", parentUuid: null, message: { content: "start" } }) +
      line({ type: "assistant", uuid: "a1", parentUuid: "u1", requestId: "r1", message: { content: [{ type: "text", text: "ok" }] } }) +
      // first attempt, later rewritten
      line({ type: "user", uuid: "u2", parentUuid: "a1", message: { content: "ORIGINAL" } }) +
      line({ type: "assistant", uuid: "a2", parentUuid: "u2", requestId: "r2", message: { content: [{ type: "text", text: "STALE REPLY" }] } }) +
      // the rewrite forks from the same parent and continues
      line({ type: "user", uuid: "u3", parentUuid: "a1", message: { content: "REWRITTEN" } }) +
      line({ type: "assistant", uuid: "a3", parentUuid: "u3", requestId: "r3", message: { content: [{ type: "text", text: "FRESH REPLY" }] } });
    const out = parseClaudeCodeJsonl(jsonl);
    const text = JSON.stringify(out.messages);
    expect(text).toContain("REWRITTEN");
    expect(text).toContain("FRESH REPLY");
    expect(text).not.toContain("ORIGINAL");
    expect(text).not.toContain("STALE REPLY");
  });

  it("keeps every root chain when one file holds several sessions", () => {
    // Resuming or clearing a session starts a new root in the same file;
    // following a single chain back from the newest leaf would lose the first.
    const jsonl =
      line({ type: "user", uuid: "u1", parentUuid: null, message: { content: "SEGMENT ONE" } }) +
      line({ type: "assistant", uuid: "a1", parentUuid: "u1", requestId: "r1", message: { content: [{ type: "text", text: "reply one" }] } }) +
      line({ type: "user", uuid: "u2", parentUuid: null, message: { content: "SEGMENT TWO" } }) +
      line({ type: "assistant", uuid: "a2", parentUuid: "u2", requestId: "r2", message: { content: [{ type: "text", text: "reply two" }] } });
    const out = parseClaudeCodeJsonl(jsonl);
    expect(out.messages).toHaveLength(4);
    expect(JSON.stringify(out.messages)).toContain("SEGMENT ONE");
    expect(JSON.stringify(out.messages)).toContain("SEGMENT TWO");
  });

  it("ignores injected meta lines and subagent sidechains", () => {
    const jsonl =
      line({ type: "user", uuid: "u1", parentUuid: null, message: { content: "real question" } }) +
      line({ type: "user", uuid: "m1", parentUuid: "u1", isMeta: true, message: { content: "INJECTED CONTEXT" } }) +
      line({ type: "user", uuid: "s1", parentUuid: "u1", isSidechain: true, message: { content: "SUBAGENT CHATTER" } });
    const out = parseClaudeCodeJsonl(jsonl);
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0].blocks[0].text).toBe("real question");
  });

  it("renders a slash command without its scaffolding tags", () => {
    const jsonl = line({
      type: "user",
      uuid: "u1",
      parentUuid: null,
      message: {
        content:
          "<local-command-caveat>noise</local-command-caveat>" +
          "<command-name>/model</command-name>" +
          "<command-message>model</command-message>" +
          "<command-args>claude-opus-5</command-args>" +
          "<local-command-stdout>Set model</local-command-stdout>",
      },
    });
    const out = parseClaudeCodeJsonl(jsonl);
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0].blocks[0].text).toBe("/model claude-opus-5");
  });

  it("drops a user turn that is nothing but injected context", () => {
    const jsonl =
      line({ type: "user", uuid: "u1", parentUuid: null, message: { content: "<system-reminder>only noise</system-reminder>" } });
    const out = parseClaudeCodeJsonl(jsonl);
    expect(out.messages).toHaveLength(0);
  });

  it("prefers a user-set custom title over the generated one", () => {
    const jsonl =
      line({ type: "ai-title", aiTitle: "Generated" }) +
      line({ type: "custom-title", customTitle: "My Own Title" }) +
      line({ type: "user", message: { content: "hi" } });
    expect(parseClaudeCodeJsonl(jsonl).title).toBe("My Own Title");
  });

  it("skips encrypted thinking blocks that carry no text", () => {
    const jsonl =
      line({ type: "user", message: { content: "go" } }) +
      line({
        type: "assistant",
        requestId: "r1",
        message: {
          content: [
            { type: "thinking", thinking: "   ", signature: "enc" },
            { type: "text", text: "answer" },
          ],
        },
      });
    const out = parseClaudeCodeJsonl(jsonl);
    expect(out.messages[1].blocks).toHaveLength(1);
    expect(out.messages[1].blocks[0].type).toBe("text");
  });

  it("reports Claude Code as the source", () => {
    const out = parseClaudeCodeJsonl(line({ type: "user", message: { content: "hi" } }));
    expect(out.source).toBe("Claude Code");
  });
});
