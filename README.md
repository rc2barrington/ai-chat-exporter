# AI Chat Exporter

A utility to export your AI conversations into beautifully formatted Markdown files. 100% private and runs entirely locally in your browser.

## Features

- **Browser Chats** export web-based conversations from ChatGPT, Claude.ai, and Google Gemini using a paste-in console script. Dedupes by element identity, preserves fenced code blocks, and writes a YAML frontmatter header.
- **Claude Desktop App** parses local `.jsonl` transcripts and renders thinking blocks, tool calls, and tool results (each toggleable). Supports bulk-scan of an entire `~/.claude/projects/` folder with selectable per-session export.
- **Google Antigravity** parses `conversation_history.md` files written by the Antigravity IDE under `~/.gemini/antigravity-ide/brain/<session-uuid>/`. Drop the whole `brain/` folder to bulk-scan; pairs each session with its `.metadata.json` sidecar for accurate timestamps.
- **Live preview** of every session, rendered with `marked` + `DOMPurify` so code blocks, lists, tables, and inline formatting display correctly.
- **Bulk export to `.zip`** via JSZip (single-prompt save instead of N separate downloads).
- **Copy as Markdown** alongside the existing Download button.
- **Search and sort** across discovered sessions (by date, title, or message count).
- **Tool field truncation** with a configurable character cap to keep huge tool outputs out of your exports.
- **Single-file HTML build** for fully offline use.

## Setup

```sh
npm install
npm run dev
```

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Vite dev server |
| `npm run build` | GitHub Pages bundle in `dist/` (served from `/ai-chat-exporter/`) |
| `npm run build:standalone` | Single self-contained `dist-standalone/index.html` (no network needed) |
| `npm test` | Run the Vitest suite (parsers + generator) |
| `npm run lint` | ESLint over `src/` and `tests/` |

## Project layout

```
src/
  App.jsx                       tab shell
  parsers/
    browserScript.js            string of the paste-in console export script
    claudeJsonl.js              .jsonl line-by-line parser, normalizes blocks
    antigravity.js              conversation_history.md splitter
  generators/
    markdown.js                 session -> markdown with options
  utils/
    download.js                 sanitizeFilename, downloadBlob, copyToClipboard
    files.js                    recursive folder reading via webkitGetAsEntry
    markdownRender.js           marked + DOMPurify for the live preview
    zip.js                      JSZip bundler with filename de-duplication
  components/
    BrowserChatsTab.jsx
    ClaudeDesktopTab.jsx
    AntigravityTab.jsx
    SessionWorkspace.jsx        shared dropzone + list + preview flow
    SessionList.jsx             search/filter + sort
    SessionPreview.jsx          macOS-window-styled live preview
    Dropzone.jsx                drag-and-drop with dragenter-counter (no flicker)
    PathHints.jsx               copyable platform-specific paths
    Switch.jsx                  toggle row
tests/
  claudeJsonl.test.js
  antigravity.test.js
  markdown.test.js
```

## Format references

### Claude Desktop `.jsonl`

Each line is one JSON object. Recognized shapes:

```jsonc
{ "type": "ai-title", "aiTitle": "string" }
{ "type": "user",      "message": { "content": "string | block[]" }, "timestamp": "ISO" }
{ "type": "assistant", "message": { "content": "block[]" }, "timestamp": "ISO", "requestId": "string" }
```

Block types rendered: `text`, `thinking`, `tool_use`, `tool_result`. Consecutive assistant entries sharing a `requestId` are merged. `tool_result` blocks that arrive inside a "user" turn are attached to the preceding assistant turn rather than emitted as a "You" message.

### Antigravity `conversation_history.md`

```
# Conversation History

## User Message 1
> quoted user text

## Assistant Response 1
free-form markdown
```

Section headers are matched on the literal `## User Message N` / `## Assistant Response N` form. The sidecar `conversation_history.md.metadata.json` (if dropped alongside) supplies `updatedAt`.

## Privacy

All conversation data is processed in your browser. The hosted GitHub Pages copy delivers HTML/JS over the network as any static site does; for a fully offline workflow, build `npm run build:standalone` and open the resulting `dist-standalone/index.html` directly in your browser.

## Deployment

`npm run build` produces `dist/` for GitHub Pages.
