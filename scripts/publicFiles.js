import { EDITIONS, SOURCE_NAMES } from "../src/edition.js";

// Everything that differs between the private and public source trees is
// produced here, from the EDITIONS table, so the two can never disagree about
// which sources an edition has or which port it uses.

const README_START = "<!-- edition:start -->";
const README_END = "<!-- edition:end -->";
const PRIVATE_LINE = 'export const EDITION = "private";';
const PUBLIC_LINE = 'export const EDITION = "public";';

function list(names) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function editionBlurb(edition) {
  const config = EDITIONS[edition];
  if (!config) throw new Error(`Unknown edition: ${edition}`);
  const sources = list(config.sources.map(source => SOURCE_NAMES[source]));
  const other = edition === "private" ? "public" : "private";
  const otherSources = list(EDITIONS[other].sources.map(source => SOURCE_NAMES[source]));
  const lines = [
    `This checkout is the **${edition} edition**. Its local app reads ${sources}, and runs on your computer at port ${config.port}.${edition === "private" ? " Its publishing command is disabled." : ""}`,
    "",
    `The ${other} edition reads ${otherSources} at port ${EDITIONS[other].port}. Both editions include the same browser exports: ChatGPT, Claude.ai, Gemini, Grok, Google AI Overviews, Google AI Mode, Muse and Perplexity.`,
  ];
  if (edition === "public") lines.push("", "**[Open the website](https://rc2barrington.github.io/ai-chat-exporter/)**");
  return lines.join("\n");
}

export function readmeEditionBlock(readme) {
  const start = readme.indexOf(README_START), end = readme.indexOf(README_END);
  if (start < 0 || end < start) throw new Error("README.md is missing its edition markers. Nothing was copied.");
  return readme.slice(start + README_START.length, end).trim();
}

// Convert one private source file into its public form. Throws instead of
// silently copying private wording when an expected anchor is missing.
export function toPublicFile(name, bytes) {
  if (name === "src/edition.js") {
    const text = bytes.toString("utf8");
    if (!text.includes(PRIVATE_LINE)) throw new Error("src/edition.js no longer contains the private edition line. Nothing was copied.");
    return Buffer.from(text.replace(PRIVATE_LINE, PUBLIC_LINE));
  }
  if (name === "README.md") {
    const text = bytes.toString("utf8");
    readmeEditionBlock(text);
    const start = text.indexOf(README_START) + README_START.length, end = text.indexOf(README_END);
    return Buffer.from(`${text.slice(0, start)}\n${editionBlurb("public")}\n${text.slice(end)}`);
  }
  return bytes;
}
