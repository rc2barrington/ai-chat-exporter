import { describe, it, expect } from "vitest";
import { parseCodexJsonl } from "../src/parsers/codexJsonl.js";

const L = (o) => JSON.stringify(o);
const ri = (payload, timestamp = "2026-08-01T10:00:00Z") =>
  L({ timestamp, type: "response_item", payload });

describe("parseCodexJsonl", () => {
  it("reads user and assistant turns from response_item records", () => {
    const out = parseCodexJsonl([
      L({ timestamp: "2026-08-01T10:00:00Z", type: "session_meta", payload: { id: "x", timestamp: "2026-08-01T10:00:00Z", cwd: "/tmp" } }),
      ri({ type: "message", role: "user", content: [{ type: "input_text", text: "USER ASK" }] }),
      ri({ type: "message", role: "assistant", content: [{ type: "output_text", text: "REPLY" }] }),
    ].join("\n"));
    expect(out.source).toBe("Codex");
    expect(out.messages.map((m) => m.role)).toEqual(["## You", "## Codex"]);
    expect(out.messages[1].blocks[0].text).toBe("REPLY");
  });

  // event_msg mirrors the same conversation as UI events; reading both would
  // duplicate every message.
  it("ignores event_msg so messages are not duplicated", () => {
    const out = parseCodexJsonl([
      L({ timestamp: "2026-08-01T10:00:00Z", type: "event_msg", payload: { type: "user_message", message: "USER ASK" } }),
      ri({ type: "message", role: "user", content: [{ type: "input_text", text: "USER ASK" }] }),
      L({ timestamp: "2026-08-01T10:00:01Z", type: "event_msg", payload: { type: "agent_message", message: "REPLY" } }),
      ri({ type: "message", role: "assistant", content: [{ type: "output_text", text: "REPLY" }] }),
    ].join("\n"));
    expect(out.messages).toHaveLength(2);
  });

  it("merges consecutive assistant output into one turn", () => {
    const out = parseCodexJsonl([
      ri({ type: "message", role: "user", content: [{ type: "input_text", text: "ASK" }] }),
      ri({ type: "reasoning", summary: [{ type: "summary_text", text: "THINKING" }] }),
      ri({ type: "custom_tool_call", call_id: "c1", name: "bash", input: '{"cmd":"ls"}' }),
      ri({ type: "custom_tool_call_output", call_id: "c1", output: [{ type: "output_text", text: "OUT" }] }),
      ri({ type: "message", role: "assistant", content: [{ type: "output_text", text: "PART ONE" }] }),
      ri({ type: "message", role: "assistant", content: [{ type: "output_text", text: "PART TWO" }] }),
    ].join("\n"));
    expect(out.messages).toHaveLength(2);
    const kinds = out.messages[1].blocks.map((b) => b.type);
    expect(kinds).toEqual(["thinking", "tool_use", "tool_result", "text", "text"]);
    expect(out.messages[1].blocks[1].input).toEqual({ cmd: "ls" });
  });

  it("drops developer messages, which are injected instructions", () => {
    const out = parseCodexJsonl([
      ri({ type: "message", role: "developer", content: [{ type: "input_text", text: "<skills_instructions>NOPE</skills_instructions>" }] }),
      ri({ type: "message", role: "user", content: [{ type: "input_text", text: "REAL" }] }),
    ].join("\n"));
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0].blocks[0].text).toBe("REAL");
  });

  it("strips injected scaffolding and reconstructs slash commands", () => {
    const out = parseCodexJsonl([
      ri({ type: "message", role: "user", content: [{ type: "input_text",
        text: "<command-name>/model</command-name><command-args>gpt</command-args><local-command-stdout>noise</local-command-stdout>" }] }),
      ri({ type: "message", role: "user", content: [{ type: "input_text",
        text: "<environment_context>cwd=/tmp</environment_context>real question" }] }),
    ].join("\n"));
    expect(out.messages[0].blocks[0].text).toBe("/model gpt");
    expect(out.messages[1].blocks[0].text).toBe("real question");
  });

  it("discards a turn that was nothing but scaffolding", () => {
    const out = parseCodexJsonl(
      ri({ type: "message", role: "user", content: [{ type: "input_text", text: "<task-notification>done</task-notification>" }] })
    );
    expect(out.messages).toHaveLength(0);
  });

  it("skips reasoning that carries only encrypted content", () => {
    const out = parseCodexJsonl([
      ri({ type: "message", role: "user", content: [{ type: "input_text", text: "ASK" }] }),
      ri({ type: "reasoning", summary: [], encrypted_content: "OPAQUE" }),
      ri({ type: "message", role: "assistant", content: [{ type: "output_text", text: "REPLY" }] }),
    ].join("\n"));
    expect(out.messages[1].blocks.map((b) => b.type)).toEqual(["text"]);
  });

  it("titles from the first user message, falling back to the filename", () => {
    const withUser = parseCodexJsonl(
      ri({ type: "message", role: "user", content: [{ type: "input_text", text: "Build a thing" }] })
    );
    expect(withUser.title).toBe("Build a thing");

    const noUser = parseCodexJsonl(
      ri({ type: "message", role: "assistant", content: [{ type: "output_text", text: "hi" }] }),
      { fileName: "rollout-2026-08-01T17-16-36-019f.jsonl" }
    );
    expect(noUser.title).toBe("Codex Session 2026-08-01 17:16");
  });

  it("survives malformed lines and empty input", () => {
    const out = parseCodexJsonl(["{not json", "", ri({ type: "message", role: "user", content: [{ type: "input_text", text: "OK" }] })].join("\n"));
    expect(out.messages).toHaveLength(1);
    expect(parseCodexJsonl("").messages).toHaveLength(0);
  });
});
