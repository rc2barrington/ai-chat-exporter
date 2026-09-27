// Browser providers are shared by both editions. Local source access remains
// controlled by src/edition.js and the server's edition checks.
export function publicFile(name, bytes) {
  void name;
  return bytes;
}
