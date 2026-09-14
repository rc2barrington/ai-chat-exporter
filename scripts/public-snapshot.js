import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];
if (!target || !path.isAbsolute(target)) throw new Error("Provide an absolute path to a NEW public snapshot directory.");
const destination = path.resolve(target);
if (destination === root || destination.startsWith(root + path.sep)) throw new Error("The public snapshot must be outside the private checkout.");
const roots = new Set(["README.md", "SECURITY.md", ".gitignore", "Open AI Chat Exporter.command", "index.html", "favicon.svg", "icons.svg", "package.json", "package-lock.json", "eslint.config.js", "vite.config.js", ".github/workflows/ci.yml"]);
const allowed = name => roots.has(name) || /^(?:src|server|scripts|tests)\/[A-Za-z0-9_./ -]+\.(?:js|jsx|css)$/.test(name) || /^public\/(?:favicon|icons)\.svg$/.test(name) || /^chrome-extension\/(?:[A-Za-z]+\.(?:js|html)|manifest\.json|lib\/jszip\.min\.js|icons\/icon(?:16|32|48|128)\.png)$/.test(name);
const names = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const files = [];
for (const name of names) {
  if (!allowed(name)) continue;
  if (name.split("/").some(part => part === "..")) throw new Error("Invalid source path.");
  const source = path.join(root, name);
  if (!(await lstat(source)).isFile()) throw new Error(`Not a regular source file: ${name}`);
  let bytes = await readFile(source);
  if (!name.endsWith(".png")) {
    let text = bytes.toString("utf8");
    if (/\/Users\/[A-Za-z0-9_-]+\/|\/home\/[A-Za-z0-9_-]+\/|(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_]{15,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(text)) throw new Error(`Privacy review required: ${name}. Nothing has been published.`);
    if (name === "src/edition.js") text = text.replace('export const EDITION = "private";', 'export const EDITION = "public";');
    if (name === "README.md") text = text.replace("This checkout is the **private edition**, with Codex and OpenCode. It runs on your computer at port 4178. Its publishing command is disabled.", "This checkout is the **public edition**, with Codex and Claude Code. It runs on your computer at port 4179.\n\n**[Open the website](https://rc2barrington.github.io/ai-chat-exporter/)**");
    bytes = Buffer.from(text);
  }
  files.push({ name, bytes });
}
if (!files.some(file => file.name === "src/edition.js" && file.bytes.toString().includes('EDITION = "public"'))) throw new Error("Stage the reviewed edition source before creating a snapshot.");
// Never overwrite an existing public checkout or copy a hidden private history.
await mkdir(destination);
for (const { name, bytes } of files) {
  await mkdir(path.dirname(path.join(destination, name)), { recursive: true });
  await writeFile(path.join(destination, name), bytes, { mode: name.endsWith(".command") ? 0o755 : 0o644 });
}
await writeFile(path.join(destination, "release-manifest.json"), JSON.stringify({ edition: "public", version: "1.0.0", files: files.map(({ name, bytes }) => ({ name, sha256: createHash("sha256").update(bytes).digest("hex") })) }, null, 2) + "\n");
console.log(`Prepared ${files.length} allowlisted files in ${destination}. No Git history, profiles, settings or conversation exports were copied. Review before publishing.`);
