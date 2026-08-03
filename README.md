# AI Chat Exporter

A utility to export your AI conversations into beautifully formatted Markdown files. 100% private and runs entirely locally in your browser.

## Features

- **Chrome Extension** scans open ChatGPT, Claude.ai, Gemini, and Grok tabs, exports each in its own unthrottled window, and downloads them without manual console pasting.
- **Browser Chats** export web-based conversations using a paste-in console script (fallback if you don't use the extension).
- **Claude Code** parses local `.jsonl` transcripts and renders thinking blocks, tool calls, and tool results (each toggleable). Supports bulk-scan of an entire `~/.claude/projects/` folder with selectable per-session export.
- **Replies only, plain text (`.txt`)** exports just the assistant's replies with markdown syntax stripped — no user turns, thinking logs, tool calls, titles, or metadata. Fenced code keeps its contents verbatim. Applies to the download, the copy button, and bulk `.zip` export alike.
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
    claudeJsonl.js              .jsonl parser: prunes edited branches, normalizes blocks
  generators/
    markdown.js                 session -> markdown with options
    plainText.js                session -> assistant replies only, markdown stripped
  utils/
    download.js                 sanitizeFilename, downloadBlob, copyToClipboard
    files.js                    recursive folder reading via webkitGetAsEntry
    dirHandle.js                File System Access API: pick + remember a folder (IndexedDB), recursive collect
    markdownRender.js           marked + DOMPurify for the live preview
    zip.js                      JSZip bundler with filename de-duplication
  components/
    BrowserChatsTab.jsx
    ClaudeCodeTab.jsx
    SessionWorkspace.jsx        shared dropzone + list + preview flow
    SessionList.jsx             search/filter + sort
    SessionPreview.jsx          macOS-window-styled live preview
    Dropzone.jsx                drag-and-drop with dragenter-counter (no flicker)
    PathHints.jsx               copyable platform-specific paths
    Switch.jsx                  toggle row
tests/
  claudeJsonl.test.js
  markdown.test.js
  plainText.test.js
  html.test.js
```

## Format references

### Claude Code `.jsonl`

Each line is one JSON object. Recognized shapes:

```jsonc
{ "type": "ai-title",     "aiTitle": "string" }
{ "type": "custom-title", "customTitle": "string" }
{ "type": "user",      "message": { "content": "string | block[]" }, "timestamp": "ISO", "uuid": "…", "parentUuid": "…" }
{ "type": "assistant", "message": { "content": "block[]" }, "timestamp": "ISO", "requestId": "…", "uuid": "…", "parentUuid": "…" }
```

Block types rendered: `text`, `thinking`, `tool_use`, `tool_result`. Consecutive assistant entries sharing a `requestId` are merged. `tool_result` blocks that arrive inside a "user" turn are attached to the preceding assistant turn rather than emitted as a "You" message.

Three structural details drive the parser:

- **The log is a forest, not a list.** `uuid` / `parentUuid` form a tree; editing or retrying a message forks it and both branches persist. At each fork only the subtree containing the newest activity is kept, so rewritten messages don't appear. A single file also holds several independent root chains (resuming starts a new root), so every root is preserved rather than following one chain back from the newest leaf.
- **Not every line is conversation.** `isMeta` marks injected context (system reminders, hook output) and `isSidechain` marks inlined subagent transcripts; both are skipped. So are the `queue-operation`, `last-prompt`, `mode`, `system`, `attachment`, and `pr-link` bookkeeping lines.
- **Slash commands carry scaffolding.** A `/model` invocation is stored as `<command-name>`, `<command-message>`, `<command-args>`, and `<local-command-stdout>` wrappers inside the user turn. The invocation is reconstructed and the wrappers dropped; turns that were nothing but scaffolding are discarded.

A user-set `custom-title` wins over the generated `ai-title`. Encrypted thinking blocks (a `signature` with no `thinking` text) are skipped.

## Privacy

All conversation data is processed in your browser. The hosted GitHub Pages copy delivers HTML/JS over the network as any static site does; for a fully offline workflow, build `npm run build:standalone` and open the resulting `dist-standalone/index.html` directly in your browser.

## Deployment

`npm run build` produces `dist/` for GitHub Pages.
