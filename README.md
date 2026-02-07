# Ask Web – AI Content Assistant

Ask Web is a Chrome extension that lets you read any web page through an AI assistant. A draggable floating window appears on top of the page, giving you one-click summaries, custom prompt templates, and a full chat view that inherits the current page context.

---

## Features

- **Floating window overlay** that can be toggled from the toolbar or via hotkeys and now remembers its size and position between sessions.
- **Custom prompt templates** with optional keyboard shortcuts for repeatable actions (summaries, key points, etc.).
- **Dedicated chat tab** with streaming responses, quick actions, and automatic injection of the active page’s content.
- **Themeable UI** (dark/light) shared across the floating window, chat page, and options.
- **OpenAI model control** so you can point the extension at any Chat Completions-capable model accessible via your API key.
- **Local-first storage** using Chrome storage APIs; no data leaves your browser except the prompts you explicitly send to OpenAI.

---

## Screenshots

### Floating Window (Main UI)
<!-- Screenshot: Insert the main floating window UI image here -->

### Settings Page
<!-- Screenshot: Insert the options/settings page image here -->

### Chat Window
<!-- Screenshot: Insert the chat tab image here -->

> Tip: Place your image files under `docs/images/` (or any folder you prefer) and update the Markdown above, e.g. `![Floating Window](docs/images/floating-window.png)`.

---

## Getting Started

1. **Clone or download** this repository.
2. **Open Chrome → Extensions → Manage Extensions.**
3. Enable **Developer mode** and choose **Load unpacked**.
4. Select the `ask_web` folder (this repo’s root). The Ask Web icon should appear in your toolbar.

---

## Configuration

1. Click the Ask Web icon and open **Settings** (or visit `chrome-extension://<id>/options.html` after loading unpacked).
2. Enter your **OpenAI API key**. It is stored locally via `chrome.storage.local`.
3. Pick a **default model** (e.g., `gpt-5.2-pro`) or type a custom one.
4. Build **prompt templates**:
   - Each template has a name, optional model override, multi-line prompt with `{{content}}` placeholder, and optional hotkey (`Ctrl+Shift+S`, etc.).
   - Templates instantly sync to the floating window and chat page.
5. Choose **Dark** or **Light** theme; the choice applies everywhere.

---

## Using the Floating Window

- Click the extension icon (or use any custom shortcut you assign) to toggle the overlay.
- Drag the header or use the handles to move/resize; the geometry is persisted automatically when you close it with Esc or the close button.
- Select a template button to run a summarization action. Output renders inline with Markdown support.
- Use the chat button inside the window to open the full-page chat view carrying over the current page’s text.

---

## Using the Chat Window

- Opens in a new browser tab with the page title, URL, and a content preview pinned at the top.
- Supports streaming responses, quick action buttons, multi-message history, and Markdown rendering.
- Apply any saved template directly into the input box, then edit before sending.
- Clear the conversation to start fresh; context from the source page remains available until you navigate away or close the tab.

---

## Keyboard Shortcuts

- Assign shortcuts per template in **Settings → Templates**.
- Press the shortcut anywhere on a page to immediately trigger that template (the floating window auto-opens if hidden).
- Esc closes the floating window and saves its current size/position.

---

## Development Notes

- Pure vanilla HTML/CSS/JS—no build step required.
- Key files:
  - `manifest.json`: Chrome extension metadata.
  - `content.js`: floating window logic, window state persistence, drag/resize handling, template actions.
  - `background.js`: message routing plus OpenAI API calls (both streaming and non-streaming).
  - `options.html/js`: settings UI, template manager, API key storage.
  - `chat.html/js`: full chat experience with streaming renderer.
- To iterate quickly, enable **chrome://extensions → Ask Web → Update** after changes, or toggle the extension off/on.

---

## Privacy & Safety

- The extension only sends data you explicitly request to OpenAI’s API endpoint using your key.
- API keys remain in your browser storage; remove them from the options page to revoke access.
- No analytics or external storage is used.

---

## Troubleshooting

- **Floating window doesn’t appear:** ensure the content script is injected (reload the page or click the toolbar icon again). Check DevTools console for `[Ask Web]` logs.
- **API errors:** verify your API key, model name, and rate limits in the options page.
- **Window position reset:** the window must close via Esc or the close button to persist; dragging is auto-saved when you stop moving.

---

## License

This project is distributed under the MIT License. See `LICENSE` for details.
