# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ask Web is a Chrome extension (Manifest V3) that injects a floating window into web pages for AI-powered summarization and chat via the OpenAI Chat Completions API. Pure vanilla HTML/CSS/JS — **no build step, no bundler, no package manager**.

## Development Workflow

- **Load extension**: Chrome → Extensions → Developer mode → Load unpacked → select this repo's root
- **Iterate**: Reload at `chrome://extensions` (click refresh icon), then reload the target page. No compilation needed.
- **No tests or linter configured** — manual testing via the extension only.

## Architecture

```
background.js    ← Service worker: OpenAI API calls, message routing, streaming handlers
content.js       ← Injected into every page: floating window UI (Shadow DOM), drag/resize, shortcuts, page content extraction
utils.js         ← Shared helpers: storage keys, theme, templates, status image resolution, table-to-markdown
options.html/js  ← Settings page: API key, model, template management, shortcut recording
chat.html/js     ← Full-tab chat with streaming responses
popup.html/js    ← Toolbar popup (minimal; most UI lives in the floating window)
mindmap.html/js  ← Mindmap visualization using vendored Markmap/D3
```

### Message Flow

- **Content script → Background**: `chrome.runtime.sendMessage({ action: ... })`
- **Background → Content script**: `chrome.tabs.sendMessage(tabId, { action: ... })`
- **Page data for chat tab**: stored temporarily in `chrome.storage.session` under `currentPageData`

### Streaming

Two separate SSE streaming paths (`data: ...` lines, `[DONE]` sentinel):

| Action | Sender | Background handler | Chunk messages |
|---|---|---|---|
| `startStream` | chat tab | `handleStreamRequest` | `streamChunk` / `streamEnd` / `streamError` |
| `startPopupStream` | content script | `handlePopupStreamRequest` | `popupStreamChunk` / `popupStreamEnd` / `popupStreamError` |

### Floating Window

- Built inside a **Shadow DOM** for style isolation from the host page.
- Window geometry (position, size) persisted to `chrome.storage.local`: normal → `windowState`, selection-triggered → `selectionWindowState`.
- State saved on close (Esc or close button); dragging auto-saves on pointer-up.

## Key Conventions

### Storage Keys

All keys defined in `StorageKeys` in `utils.js`. `background.js` duplicates a few constants since it's a service worker and cannot import `utils.js`.

### Model Detection (`prepareRequestBody` in background.js)

Models whose name starts with `o1-`, `o3-`, `reasoning`, or contains `5` are treated as reasoning models: `max_tokens` → `max_completion_tokens` and `temperature` is removed.

### Template Placeholders

- `{{content}}` — replaced with extracted page text
- `{{selection}}` — replaced with user's text selection

### Content Script Guard Pattern

`utils.js` and `content.js` use `var Foo = Foo || {...}` to safely handle re-injection without overwriting state.

### Theme

Dark is default. Light mode via `data-theme="light"` on `document.documentElement`. Applied through `applyTheme()` in `utils.js`.

### Vendored Libraries (`vendor/`)

D3, Markmap (lib, view, toolbar), and `marked.min.js` (root). These are injected as content scripts per `manifest.json`. `vendor/mermaid.min.js` (UMD build, exposes `globalThis.mermaid`) is loaded only by `chat.html` to render ` ```mermaid ` code blocks in chat replies into SVG.

## Git Conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>[optional scope]: <description>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`.
