import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

// Read a JSONL file one line at a time. Saved sessions can exceed JavaScript's
// maximum string length (about 512 MB), which makes readFile(..., "utf8")
// throw "Invalid string length" for exactly the chats with the most history.
export async function forEachLine(filename, visit) {
  const input = createReadStream(filename, { encoding: "utf8" });
  try {
    for await (const line of createInterface({ input, crlfDelay: Infinity })) {
      if (visit(line) === false) break;
    }
  } finally {
    input.destroy();
  }
}

export async function readLines(filename) {
  const lines = [];
  await forEachLine(filename, line => { lines.push(line); });
  return lines;
}

// Decode a data: URL to bytes. Returns null for anything else.
export function dataUrlBytes(url) {
  const match = /^data:([^,]*?)(;base64)?,/.exec(url);
  if (!match) return null;
  const payload = url.slice(match[0].length);
  return match[2] ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
}

// Move inline (data:) attachments into server memory and leave a short
// "local:N" reference in the session. Without this, a session full of
// screenshots is sent to the browser as hundreds of megabytes of base64 JSON.
export function inlineAttachmentStore() {
  const stored = [];
  return {
    stored,
    keep(record) {
      if (!record || typeof record.url !== "string" || !record.url.startsWith("data:")) return record;
      const bytes = dataUrlBytes(record.url);
      if (!bytes) return record;
      stored.push(bytes);
      return { ...record, url: `local:${stored.length - 1}` };
    },
  };
}
