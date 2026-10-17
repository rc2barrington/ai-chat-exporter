# AI Chat Exporter

Save browser conversations and local coding sessions as readable Markdown, with available attachments. No sign-up, analytics, or exporter-hosted conversation storage.

**[Open the website](https://rc2barrington.github.io/ai-chat-exporter/)**

Browser exports: ChatGPT, Claude.ai, Gemini, Grok, Google AI Overviews, Google AI Mode, Muse and Perplexity. Local coding chats: Codex, Claude Code and OpenCode.

## Get started

### Browser chats

1. Download the Chrome extension from the website and unzip it somewhere permanent.
2. Open `chrome://extensions`, enable Developer mode, and use **Load unpacked** to select the extracted extension folder.
3. Open the extension, select chats, choose whether to include attachments, and export.

Supported sources: ChatGPT, Claude.ai, Gemini, Grok, Google AI Overviews and Google Search AI Mode on google.com, Muse, and Perplexity. Exports run in existing tabs without moving or activating them. A tab Chrome has unloaded to save memory is loaded again in place first. Updating an unpacked extension requires replacing its files and clicking Reload in Chrome. New host permissions may require Chrome approval.

Enable **AI replies only** in the extension's Export Settings, or in Export options for local sessions, to exclude your messages and their attachments. The console fallback also offers replies-only plain text output. Refresh an open Muse or Perplexity chat once after updating the extension to enable its background rendering helper.

### Local coding chats

Choose a local source in the sidebar and download the Mac local app. Unzip it, then double-click **Open AI Chat Exporter.command**. Requires [Node.js](https://nodejs.org/en/download) 22.15 or newer. No `npm install` is needed for the packaged app. Keep its launcher window open while exporting. Developers can use the commands below directly from a checkout.

The local app opens directly to Codex and automatically lists saved chats. Choose another source in the sidebar for its saved conversations. Search, select, and export. Everything starts unselected. Manual file import is tucked under Advanced and is only needed for backups or files from another computer.

- Codex: discovers `sessions` and `archived_sessions` under `$CODEX_HOME`, defaulting to `~/.codex`. Uses the state database's sidebar `name`, not the prompt stored in `title`. Falls back to the latest session-index name. Internal reviews and subagents are excluded from the main list, and copies of the same session are not listed twice. A long session is stored as several rollout pages, older ones compressed as `.jsonl.zst`; every page is read in order. Parses the rollout message stream once, excluding mirrored UI events and injected system/developer instructions.
- OpenCode: reads `$XDG_DATA_HOME/opencode/opencode.db`, defaulting to `~/.local/share/opencode/opencode.db`, in read-only transactions. Includes text, saved reasoning, file parts, tool calls and results; excludes reverted tail messages. Each reply is headed with the model that wrote it, such as `## OpenCode (kimi-k3)`, the chat list shows the models used, and front matter lists them.
- Manual file import is optional: Codex `.jsonl` rollouts or OpenCode `.json` exports. Imported files stay in your browser. Rollouts often do not contain sidebar names: use automatic discovery for named chats, or include `session_index.jsonl` in the import. Missing names use a date label, never the opening prompt. To copy local `file:` attachments, use automatic discovery in the local app.
- Claude Code: discovers top-level project `.jsonl` sessions under `$CLAUDE_CONFIG_DIR`, defaulting to `~/.claude/projects`. Uses custom titles, generated titles, or session-index summaries rather than the first prompt. Subagent directories and symlinks are excluded. Preserves saved text, readable reasoning, tool results, and embedded image/document attachments. Manual `.jsonl` import is also available.
- Very large sessions: the local app reads saved logs line by line, so a session bigger than JavaScript's maximum string length (one real Codex session here is 590 MB) still opens. Inline images stay in the local app and are fetched individually during export instead of being sent to the page inside the session. Sessions that ended before any message was sent are not listed.

## Export behavior

- No attachment files saved: a plain `.md` file, no empty media folder.
- Everything is saved under `Downloads/AI Chat Exports/<app>/` (for example `AI Chat Exports/ChatGPT/`), never loose in Downloads.
- Attachments saved: a folder named after the chat, holding a chat-named Markdown file (for example `my-chat.md`) and `media/`. No ZIP files. The extension names the folder with the local date (`my-chat-2026-10-17`); if a folder of that name already holds an export of the chat, it uses `my-chat-2026-10-17 (2)` rather than mixing files.
- Browser exports record the chat's address as `source_url` in the front matter, so a chat can be found and exported again. Only files the Markdown links to are saved, so images inside hidden tool output are left out.
- Local app: each chat is saved straight into `Downloads/AI Chat Exports/<app>/` by the local app itself, as a Markdown file or a chat folder, never overwriting an existing one. Multiple chats are saved side by side. The website's manual import asks once for a folder to save into (Chrome's folder access); browsers without it get a ZIP.
- Exact duplicate images: one saved copy per conversation. SHA-256 groups candidates, then their bytes are compared. Different encodings and similar-looking images remain separate. Every occurrence still links to the retained image.
- Batch export requires two separate confirmations of the selected chat names. The extension worker validates the confirmed selection snapshot too.
- Message text and tool output are not truncated by the current interface. The parser cannot undo truncation already present in a provider's saved records.
- Cancel stops active requests and prevents further downloads. It does not delete files already downloaded.
- Unavailable attachments are identified in the conversation and status display. No separate error-log file is generated.
- Saved files carry the time of the export. Folder names use the local date. The ZIP fallback stamps every entry with the current local time (two-second precision).

## Completeness and limits

ChatGPT text is reconstructed from the authoritative active root-to-current chain, including paginated history. If that chain cannot be established, no partial ChatGPT export is presented as complete. Markdown uses `history_status: complete` for a verified chain. An optional rendered-media recovery sweep no longer produces a misleading `root history reached: false` field in the document.

Other browser providers use the messages available through their pages. Their output is a page capture, not an independently verified server history. Muse and Perplexity each use a document-start helper to keep the selected thread's virtual message rows rendered during export, including when Chrome suspends native intersection callbacks in background tabs. Muse's helper also keeps its history pages loading and reports when the real start and end of the chat are reached, so a slow page is not mistaken for the end. Muse scrolls its thread to load that history. Normal virtualization resumes after completion or cancellation. Refresh the chat once after installing or updating the extension so the helper can register before the page creates its observers. Both providers refuse an export when message positions cannot all be rendered. Both export conversation text and uploaded or displayed images, but not other file types. Perplexity omits its bulk Web sources. Its file pane is consulted for current image URLs, and signed and unsigned links to the same uploaded image are treated as one item. Muse's clickable image bubbles, including `blob:` images, are captured, as are its idea and shopping cards, image choices, file chips and offered reply options. Images Muse loads lazily are loaded during the export. A Muse tab still showing "Loading chat" is refreshed through Muse itself. Muse exports are named after the chat's page title when the tab has one. Perplexity's question timestamps are left out. Interactive non-image artifacts keep a text label, not a misleading download failure. Website changes, authentication and expired image links can still affect results. Gemini images are labeled neutrally, not assumed to be generated merely because Gemini displayed them.

The extension transports data in acknowledged 256 Ki-character chunks instead of one giant Chrome message. There is no configured total attachment count, total transfer size, or whole-export deadline. Individual network requests still time out when stalled. Browser memory, ZIP format constraints, disk space and provider access remain real limits.

Deleted or expired files cannot be reconstructed from a filename. Local exports copy bytes only from embedded attachments or structured file references that remain accessible. Paths mentioned in ordinary chat text or tool commands are not treated as permission to read arbitrary files.

## Privacy

The local server binds only to `127.0.0.1`. Its API requires the local exporter's custom header, rejects foreign origins and hosts, and accepts session identifiers rather than arbitrary filesystem paths. Local attachment reads are limited to structured attachment records in an opened session. It does not scan authentication files or send conversations to the exporter website.

Browser attachment downloads contact the original providers or media hosts. The optional console-script fallback is subject to the page's cross-origin restrictions; the extension is preferred.

## Development

Use Node.js 22.15 or newer (Node 24 is used in CI):

```sh
npm ci
npm run build
npm run local
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite development server |
| `npm run local` | Serve the built local app and discover sessions |
| `npm test` | Parser, transport, media, selection, archive and access-control tests |
| `npm run lint` | Lint source and tests |
| `npm run build` | Build the website in `dist/` |
| `npm run package:downloads` | Build extension and local-app ZIPs after building the site |
| `npm run build:standalone` | Single-file offline import UI in `dist-standalone/` |
| `npm run deploy` | Build, package and publish GitHub Pages (checks the Git remote first) |

CI runs tests, lint, production build and downloadable packaging. Tests include a payload larger than Chrome's 64 MiB message ceiling, byte-exact image deduplication, untruncated tool results, local file attachments, cancellation and ZIP directory timestamps. Browser-provider compatibility still requires live checks when those sites change.

Please report issues with the exporter version, provider and redacted log. Do not publish conversation contents, session tokens or private attachment links.

## 1.2.7

Exports no longer scatter across Downloads: the extension and the local app save into `Downloads/AI Chat Exports/<app>/`. Browser exports record the chat's address as `source_url`. Saved attachments are named after the file instead of the temporary path they were uploaded from.

## 1.2.6

No more ZIP files. A chat with attachments is saved as a folder in Downloads, its Markdown plus `media/`, ready to open in Finder. The extension writes each file into the folder itself, and the local app's own server saves into Downloads, so exports from both appear as folders. The extension no longer ships JSZip. The website's manual import uses Chrome's folder access and falls back to a ZIP only in browsers without it.

## 1.2.5

The local app now reads Codex sessions completely. Codex stores a long session as several rollout pages and compresses older ones as `.jsonl.zst`. The app read only uncompressed files and only the first copy it found, so it listed 9 of 97 Codex chats on the test machine and exported only the newest page of long ones (one chat had 2 of its 50 prompts). It now lists every session and reads all of its pages in order, once each. Node.js 22.15 or newer is required for the built-in zstd support.

## 1.2.4

Muse cards drawn as sections, such as reminder cards in side threads, now export instead of failing the chat. If Muse adds a message widget the exporter does not know, the message falls back to the text Muse shows rather than failing the whole export. A message with no text at all still stops the export. Verified by exporting all five Muse side threads and the main chat from background tabs.

## 1.2.3

Tested end to end in Chrome with real Muse, ChatGPT, Claude.ai, Perplexity and Google AI Overview chats exported together from background tabs.

- Muse: messages made of cards, image choices, file chips or reply options no longer export as blank and fail ("Muse message ... did not render"). Lazily loaded images now load during a background export, a tab stuck on "Loading chat" is refreshed through Muse's own router, exports use the page title for their name, and Muse's bundled app icons are no longer saved as images.
- Perplexity: the time each question was asked, shown in a hover toolbar, no longer opens every question and no longer becomes the file name.
- A tab Chrome unloaded to save memory is loaded again in place instead of failing with "Extension manifest must request permission".
- OpenCode: replies name their model, including switches partway through a chat, the chat list shows the models used, and front matter lists them.
- Local exports save only attachments the Markdown links to. Images inside hidden tool output used to be saved as unlinked files.

## 1.2.2

Muse chats now export from a background tab. Muse shows a message's text only after Chrome reports it on screen, and loads older history the same way, but Chrome stops those reports in tabs you are not looking at, so exports failed with "Muse did not fully render N message(s)". A new helper, like Perplexity's, renders every message during the export and keeps history loading. It also tells the exporter when the real start and end of the chat are reached. Before, a 1 second pause between history pages could end the scan early. A tab opened before the update asks to be refreshed once instead of exporting placeholders.

## 1.2.1

Muse chats longer than about 110 messages now export. Muse keeps only part of a long chat loaded at a time, so the newest messages appear only while scrolling down, and the exporter treated them as the chat changing mid-export. It now joins each loaded section onto the message list as it scrolls, and still refuses to save if it detects a gap.

## 1.2.0

One app and one repository. The separate private edition is retired: OpenCode, Claude Code and Codex are all available in the local app at port 4179, and the edition machinery (edition settings, release snapshot script, separate port and publishing guard) is removed. The Muse and Perplexity adapter file is renamed `extraBrowserAdapters.js`, since nothing about it was private.

## 1.1.0

The private edition now includes Claude Code alongside Codex and OpenCode. Both editions are defined in one `EDITIONS` table, and `npm run release:public` replaces the manual snapshot copy. Very large local sessions open instead of failing with "Invalid string length", inline images are served by the local app, and empty Codex sessions are no longer listed. The extension popup reads its version from the manifest instead of showing a fixed number.

## 1.0.4

Muse exports now capture uploaded and output images wrapped in clickable bubbles, including `blob:` images. Non-image files are left as text labels and do not create failed-download entries. The private app explains the text-and-images scope for Muse and Perplexity.

## 1.0.3

Perplexity exports now focus on conversation text and uploaded or displayed images. They omit automatic source citations, the Web source appendix and non-image attachments. Fresh signed image links from the file pane replace stale variants of the same underlying file, avoiding duplicate downloads and misleading failures.

## 1.0.2

Perplexity background exports now preserve the initially mounted tail and visit unloaded message rows individually when a normal scroll sweep fails to mount them. Progress logs report capture counts without exposing conversation text.

## 1.0.1

Private-only Muse and Perplexity browser adapters. They scan virtualized conversations, collect directly linked media and uploads, and include Perplexity source references. The public snapshot removes those adapters and host permissions.

## 1.0.0

Separate public and private editions, server-enforced provider selection, independent local ports, private publishing guard, restored Claude Code import and discovery, and release privacy checks. Removed the unused legacy interface components. Existing attachment naming, batch confirmations, exact-image deduplication, and full-text behavior are preserved.

## 0.2.0

Rebuilt source-first interface, downloadable local app, automatic session discovery, two-stage batch confirmation, chunked extension transport, exact-image deduplication, local attachment bundles, clearer history status and corrected file/folder timestamps.

## 0.2.1

Fixed Codex sidebar names and internal-session filtering. Simplified Codex/OpenCode setup and hid manual import under Advanced. Local launch opens chat selection directly and refuses to silently reuse an outdated local server. The browser extension remains at 0.2.0; this release changes the website and local app.

## 0.2.2

Markdown files inside ZIPs now use the conversation name, matching standalone Markdown downloads. Applies to the browser extension, console fallback, and Codex/OpenCode single and batch exports. Relative media links are unchanged.
