import { execFileSync } from "node:child_process";
import { EDITION } from "../src/edition.js";

if (EDITION !== "public") throw new Error("Publishing is disabled in the private edition. Use the audited public snapshot.");
const remote = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
if (!/github\.com[:/]rc2barrington\/ai-chat-exporter(?:\.git)?$/.test(remote)) throw new Error("Unexpected publishing destination. No files were published.");
