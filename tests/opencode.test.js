import { expect, it } from "vitest";
import { parseOpenCode } from "../src/parsers/opencode.js";
import { generateMarkdown } from "../src/generators/markdown.js";

it("exports OpenCode text, files, reasoning, calls and results without duplicate bookkeeping", () => {
  const session = parseOpenCode({ info: { title: "Test", time: { created: 1000, updated: 2000 } }, messages: [
    { info: { role: "user", id: "1" }, parts: [{ type: "text", text: "First prompt" }, { type: "file", filename: "notes.md", url: "file:///tmp/notes.md" }] },
    { info: { role: "assistant", id: "2" }, parts: [{ type: "reasoning", text: "Summary" }, { type: "step-start" }, { type: "tool", tool: "read", callID: "call", state: { status: "completed", input: { file: "notes.md" }, output: "Contents" } }, { type: "text", text: "Done" }] },
  ] });
  expect(session.messages).toHaveLength(2);
  expect(session.messages[0].blocks[0].text).toBe("First prompt");
  const md = generateMarkdown(session, { includeThinking: true, includeTools: true, includeResults: true, truncateChars: 0 });
  for (const text of ["OpenCode", "First prompt", "notes.md", "Summary", "Contents", "Done"]) expect(md).toContain(text);
});

it("excludes the reverted tail of the active OpenCode conversation", () => {
  const session = parseOpenCode({ info: { revert: { messageID: "2" } }, messages: [1, 2, 3].map(id => ({ info: { id: String(id), role: "user" }, parts: [{ type: "text", text: `Prompt ${id}` }] })) });
  expect(session.messages).toHaveLength(1);
});

it("rejects unrelated JSON", () => { expect(() => parseOpenCode("{}")).toThrow(/Not an OpenCode/); });

it("names the model behind each OpenCode reply, including a switch partway through", () => {
  const reply = (id, modelID, text) => ({ info: { id, role: "assistant", providerID: "opencode-go", modelID }, parts: [{ type: "text", text }] });
  const session = parseOpenCode({ info: { title: "Models" }, messages: [
    { info: { id: "1", role: "user", model: { providerID: "opencode-go", modelID: "kimi-k3" } }, parts: [{ type: "text", text: "Hi" }] },
    reply("2", "kimi-k3", "First"), reply("3", "glm-5.3", "Second"), reply("4", "kimi-k3", "Third"),
    { info: { id: "5", role: "assistant" }, parts: [{ type: "text", text: "Older reply without a model" }] },
  ] });
  expect(session.messages.map(m => m.role)).toEqual(["## You", "## OpenCode (kimi-k3)", "## OpenCode (glm-5.3)", "## OpenCode (kimi-k3)", "## OpenCode"]);
  expect(session.models).toEqual(["kimi-k3", "glm-5.3"]);
  const md = generateMarkdown(session, { frontmatter: true });
  expect(md).toContain('models: ["kimi-k3", "glm-5.3"]');
  expect(md).toContain("## OpenCode (glm-5.3)\n\nSecond");
  expect(generateMarkdown(session, { repliesOnly: true })).not.toContain("Hi");
});
