// Runs inside an iOS Shortcut's "Run JavaScript on Web Page" action on a
// Google AI Mode or AI Overview page in Safari. It reads the conversation with
// the same Google adapter as the Chrome extension and returns the Markdown,
// formatted like the extension's .md files, for the Shortcut to save.
// scripts/build-mobile.js places browserAdapters.js above this file.
(async () => {
  const done = value => (typeof completion === "function" ? completion : console.log)(JSON.stringify(value));
  try {
    const adapters = globalThis.AIChatExporterBrowserAdapters;
    if (!adapters.isGoogleSearch(location.href)) throw new Error("Open a Google AI Mode or AI Overview answer in Safari, then run this from the Share menu.");
    const data = await adapters.exportGoogle(document, location.href, { includeMedia: false });
    const nl = "\n";
    let md = "---" + nl;
    md += "title: " + JSON.stringify(data.title) + nl;
    md += "source: " + data.siteName + nl;
    md += "source_url: " + JSON.stringify(location.href) + nl;
    md += "exporter_version: " + JSON.stringify(__EXPORTER_VERSION__) + nl;
    md += "exported_at: " + data.date + nl;
    md += "message_count: " + data.messageCount + nl;
    md += "media_count: 0" + nl;
    md += "---" + nl + nl;
    md += "# " + data.title + nl + nl;
    data.messages.forEach((message, index) => {
      md += message.role + nl + nl + message.text + nl + nl;
      if (index < data.messages.length - 1) md += "---" + nl + nl;
    });
    const name = data.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60) || "chat-export";
    done({ filename: name + ".md", markdown: md });
  } catch (error) {
    done({ error: String(error && error.message || error) });
  }
})();
