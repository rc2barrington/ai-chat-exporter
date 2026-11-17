globalThis.AIChatExporterCore = (() => {
  function zipLocalDate(date = new Date()) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  }
  function stampZip(zip, now = new Date()) {
    // Also stamp automatically created directory entries. These otherwise
    // retain JSZip's UTC wall clock or an extractor's 1980 fallback.
    const date = zipLocalDate(now);
    zip.forEach((_path, entry) => { entry.date = date; });
    return zip;
  }
  function rewriteMedia(messages, aliases) {
    const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const message of messages) {
      for (const [from, to] of aliases) {
        const pattern = new RegExp("media/" + escape(from) + '(?=[)\\s`"<>]|$)', "g");
        message.text = message.text.replace(pattern, () => "media/" + to);
      }
    }
  }
  // Chrome renames a download whose extension does not fit its type: a JPEG
  // queued as "image.png" is saved as "image.jpeg", and the Markdown would
  // link to a file that is not there. Name each picture after what it is and
  // move its links with it.
  const IMAGE_EXTENSIONS = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp",
    "image/avif": ".avif", "image/svg+xml": ".svg", "image/heic": ".heic", "image/bmp": ".bmp", "image/tiff": ".tiff" };
  function matchImageExtensions(savedMedia, messages) {
    const taken = new Set(savedMedia.map(media => media.filename)), aliases = new Map();
    for (const media of savedMedia) {
      const ext = IMAGE_EXTENSIONS[String(media.blob?.type || media.type || "").split(";")[0].trim().toLowerCase()];
      if (!ext) continue;
      const current = (media.filename.match(/\.[^./]+$/) || [""])[0].toLowerCase();
      if (current === ext || (ext === ".jpg" && current === ".jpeg") || (ext === ".tiff" && current === ".tif")) continue;
      const base = media.filename.replace(/\.(png|jpe?g|gif|webp|avif|svg|heic|bmp|tiff?)$/i, "");
      let name = base + ext;
      for (let n = 2; taken.has(name); n++) name = `${base}-${n}${ext}`;
      taken.add(name);
      aliases.set(media.filename, name);
      media.filename = name;
    }
    rewriteMedia(messages, aliases);
    return aliases.size;
  }
  async function deduplicateImages(savedMedia, messages, check = () => {}) {
    const groups = new Map(), unique = [], aliases = new Map();
    for (const media of savedMedia) {
      check();
      const isImage = /^image\//i.test(media.blob?.type || media.type || "") || /\.(png|jpe?g|webp|gif|avif|heic|svg)$/i.test(media.filename);
      if (!isImage) { unique.push(media); continue; }
      const blob = media.blob || new Blob([Uint8Array.from(atob(media.base64 || ""), c => c.charCodeAt(0))]);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
      check();
      const key = bytes.length + ":" + hash;
      let duplicate;
      for (const candidate of groups.get(key) || []) {
        const previous = new Uint8Array(await candidate.blob.arrayBuffer());
        // Verify bytes as well as the hash. Similar-looking images and different
        // encodings are deliberately kept as separate files.
        if (bytes.every((value, i) => value === previous[i])) { duplicate = candidate; break; }
      }
      if (duplicate) aliases.set(media.filename, duplicate.media.filename);
      else {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ media, blob });
        unique.push(media);
      }
    }
    rewriteMedia(messages, aliases);
    return { savedMedia: unique, duplicates: aliases.size };
  }
  return { zipLocalDate, stampZip, rewriteMedia, matchImageExtensions, deduplicateImages };
})();
