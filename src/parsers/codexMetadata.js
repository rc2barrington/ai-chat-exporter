export function isInternalCodexSession(record = {}) {
  if (record.thread_source === "user") return false;
  if (["subagent", "guardian_review"].includes(record.thread_source)) return true;
  let source = record.source;
  if (typeof source === "string") { try { source = JSON.parse(source); } catch { /* Legacy source is a plain label. */ } }
  return !!(source?.subagent || source === "subagent" || (record.agent_path && record.agent_path !== "/root"));
}

export function codexFallbackTitle(fileName = "", timestamp = "") {
  const match = fileName.match(/rollout-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})/);
  if (match) return `Codex Session ${match[1]} ${match[2]}:${match[3]}`;
  return timestamp ? `Codex Session ${String(timestamp).slice(0, 10)}` : "Codex Session (name unavailable)";
}
