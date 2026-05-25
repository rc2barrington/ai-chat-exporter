// Recursive folder reading via the dataTransfer items API.

export async function getAllFilesFromDrop(items) {
  const promises = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (entry) {
      promises.push(scanEntry(entry));
    } else {
      const file = item.getAsFile();
      if (file) promises.push(Promise.resolve([file]));
    }
  }
  const nested = await Promise.all(promises);
  return nested.flat();
}

function scanEntry(entry) {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file(
        (file) => {
          file.relativePath = entry.fullPath || file.name;
          resolve([file]);
        },
        () => resolve([])
      );
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const all = [];
      const readBatch = () => {
        reader.readEntries(
          async (entries) => {
            if (entries.length === 0) {
              resolve(all);
              return;
            }
            const batch = await Promise.all(entries.map(scanEntry));
            all.push(...batch.flat());
            readBatch();
          },
          () => resolve(all)
        );
      };
      readBatch();
    } else {
      resolve([]);
    }
  });
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
