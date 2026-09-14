import { useEffect, useRef, useState } from "react";
import { parseCodexJsonl } from "../parsers/codexJsonl.js";
import { parseOpenCode } from "../parsers/opencode.js";
import { parseClaudeCodeJsonl } from "../parsers/claudeJsonl.js";
import { LOCAL_PORT, SOURCE_NAMES } from "../edition.js";
import { generateMarkdown } from "../generators/markdown.js";
import { downloadBlob, sanitizeFilename } from "../utils/download.js";
import { bundleZip } from "../utils/zip.js";
import { renderMarkdown as markdownToHtml } from "../utils/markdownRender.js";
import { getAllFilesFromDrop } from "../utils/files.js";
import { BatchReview } from "./BatchReview.jsx";
import { sessionFiles } from "../utils/sessionExport.js";

export function ExportWorkspace({ source }) {
  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState(() => {
    const params = new URLSearchParams(location.search);
    return params.get("source") === source ? params.get("search") || "" : "";
  });
  const [manualImport, setManualImport] = useState(false);
  const [busy, setBusy] = useState(location.hostname === "127.0.0.1" ? "Finding chats…" : "");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(null);
  const [review, setReview] = useState(null);
  const [options, setOptions] = useState({ includeThinking: true, includeTools: true, includeResults: true, frontmatter: false, truncateChars: 0 });
  const picker = useRef(null);
  const folder = useRef(null);
  const controller = useRef(null);
  const local = location.hostname === "127.0.0.1";
  const name = SOURCE_NAMES[source];
  const extension = source === "opencode" ? ".json" : ".jsonl";
  async function request(id, signal) {
    const response = await fetch(`/api/local-sessions?${new URLSearchParams({ source, ...(id ? { id } : {}) })}`, { headers: { "X-AI-Exporter": "local-sessions" }, signal });
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Open the downloaded local app to find chats on this computer.");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not read local chats.");
    return data;
  }
  useEffect(() => {
    if (!local) return;
    const abort = new AbortController();
    controller.current = abort;
    request(null, abort.signal).then(setSessions).catch(e => { if (e.name !== "AbortError") setError(e.message); }).finally(() => setBusy(""));
    return () => abort.abort();
    // App remounts this workspace when the source changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, local]);
  useEffect(() => () => controller.current?.abort(), []);
  async function work(label, action) {
    if (busy) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(label); setError(""); setNotice("");
    try { await action(abort.signal); }
    catch (e) { if (e.name === "AbortError") setNotice("Cancelled. No further files will be downloaded."); else setError(e.message); }
    finally { setBusy(""); }
  }
  async function importFiles(files) {
    await work("Reading files…", async signal => {
      const parsed = [], failures = [];
      const names = new Map(sessions.filter(s => !s.parsed || s.parsed.titleKnown).map(s => [s.id, s.title]));
      if (source === "codex") for (const file of files) {
        if (file.name !== "session_index.jsonl") continue;
        for (const line of (await file.text()).split("\n")) {
          try { const item = JSON.parse(line); if (item.id && item.thread_name) names.set(item.id, item.thread_name); } catch { /* An index can end in a partial write. */ }
        }
      }
      const byID = new Map();
      for (const file of files) {
        signal.throwIfAborted();
        if (file.name === "session_index.jsonl") continue;
        if (!file.name.toLowerCase().endsWith(extension)) continue;
        try {
          const text = await file.text();
          const session = source === "codex" ? parseCodexJsonl(text, { fileName: file.name }) : source === "claude-code" ? parseClaudeCodeJsonl(text) : parseOpenCode(text);
          if (session.internal) continue;
          if (!session.messages.length) throw new Error("No messages found");
          if (source === "codex" && names.has(session.id)) { session.title = names.get(session.id); session.titleKnown = true; }
          const id = session.id || file.name;
          if (byID.has(id) && byID.get(id).parsed.messages.length >= session.messages.length) continue;
          byID.set(id, { id, title: session.title, updatedAt: session.endedAt || session.startedAt, parsed: session });
        } catch (e) { failures.push(`${file.name}: ${e.message}`); }
      }
      signal.throwIfAborted();
      parsed.push(...byID.values());
      setSessions(parsed); setSelected(new Set()); setPreview(null);
      if (source === "codex" && parsed.some(s => !s.parsed.titleKnown)) setNotice("These rollout files do not contain their sidebar names. Use the local app to see your named chats, or include session_index.jsonl with the imported files. Prompts are not used as chat names.");
      if (failures.length) setError(failures.join("\n"));
      if (!parsed.length && !failures.length) throw new Error(`Choose ${name} ${extension} files.`);
    });
  }
  const visible = sessions.filter(s => s.title.toLowerCase().includes(search.trim().toLowerCase()));
  const picks = sessions.filter(s => selected.has(s.id));
  async function exportSessions(snapshot) {
    setReview(null);
    await work(`Exporting ${snapshot.length} chat${snapshot.length === 1 ? "" : "s"}…`, async signal => {
      const files = [];
      const failures = [];
      let duplicates = 0;
      for (const [position, item] of snapshot.entries()) {
        const session = item.parsed || await request(item.id, signal);
        signal.throwIfAborted();
        const result = await sessionFiles(session, options, async (attachment, index, signal) => {
          let url = attachment.url;
          const headers = {};
          if (url.startsWith("file:")) {
            if (!local || item.parsed) throw new Error("Use automatic discovery in the local app to read this file");
            url = `/api/local-sessions?${new URLSearchParams({ source, id: item.id, attachment: index })}`;
            headers["X-AI-Exporter"] = "local-sessions";
          } else if (!/^(data:|https?:)/.test(url)) throw new Error("Unsupported attachment location");
          const response = await fetch(url, { headers, signal, credentials: "omit" });
          if (!response.ok) throw new Error(`File could not be read (HTTP ${response.status})`);
          return response.blob();
        }, signal);
        failures.push(...result.failures); duplicates += result.duplicates;
        const title = sanitizeFilename(session.title, "conversation");
        for (const file of result.files) files.push({ ...file, filename: snapshot.length > 1 ? `${position + 1}-${title}/${file.filename}` : result.files.length === 1 ? title + ".md" : file.filename });
      }
      signal.throwIfAborted();
      if (files.length === 1) downloadBlob(files[0].filename, files[0].content);
      else {
        const zip = await bundleZip(files); signal.throwIfAborted();
        downloadBlob("ai-chat-export.zip", zip, "application/zip");
      }
      setNotice(`${snapshot.length} chat${snapshot.length === 1 ? "" : "s"} exported. ${duplicates} exact duplicate image${duplicates === 1 ? "" : "s"} reused.${failures.length ? ` ${failures.length} attachments could not be saved: ${failures.join("; ")}` : ""}`);
    });
  }
  return <>
    {!local && <section className="panel local-intro">
      <div className="section-icon">↙</div>
      <div><h2>Open your saved {name} chats</h2><p>No choosing folders or exporting from {name} first. The local app lists your conversations by name.</p>
        <ol className="local-start-steps"><li><a href={`${import.meta.env.BASE_URL}downloads/ai-chat-exporter-local.zip`} download>Download the Mac app</a> and unzip it.</li><li>Double-click <strong>Open AI Chat Exporter.command</strong> in that folder.</li><li>Choose <strong>{name}</strong>, search for your chat, then export.</li></ol>
        <div className="actions"><a className="button" href={`http://127.0.0.1:${LOCAL_PORT}/ai-chat-exporter/?source=${source}`}>Open my {name} chats</a></div>
        <p className="fine-print">Keep the launcher open while exporting. If the button cannot connect, open the launcher first. Requires <a href="https://nodejs.org/en/download">Node.js 22.13 or newer</a>.</p>
      </div>
    </section>}
    {(local || manualImport) && <><section className="panel">
      <div className="section-header"><div><span className="eyebrow">2 · Select chats</span><h2>{local ? `Your ${name} chats` : "Or import saved files"}</h2></div>
        <div className="actions compact">{local && <button className="button secondary" disabled={!!busy} onClick={() => work("Finding chats…", async signal => { setSessions(await request(null, signal)); setSelected(new Set()); })}>Refresh chats</button>}{manualImport && <button className="button secondary" disabled={!!busy} onClick={() => picker.current.click()}>Choose export files</button>}</div>
      </div>
      <input ref={picker} type="file" multiple accept={extension} hidden onChange={e => { importFiles([...e.target.files]); e.target.value = ""; }} />
      <input ref={folder} type="file" webkitdirectory="true" hidden onChange={e => { importFiles([...e.target.files]); e.target.value = ""; }} />
      {!sessions.length && local && !manualImport ? <p>{busy ? "Finding your saved conversations…" : `No saved ${name} chats found. Open ${name} on this computer, then refresh.`}</p> : !sessions.length ? <div className="import-zone" onDragOver={e => e.preventDefault()} onDrop={async e => { e.preventDefault(); if (!busy) importFiles(await getAllFilesFromDrop(e.dataTransfer.items)); }}>
        <span className="upload-mark">↑</span><h3>{local ? "No chats loaded yet" : "Drop your chat files here"}</h3>
        <p>{name} {extension} conversation files</p>
        <button className="text-link" disabled={!!busy} onClick={() => folder.current.click()}>Choose a folder instead</button>
        <details className="import-help"><summary>Where are these files?</summary><p>{source === "codex" ? "Codex saves rollouts in ~/.codex/sessions. In the Mac file picker, press Cmd+Shift+G and paste that path." : source === "claude-code" ? "Claude Code saves .jsonl sessions under ~/.claude/projects. The local app finds these automatically, including saved names." : "In OpenCode, use its export command: opencode export SESSION_ID > conversation.json. The local app above reads saved sessions directly, without this step."}</p></details>
      </div> : <>
        <div className="list-toolbar"><input aria-label="Search chats" type="search" placeholder="Search your chats…" value={search} onChange={e => setSearch(e.target.value)} /><span>{selected.size} selected · {sessions.length} total</span></div>
        <label className="select-visible"><input type="checkbox" disabled={!!busy} checked={visible.length > 0 && visible.every(s => selected.has(s.id))} onChange={e => setSelected(old => { const next = new Set(old); for (const s of visible) if (e.target.checked) next.add(s.id); else next.delete(s.id); return next; })} />Select visible chats</label>
        <div className="chat-list">{visible.map(s => <div className={`chat-row ${selected.has(s.id) ? "selected" : ""}`} key={s.id}>
          <input type="checkbox" aria-label={`Select ${s.title}`} checked={selected.has(s.id)} disabled={!!busy} onChange={() => setSelected(old => { const next = new Set(old); if (next.has(s.id)) next.delete(s.id); else next.add(s.id); return next; })} />
          <div className="chat-description"><strong>{s.title}</strong><span>{s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : "Imported conversation"}{s.parsed ? ` · ${s.parsed.messages.length} messages` : ""}</span></div>
          <button className="text-link" disabled={!!busy} onClick={() => work("Opening preview…", async signal => setPreview(s.parsed || await request(s.id, signal)))}>Preview</button>
        </div>)}{!visible.length && <p className="empty-search">No chats match that search.</p>}</div>
      </>}
    </section>
    <details className="panel advanced"><summary>Export options <span>Full text included by default</span></summary><div className="option-grid">
      {[['includeThinking', 'Include saved reasoning'], ['includeTools', 'Include tool calls'], ['includeResults', 'Include tool results'], ['frontmatter', 'Add a metadata header']].map(([key, label]) => <label key={key}><input type="checkbox" checked={options[key]} disabled={!!busy} onChange={e => setOptions({ ...options, [key]: e.target.checked })} />{label}</label>)}
    </div><p className="fine-print">Message text and tool output are never shortened by the exporter.</p></details>
    {(error || notice || busy) && <div className={`status-message ${error ? "error" : ""}`} role="status">{error || busy || notice}{busy && <button className="text-link" onClick={() => controller.current?.abort()}>Cancel</button>}</div>}
    <div className="export-bar"><div><span className="eyebrow">3 · Export</span><strong>{picks.length ? `${picks.length} chat${picks.length === 1 ? "" : "s"} selected` : "Choose chats to export"}</strong><small>Markdown opens in any text editor and can be uploaded to an AI.</small></div><button className="button" disabled={!picks.length || !!busy} onClick={() => picks.length > 1 ? setReview([...picks]) : exportSessions([...picks])}>{picks.length > 1 ? "Review batch export →" : "Export Markdown ↓"}</button></div>
    </>}
    <div className="manual-import"><button className="text-link" disabled={!!busy} aria-expanded={manualImport} onClick={() => setManualImport(!manualImport)}>{manualImport ? "Hide manual file import" : "Advanced: import files manually"}</button>{manualImport && <p className="fine-print">For backups and files from another computer. This is not the normal way to find your saved chats.{local && <button className="text-link" onClick={() => picker.current.click()}> Choose export files</button>}</p>}</div>
    {preview && <section className="panel"><div className="section-header"><h2>{preview.title}</h2><button className="text-link" onClick={() => setPreview(null)}>Close preview</button></div><div className="markdown-body preview-content" dangerouslySetInnerHTML={{ __html: markdownToHtml(generateMarkdown(preview, options)) }} /></section>}
    {review && <BatchReview sessions={review} onClose={() => setReview(null)} onConfirm={() => exportSessions(review)} />}
  </>;
}
