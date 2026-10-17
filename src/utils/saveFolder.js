// Writes an export into a folder the person chose (File System Access API):
// a Markdown file, or a folder holding the Markdown and media/. Existing
// files are never overwritten; a free name is chosen instead.
async function exists(directory, name, kind) {
  try {
    if (kind === "directory") await directory.getDirectoryHandle(name);
    else await directory.getFileHandle(name);
    return true;
  } catch (error) {
    if (error.name === "NotFoundError" || error.name === "TypeMismatchError") return error.name === "TypeMismatchError";
    throw error;
  }
}

async function freeName(directory, name, kind) {
  const dot = kind === "file" ? name.lastIndexOf(".") : -1;
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? name : dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
    if (!(await exists(directory, candidate, kind))) return candidate;
  }
  throw new Error("No free name in the chosen folder.");
}

async function writeFile(directory, name, content) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try { await writable.write(content); }
  finally { await writable.close(); }
}

export async function saveToDirectory(directory, title, files) {
  if (files.length === 1) {
    const name = await freeName(directory, `${title}.md`, "file");
    await writeFile(directory, name, files[0].content);
    return name;
  }
  const folderName = await freeName(directory, title, "directory");
  const folder = await directory.getDirectoryHandle(folderName, { create: true });
  for (const file of files) {
    const parts = file.filename.split("/");
    let parent = folder;
    for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create: true });
    await writeFile(parent, parts.at(-1), file.content);
  }
  return `${folderName}/`;
}
