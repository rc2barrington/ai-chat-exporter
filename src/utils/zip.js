import JSZip from "jszip";
import { sanitizeFilename } from "./download.js";

// Bundles {filename, content} entries into a single .zip Blob.
// Disambiguates collisions by suffixing -2, -3, etc.
export async function bundleZip(files) {
  const zip = new JSZip();
  const used = new Set();
  for (const f of files) {
    let name = f.filename || sanitizeFilename(f.title || "session") + ".md";
    if (used.has(name)) {
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      let n = 2;
      while (used.has(`${stem}-${n}${ext}`)) n++;
      name = `${stem}-${n}${ext}`;
    }
    used.add(name);
    zip.file(name, f.content);
  }
  return zip.generateAsync({ type: "blob" });
}
