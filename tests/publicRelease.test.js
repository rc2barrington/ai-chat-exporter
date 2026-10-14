import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { editionBlurb, readmeEditionBlock, toPublicFile } from "../scripts/publicFiles.js";
import { EDITION } from "../src/edition.js";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const edition = readFileSync(new URL("../src/edition.js", import.meta.url));

it("keeps the README edition description generated from src/edition.js", () => {
  expect(readmeEditionBlock(readme)).toBe(editionBlurb(EDITION));
});

it("produces the public edition setting and README from the private sources", () => {
  if (EDITION !== "private") return; // The public checkout is already converted.
  const publicEdition = toPublicFile("src/edition.js", edition).toString();
  expect(publicEdition).toContain('export const EDITION = "public";');
  expect(publicEdition).not.toContain('EDITION = "private"');
  const publicReadme = toPublicFile("README.md", Buffer.from(readme)).toString();
  expect(readmeEditionBlock(publicReadme)).toBe(editionBlurb("public"));
  expect(publicReadme).not.toContain("publishing command is disabled");
});

it("refuses to release when an anchor is missing instead of copying private text", () => {
  expect(() => toPublicFile("src/edition.js", Buffer.from('export const EDITION = "public";'))).toThrow(/private edition line/);
  expect(() => toPublicFile("README.md", Buffer.from("# No markers"))).toThrow(/edition markers/);
});

it("leaves every other file unchanged", () => {
  const bytes = Buffer.from("console.log(1);");
  expect(toPublicFile("src/main.jsx", bytes)).toBe(bytes);
});

it("describes each edition's real sources and ports", () => {
  expect(editionBlurb("private")).toMatch(/Codex, Claude Code and OpenCode.*4178/);
  expect(editionBlurb("public")).toMatch(/reads Codex and Claude Code, and runs .*4179/);
});
