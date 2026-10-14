import { execFileSync } from "node:child_process";
import { REPOSITORY } from "../src/appConfig.js";

// Publish only from a checkout of the real repository.
const remote = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
const expected = new RegExp(`github\\.com[:/]${REPOSITORY.replace("/", "\\/")}(?:\\.git)?$`);
if (!expected.test(remote)) throw new Error("Unexpected publishing destination. No files were published.");
