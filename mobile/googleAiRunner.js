// Runs inside an iOS Shortcut's "Run JavaScript on Web Page" action on a
// Google AI Mode or AI Overview page in Safari. It reads the conversation with
// the same Google adapter as the Chrome extension and returns the Markdown,
// formatted like the extension's .md files, for the Shortcut to save.
// scripts/build-mobile.js places browserAdapters.js above this file.
//
// Shortcuts stops this action after a few seconds, so it reads the page as it
// is instead of waiting for it to settle the way the extension does. A page
// that is ready is read once, with no timer. Expanding a collapsed AI Overview
// takes Google a few milliseconds, and an answer still being written gets
// until LIMIT ms to finish.
(async () => {
  const LIMIT = 1500;
  const done = value => (typeof completion === "function" ? completion : console.log)(JSON.stringify(value));
  try {
    const adapters = globalThis.AIChatExporterBrowserAdapters;
    // Expanding an AI Overview adds a #fragment, so keep the address from now.
    const href = location.href;
    if (!adapters.isGoogleSearch(href)) throw new Error("Open a Google AI Mode or AI Overview answer in Safari, then run this from the Share menu.");
    // An AI Overview starts collapsed behind "Show more", with the rest of the
    // answer marked aria-hidden. The button keeps aria-expanded="false" after
    // it expands, so the reads below show when the text has appeared.
    const expanding = [...document.querySelectorAll('[role="button"][aria-expanded="false"][aria-controls="m-x-content"]')];
    for (const button of expanding) button.click();
    const start = Date.now();
    let data, previous;
    for (;;) {
      let problem;
      try { data = adapters.extractGoogle(document, href, { includeMedia: false }); }
      catch (error) { problem = error; data = null; }
      const signature = data && JSON.stringify(data.messages);
      if (data && (!expanding.length || signature === previous)) break;
      if (Date.now() - start >= LIMIT) {
        if (data) break;
        throw problem;
      }
      previous = signature;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const nl = "\n";
    let md = "---" + nl;
    md += "title: " + JSON.stringify(data.title) + nl;
    md += "source: " + data.siteName + nl;
    md += "source_url: " + JSON.stringify(href) + nl;
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
