import { generateMarkdown } from "../generators/markdown.js";
import { sanitizeFilename } from "./download.js";
import "../../chrome-extension/exportCore.js";

export async function sessionFiles(session, options, loadAttachment, signal) {
  const messages = [{ text: generateMarkdown(session, options) }];
  const markdown = text => ({ filename: sanitizeFilename(session.title, "chat-export") + ".md", content: text });
  // With the attachment folder off, a chat saves as its Markdown file alone,
  // and each attachment is named where it was, as text.
  if (options.attachmentFolder === false) {
    const text = messages[0].text.replace(/(!?)\[([^\]]*)\]\(attachment:(\d+)\)/g, (_, image, linkText, index) => {
      const label = session.attachments?.[index]?.label || linkText;
      return `[${image ? "Image" : "File"}: ${label.split(/[\\/]/).filter(Boolean).pop() || label}]`;
    });
    return { files: [markdown(text)], failures: [], duplicates: 0 };
  }
  const saved = [], failures = [];
  for (const [index, attachment] of (session.attachments || []).entries()) {
    // Only files the Markdown links to. Images inside hidden tool output, or
    // in your own messages with AI replies only, would be unlinked clutter.
    if (!messages[0].text.includes(`(attachment:${index})`)) continue;
    signal.throwIfAborted();
    try {
      const blob = await loadAttachment(attachment, index, signal);
      if (!blob.size) throw new Error("Empty attachment");
      // A label can be a full path, such as a screenshot's temporary file.
      // Name the saved copy after the file itself.
      const label = attachment.label.split(/[\\/]/).filter(Boolean).pop()?.replace(/[:*?"<>|\p{Cc}]/gu, "-").replace(/^\.+/, "").slice(-180) || "attachment";
      const filename = `${index + 1}-${label}`;
      saved.push({ filename, blob, type: attachment.image ? "image/unknown" : attachment.mime });
      messages[0].text = messages[0].text.replaceAll(`(attachment:${index})`, `(<media/${filename}>)`);
    } catch (error) {
      signal.throwIfAborted();
      failures.push(`${attachment.label}: ${error.message}`);
      messages[0].text = messages[0].text.replaceAll(`(attachment:${index})`, `(attachment-unavailable) [File unavailable: ${attachment.label.replace(/[\r\n]/g, " ")}]`);
    }
  }
  const result = await globalThis.AIChatExporterCore.deduplicateImages(saved, messages, () => signal.throwIfAborted());
  const files = [markdown(messages[0].text)];
  for (const media of result.savedMedia) files.push({ filename: "media/" + media.filename, content: await media.blob.arrayBuffer() });
  signal.throwIfAborted();
  return { files, failures, duplicates: result.duplicates };
}
