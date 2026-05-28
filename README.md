# AI Chat Exporter

A utility to export your AI conversations into beautifully formatted Markdown files. 100% private and runs entirely locally in your browser.

## Features

- **Chrome Extension** scans open ChatGPT, Claude.ai, and Gemini tabs, activates them sequentially to bypass background throttling, and automatically exports them without manual console pasting.
- **Browser Chats** export web-based conversations using a paste-in console script (fallback if you don't use the extension).
- **Claude Desktop App** parses local `.jsonl` transcripts and renders thinking blocks, tool calls, and tool results (each toggleable). Supports bulk-scan of an entire `~/.claude/projects/` folder with selectable per-session export.
- **Google Antigravity** parses both transcript formats the IDE writes under `~/.gemini/antigravity/brain/<session-uuid>/`: newer builds' `.system_generated/logs/transcript.jsonl` (with thinking, tool calls, and tool results, each toggleable) and older builds' `conversation_history.md`. A one-click **Open my Antigravity chats** button (File System Access API) lets you grant the `brain/` folder once; the browser remembers the directory handle so future clicks reopen it straight away with no re-navigating (falls back to drag-and-drop where the API is unavailable). Bulk-scans every session and pairs each markdown transcript with its `.metadata.json` sidecar for accurate timestamps.
- **Live preview** of every session, rendered with `marked` + `DOMPurify` so code blocks, lists, tables, and inline formatting display correctly.
- **Bulk export to `.zip`** via JSZip (single-prompt save instead of N separate downloads).
- **Copy as Markdown** alongside the existing Download button.
- **Search and sort** across discovered sessions (by date, title, or message count).
- **Tool field truncation** with a configurable character cap to keep huge tool outputs out of your exports.
- **Single-file HTML build** for fully offline use.

## Setup

### Web App Setup
```sh
npm install
npm run dev
```

### Chrome Extension Setup
1. Open Google Chrome and go to `chrome://extensions/`.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** (top-left button).
4. Select the `chrome-extension` directory inside this repository.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Vite dev server |
| `npm run build` | GitHub Pages bundle in `dist/` (served from `/ai-chat-exporter/`) |
| `npm run build:standalone` | Single self-contained `dist-standalone/index.html` (no network needed) |
| `npm test` | Run the Vitest suite (parsers + generator) |
| `npm run lint` | ESLint over `src/` and `tests/` |
| `npm run deploy` | Build and publish `dist/` to the `gh-pages` branch (commit author is pinned, regardless of local git config) |

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
    dirHandle.js                File System Access API: pick + remember a folder (IndexedDB), recursive collect
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

### Antigravity `transcript.jsonl` (newer builds)

Stored at `~/.gemini/antigravity/brain/<uuid>/.system_generated/logs/transcript.jsonl`. One JSON object per line:

```jsonc
{ "step_index": 0, "source": "USER_EXPLICIT", "type": "USER_INPUT", "created_at": "ISO", "content": "string" }
{ "step_index": 2, "source": "MODEL", "type": "PLANNER_RESPONSE", "thinking": "string", "content": "string", "tool_calls": [{ "name": "view_file", "args": {} }] }
{ "step_index": 3, "source": "MODEL", "type": "RUN_COMMAND", "status": "DONE", "content": "tool output" }
```

`USER_EXPLICIT` lines become "You" turns. Consecutive `MODEL` lines merge into one assistant turn: `thinking` → thinking block, `tool_calls` → tool_use blocks, and `content` → a text block (or a tool_result block for tool-output step types like `RUN_COMMAND` / `VIEW_FILE` / `GREP_SEARCH`). `SYSTEM` lines (ephemeral status, checkpoints, history dumps) are skipped. `startedAt` / `endedAt` come from the min/max `created_at`.

### Antigravity `conversation_history.md` (older builds)

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
