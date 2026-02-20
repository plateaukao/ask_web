# Ask Web – Copilot Instructions

## Overview

Chrome Extension (Manifest V3) that injects a floating window into web pages for AI-powered summarization and chat via the OpenAI Chat Completions API. Pure vanilla HTML/CSS/JS — **no build step, no bundler, no package manager**. Load directly as an unpacked extension in Chrome.

## Architecture

```
background.js          ← Service worker: all OpenAI API calls, message routing
content.js             ← Injected into every page: floating window UI, drag/resize, shortcuts
utils.js               ← Shared helpers (storage, theme, templates) — loaded by content scripts
options.html/js        ← Settings page: API key, model, templates, selection icon config
chat.html/js           ← Full-tab chat experience with streaming
popup.html/js          ← Toolbar popup (minimal; most UI is in the floating window)
marked.min.js          ← Vendored Markdown renderer
```

### Message Flow

- **Content script → Background**: `chrome.runtime.sendMessage({ action: ... })`
- **Background → Content script**: `chrome.tabs.sendMessage(tabId, { action: ... })`
- **Page data for chat tab**: stored temporarily in `chrome.storage.session` under `currentPageData`

### Streaming

Two separate streaming paths both use SSE (`data: ...` lines, `[DONE]` sentinel):

| Action | Sender | Background handler | Background → Sender |
|---|---|---|---|
| `startStream` | chat tab | `handleStreamRequest` | `streamChunk` / `streamEnd` / `streamError` |
| `startPopupStream` | content script | `handlePopupStreamRequest` | `popupStreamChunk` / `popupStreamEnd` / `popupStreamError` |

## Key Conventions

### Storage Keys
All keys are defined in `StorageKeys` in `utils.js`. `background.js` duplicates a few constants (it's a service worker and cannot import `utils.js`).

### Model Detection (`prepareRequestBody` in background.js)
Models whose name starts with `o1-`, `o3-`, `reasoning`, or contains `5` are treated as reasoning models: `max_tokens` is renamed to `max_completion_tokens` and `temperature` is removed.

### Template Placeholders
- `{{content}}` — replaced with extracted page text
- `{{selection}}` — replaced with the user's text selection (selection-icon feature)

### Floating Window
- Built inside a **Shadow DOM** (`shadowRoot`) for style isolation from the host page.
- Window geometry (position, size) is persisted to `chrome.storage.local`:
  - Normal window → `windowState`
  - Selection-triggered window → `selectionWindowState`
- State is only saved on close (Esc or close button); dragging auto-saves on pointer-up.

### Theme
Dark is the default. Light mode is activated by setting `data-theme="light"` on `document.documentElement`. Applied via `applyTheme()` in `utils.js`.

### Content Script Guard Pattern
`utils.js` and `content.js` use `var Foo = Foo || {...}` to safely handle re-injection:
```js
var StorageKeys = StorageKeys || { ... };
```

### Iterating on Changes
Reload the extension at `chrome://extensions` (click the refresh icon for Ask Web), then reload the target page. No compilation needed.

## Git Commit Guidelines

Follow [Conventional Commits](https://www.conventionalcommits.org/) for all commit messages:

```
<type>[optional scope]: <description>
```

Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`.

Examples:
- `feat: add dark mode toggle to options page`
- `fix(background): handle missing API key gracefully`
- `chore: update marked.min.js to latest version`
