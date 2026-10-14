// Release the private checkout to the public repository in one step:
//
//   npm run release:public                 updates ../ai-chat-exporter-public
//   npm run release:public -- /abs/path    creates a new snapshot directory
//
// The public tree is always derived from a COMMITTED private state, through an
// allowlist, with the edition differences produced by scripts/publicFiles.js.
// When updating an existing public checkout it mirrors the tree exactly:
// files removed here are removed there too, so the two cannot drift. It never
// copies Git history, never commits, and never pushes.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { toPublicFile } from "./publicFiles.js";
import { EDITION, VERSION } from "../src/edition.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });

if (EDITION !== "private") throw new Error("Run this from the private checkout. The public tree is generated from it.");

const target = path.resolve(process.argv[2] || path.join(root, "..", "ai-chat-exporter-public"));
if (target === root || target.startsWith(root + path.sep)) throw new Error("The public tree must be outside the private checkout.");

const roots = new Set(["README.md", "SECURITY.md", ".gitignore", "Open AI Chat Exporter.command", "index.html", "favicon.svg", "icons.svg", "package.json", "package-lock.json", "eslint.config.js", "vite.config.js", ".github/workflows/ci.yml"]);
export const allowed = name => roots.has(name)
  || /^(?:src|server|scripts|tests)\/[A-Za-z0-9_./ -]+\.(?:js|jsx|css)$/.test(name)
  || /^public\/(?:favicon|icons)\.svg$/.test(name)
  || /^chrome-extension\/(?:[A-Za-z]+\.(?:js|html)|manifest\.json|lib\/jszip\.min\.js|icons\/icon(?:16|32|48|128)\.png)$/.test(name);

// A release must correspond to a private commit, so uncommitted or untracked
// release files stop it instead of being swept in or silently left out.
const pending = git(root, "status", "--porcelain", "--untracked-files=all").split("\n").filter(Boolean)
  .map(line => line.slice(3).replace(/^"|"$/g, "").split(" -> ").pop()).filter(allowed);
if (pending.length) throw new Error(`Commit these private changes before releasing:\n  ${pending.join("\n  ")}`);

const files = [];
for (const name of git(root, "ls-files", "-z").split("\0").filter(Boolean)) {
  if (!allowed(name)) continue;
  if (name.split("/").includes("..")) throw new Error("Invalid source path.");
  const source = path.join(root, name);
  if (!(await lstat(source)).isFile()) throw new Error(`Not a regular source file: ${name}`);
  const bytes = toPublicFile(name, await readFile(source));
  if (!name.endsWith(".png") && /\/Users\/[A-Za-z0-9_-]+\/|\/home\/[A-Za-z0-9_-]+\/|(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_]{15,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(bytes.toString("utf8"))) {
    throw new Error(`Privacy review required: ${name}. Nothing was copied.`);
  }
  files.push({ name, bytes });
}

const updating = existsSync(target);
if (updating) {
  const remote = git(target, "remote", "get-url", "origin").trim();
  if (!/github\.com[:/]rc2barrington\/ai-chat-exporter(?:\.git)?$/.test(remote)) throw new Error(`${target} is not the public repository checkout. Nothing was copied.`);
  if (git(target, "status", "--porcelain").trim()) throw new Error(`${target} has uncommitted changes. Commit or discard them first. Nothing was copied.`);
  const wanted = new Set(files.map(file => file.name));
  for (const name of git(target, "ls-files", "-z").split("\0").filter(Boolean)) {
    if (allowed(name) && !wanted.has(name)) await rm(path.join(target, name));
  }
} else {
  await mkdir(target);
}
for (const { name, bytes } of files) {
  await mkdir(path.dirname(path.join(target, name)), { recursive: true });
  await writeFile(path.join(target, name), bytes, { mode: name.endsWith(".command") ? 0o755 : 0o644 });
}
await writeFile(path.join(target, "release-manifest.json"), JSON.stringify({ edition: "public", version: VERSION, files: files.map(({ name, bytes }) => ({ name, sha256: createHash("sha256").update(bytes).digest("hex") })) }, null, 2) + "\n");

console.log(`${updating ? "Updated" : "Created"} the public ${VERSION} tree at ${target} (${files.length} files).`);
if (updating) console.log(git(target, "status", "--short") || "No changes.");
console.log("Next: run npm ci, npm test and npm run build there, review the diff, then commit and push the public repository.");
