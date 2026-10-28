// Builds the iPhone Shortcut that saves a Google AI Mode or AI Overview chat
// from Safari's Share menu as Markdown. macOS only, because Apple's
// `shortcuts sign` tool is needed for the file to import on an iPhone.
// Usage: node scripts/build-shortcut.js
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chmodSync } from "node:fs";
import { buildMobileScript } from "./build-mobile.js";

export const SHORTCUT_NAME = "Save Google AI Chat";
const escapeXml = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Minimal XML property-list writer for the Shortcut's structure.
function plist(value, indent = "") {
  const next = indent + "  ";
  if (Array.isArray(value)) return value.length ? `<array>\n${value.map(v => next + plist(v, next)).join("\n")}\n${indent}</array>` : "<array/>";
  if (value === true || value === false) return value ? "<true/>" : "<false/>";
  if (typeof value === "number") return `<integer>${value}</integer>`;
  if (typeof value === "string") return `<string>${escapeXml(value)}</string>`;
  return `<dict>\n${Object.entries(value).map(([k, v]) => `${next}<key>${escapeXml(k)}</key>\n${next}${plist(v, next)}`).join("\n")}\n${indent}</dict>`;
}

const output = (uuid, name) => ({ Type: "ActionOutput", OutputUUID: uuid, OutputName: name });
const attachment = value => ({ Value: value, WFSerializationType: "WFTextTokenAttachment" });
// Text with one variable in it. Ranges count UTF-16 units, like NSString.
const textWith = (before, value, after) => ({ Value: { string: `${before}￼${after}`, attachmentsByRange: { [`{${before.length}, 1}`]: value } }, WFSerializationType: "WFTextTokenString" });
const tokenText = value => textWith("", value, "");
const action = (id, parameters) => ({ WFWorkflowActionIdentifier: `is.workflow.actions.${id}`, WFWorkflowActionParameters: parameters });

export function buildShortcutPlist(script = buildMobileScript()) {
  const ids = { js: "8B0F9C2E-1A6D-4D2B-9F61-3E5A7C1D0A01", dict: "8B0F9C2E-1A6D-4D2B-9F61-3E5A7C1D0A02", error: "8B0F9C2E-1A6D-4D2B-9F61-3E5A7C1D0A03",
    markdown: "8B0F9C2E-1A6D-4D2B-9F61-3E5A7C1D0A04", filename: "8B0F9C2E-1A6D-4D2B-9F61-3E5A7C1D0A05", named: "8B0F9C2E-1A6D-4D2B-9F61-3E5A7C1D0A06",
    endIf: "8B0F9C2E-1A6D-4D2B-9F61-3E5A7C1D0A07", group: "8B0F9C2E-1A6D-4D2B-9F61-3E5A7C1D0A08", saved: "8B0F9C2E-1A6D-4D2B-9F61-3E5A7C1D0A09" };
  const value = key => output(key === "error" ? ids.error : key === "markdown" ? ids.markdown : ids.filename, "Dictionary Value");
  const getValue = (key, uuid) => action("getvalueforkey", { UUID: uuid, WFGetDictionaryValueType: "Value", WFDictionaryKey: key, WFInput: attachment(output(ids.dict, "Dictionary")) });
  const workflow = {
    WFWorkflowActions: [
      action("runjavascriptonwebpage", { UUID: ids.js, WFInput: attachment({ Type: "ExtensionInput" }), WFJavaScript: script }),
      action("detect.dictionary", { UUID: ids.dict, WFInput: attachment(output(ids.js, "Result of JavaScript")) }),
      getValue("error", ids.error),
      action("conditional", { GroupingIdentifier: ids.group, WFControlFlowMode: 0, WFCondition: 100,
        WFInput: { Type: "Variable", Variable: attachment(value("error")) } }),
      action("alert", { WFAlertActionTitle: "Couldn't save this chat", WFAlertActionMessage: tokenText(value("error")), WFAlertActionCancelButtonShown: false }),
      action("exit", {}),
      action("conditional", { GroupingIdentifier: ids.group, WFControlFlowMode: 1 }),
      getValue("markdown", ids.markdown),
      getValue("filename", ids.filename),
      action("setitemname", { UUID: ids.named, WFInput: attachment(value("markdown")), WFName: tokenText(value("filename")), WFDontIncludeFileExtension: true }),
      // Saved straight into iCloud Drive › Shortcuts. With "Ask Where to Save",
      // iOS 26 opens a folder picker from the Share menu that starts on an
      // empty Recents list with a greyed-out Open button, and the Shortcut
      // waits on it with no time limit.
      action("documentpicker.save", { UUID: ids.saved, WFInput: attachment(output(ids.named, "Renamed Item")), WFAskWhereToSave: false }),
      action("notification", { WFNotificationActionTitle: "Saved to Files", WFNotificationActionBody: textWith("", value("filename"), " is in iCloud Drive › Shortcuts.") }),
      action("conditional", { UUID: ids.endIf, GroupingIdentifier: ids.group, WFControlFlowMode: 2 }),
    ],
    WFWorkflowClientVersion: "4711.1.1",
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowMinimumClientVersionString: "900",
    WFWorkflowIcon: { WFWorkflowIconStartColor: 463140863, WFWorkflowIconGlyphNumber: 59446 },
    WFWorkflowImportQuestions: [],
    WFWorkflowInputContentItemClasses: ["WFSafariWebPageContentItem"],
    WFWorkflowOutputContentItemClasses: [],
    WFWorkflowTypes: ["ActionExtension"],
    WFWorkflowHasShortcutInputVariables: true,
    WFQuickActionSurfaces: [],
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${plist(workflow)}\n</plist>\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = fileURLToPath(new URL(`../public/downloads/${SHORTCUT_NAME}.shortcut`, import.meta.url));
  const dir = mkdtempSync(path.join(tmpdir(), "shortcut-"));
  try {
    const unsigned = path.join(dir, `${SHORTCUT_NAME}.shortcut`);
    writeFileSync(unsigned, buildShortcutPlist());
    execFileSync("plutil", ["-lint", unsigned], { stdio: "inherit" });
    execFileSync("shortcuts", ["sign", "--mode", "anyone", "--input", unsigned, "--output", out], { stdio: "inherit" });
    chmodSync(out, 0o644);
    // The signed file cannot be read back, so record which script it holds.
    writeFileSync(fileURLToPath(new URL("../mobile/shortcut-script.sha256", import.meta.url)), createHash("sha256").update(buildMobileScript()).digest("hex") + "\n");
    console.log(`Signed ${out}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
