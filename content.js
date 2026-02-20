// Content script for Ask Web
var floatingWindow = floatingWindow || null;
var shadowRoot = shadowRoot || null;
var isVisible = typeof isVisible !== 'undefined' ? isVisible : false;
var isSelectionWindow = typeof isSelectionWindow !== 'undefined' ? isSelectionWindow : false;

// Initialize
function init() {
  // Prevent adding listeners multiple times
  if (window.hasAskWebListeners) return;
  window.hasAskWebListeners = true;

  console.log('[Ask Web] Content script loaded');
  registerShortcuts(); // Initialize global shortcuts
  registerSelectionListener(); // Initialize selection listener
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // ...
    if (request.action === 'toggleFloatingWindow') {
      toggleFloatingWindow();
    } else if (request.action === 'extractContent') {
      sendResponse(extractPageContent());
    }
  });

  // Theme support listener
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes['theme']) {
      if (floatingWindow && shadowRoot) {
        applyTheme(changes['theme'].newValue);
      }
    }
  });
}

async function getStorageData(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

// Create Floating Window
async function createFloatingWindow(options = {}) {
  if (floatingWindow) return;

  // Load state - use different storage key for selection vs normal window
  const stateKey = options.fromSelection ? 'selectionWindowState' : 'windowState';
  const state = await getStorageData([stateKey]);

  // Default dimensions for selection window vs normal window
  const defaultWidth = 380;
  const defaultHeight = options.fromSelection ? 400 : 600;

  let x, y, width, height;

  if (options.fromSelection && options.selectionRange) {
    // Calculate position near selection
    const rects = options.selectionRange.getClientRects();
    if (rects.length > 0) {
      const lastRect = rects[rects.length - 1];

      // Try to position to the right of selection
      x = lastRect.right + 20;
      y = lastRect.top;

      // If not enough space on right, try left
      if (x + defaultWidth > window.innerWidth - 20) {
        x = Math.max(20, lastRect.left - defaultWidth - 20);
      }

      // If still not enough space, position below
      if (x < 20 || x + defaultWidth > window.innerWidth - 20) {
        x = Math.min(lastRect.left, window.innerWidth - defaultWidth - 20);
        y = lastRect.bottom + 20;
      }

      // Ensure y is within bounds
      if (y + defaultHeight > window.innerHeight - 20) {
        y = Math.max(20, window.innerHeight - defaultHeight - 20);
      }
    }

    // For selection mode, always use default dimensions (don't restore saved state)
    width = defaultWidth;
    height = defaultHeight;
  } else {
    // Normal window - use saved state or defaults
    const savedState = state[stateKey] || {};
    const defaultX = Math.max(0, window.innerWidth - defaultWidth - 20);
    const defaultY = 20;

    x = savedState.x !== undefined ? savedState.x : defaultX;
    y = savedState.y !== undefined ? savedState.y : defaultY;
    width = savedState.width || defaultWidth;
    height = savedState.height || defaultHeight;
  }

  // Validate dimensions
  if (width < 200) width = defaultWidth;
  if (height < 200) height = defaultHeight;

  // Ensure within viewport bounds (keep fully on screen)
  const safeX = Math.max(10, Math.min(x, window.innerWidth - width - 10));
  const safeY = Math.max(10, Math.min(y, window.innerHeight - height - 10));

  // Create container (Host)
  try {
    floatingWindow = document.createElement('div');
    floatingWindow.id = 'ask-web-floating-window';
    floatingWindow.style.position = 'fixed';
    floatingWindow.style.zIndex = '2147483647';
    floatingWindow.style.background = 'transparent';
    floatingWindow.style.pointerEvents = 'auto';
    floatingWindow.style.display = 'block';

    // Apply initial state
    applyWindowState({ x: safeX, y: safeY, width, height });

    // Create Shadow DOM
    shadowRoot = floatingWindow.attachShadow({ mode: 'open' });

    // Load Styles
    const style = document.createElement('style');
    // Add CSS Variables definition for Light/Dark mode
    // We can reuse the CSS variables from popup.css but ensure they are scoped to :host
    style.textContent = `
    /* Theme Variables */
    :host {
      --bg-primary: #0f0f1a;
      --bg-secondary: #1a1a2e;
      --bg-tertiary: #252542;
      --text-primary: #ffffff;
      --text-secondary: #a0a0b0;
      --text-muted: #6a6a7a;
      --accent-primary: #667eea;
      --accent-secondary: #764ba2;
      --accent-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      --border-color: rgba(255, 255, 255, 0.1);
      --shadow-soft: 0 4px 20px rgba(0, 0, 0, 0.3);
      --radius-sm: 8px;
      --radius-md: 12px;
      --markdown-table-border-color: var(--border-color);
            
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: block;
      /* Remove CSS Resize */
      overflow: hidden;
      border-radius: 12px;
      box-shadow: none; /* Make it clean, no shadow */
    }

    :host([data-theme="light"]) {
      --bg-primary: #ffffff;
      --bg-secondary: #f7f9fc;
      --bg-tertiary: #edf2f7;
      --text-primary: #2d3748;
      --text-secondary: #4a5568;
      --text-muted: #718096;
      --accent-primary: #667eea;
      --accent-secondary: #764ba2;
      --accent-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      --border-color: #e2e8f0;
      --shadow-soft: 0 4px 12px rgba(0, 0, 0, 0.05);
    }

    :host([data-theme="light"]) .btn,
    :host([data-theme="light"]) .btn-primary,
    :host([data-theme="light"]) .btn-secondary,
    :host([data-theme="light"]) .btn-icon {
      background: #ffffff !important;
      border: 1px solid var(--border-color) !important;
      color: var(--text-primary) !important;
      box-shadow: none !important;
      background-image: none !important;
    }

    :host([data-theme="light"]) .btn:hover,
    :host([data-theme="light"]) .btn-icon:hover {
      background: var(--bg-secondary) !important;
      border-color: var(--accent-primary) !important;
    }
    
    * { box-sizing: border-box; }

    /* Main Container */
    .window-container {
      width: 100%;
      height: 100%;
      background: var(--bg-primary);
      color: var(--text-primary);
      /* border-radius: 12px; Host has radius */
      /* box-shadow: var(--shadow-soft); Host has shadow */
      display: flex;
      flex-direction: column;
      overflow: hidden;
      pointer-events: auto; /* Re-enable clicks */
      border: 1px solid var(--border-color);
    }

    /* Header */
    .header {
      padding: 12px 16px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: grab;
      user-select: none;
    }

    .header:active {
      cursor: grabbing;
    }

    .title {
      font-weight: 600;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--text-primary);
    }

    /* Controls Header (New) */
    .controls-header {
      display: flex;
      gap: 12px;
      align-items: center;
      padding: 12px 16px 0;
      background: var(--bg-primary);
    }

    .template-group {
      flex-grow: 1;
    }

    .template-group select {
      width: 100%;
      padding: 8px 12px;
      font-size: 13px;
      font-family: inherit;
      color: var(--text-primary);
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      cursor: pointer;
      appearance: none;
      /* We can't use external SVG easily in Shadow DOM without specific handling, keeping simple or inline SVG */
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23a0a0b0' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 10px center;
    }

    .btn-icon {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      cursor: pointer;
      padding: 4px; /* Default for close btn */
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }
    
    .header .btn-icon {
       border: none;
       background: transparent;
    }

    .header-actions {
      display: flex;
      gap: 8px;
    }
    
    .header-actions .btn-icon {
      width: 32px;
      height: 32px;
    }

    .btn-icon:hover {
      background: rgba(102, 126, 234, 0.1);
      color: var(--text-primary);
      border-color: var(--accent-primary);
    }
     
    .header .btn-icon:hover {
       background: rgba(255, 255, 255, 0.1);
       border-color: transparent;
    }

    /* Content Area */
    .content {
      flex: 1;
      overflow: hidden; /* Prevent main content from scrolling */
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      background: var(--bg-primary);
    }

    /* Controls (Header) */
    .controls {
      display: flex;
      gap: 4px;
      align-items: center;
    }

    /* Action Buttons Area */
    .actions {
      display: flex;
      flex-wrap: wrap; /* Wrap if too many buttons */
      gap: 8px;
    }

    .btn {
      padding: 6px 10px;
      border: none;
      border-radius: var(--radius-sm);
      font-weight: 500;
      font-size: 13px; /* Smaller text */
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
      white-space: nowrap;
      flex-grow: 1; /* Grow to fill space */
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }

    .btn-primary {
      background: var(--accent-gradient);
      color: white;
    }

    .btn-secondary {
      background: var(--bg-tertiary);
      color: var(--text-primary);
      border: 1px solid var(--border-color);
    }
    
    .btn-secondary:hover {
      background: var(--bg-secondary);
      border-color: var(--accent-primary);
    }

    .btn:hover { opacity: 0.95; transform: translateY(-1px); }
    .btn:active { transform: translateY(0); }

    /* Result Area */
    .result-area {
      flex: 1; /* Grow to fill space */
      overflow-y: auto; /* Scroll internally */
      background: var(--bg-secondary);
      border-radius: var(--radius-md);
      padding: 12px;
      font-size: 14px;
      line-height: 1.6;
      color: var(--text-primary);
      border: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
    }
    
    .result-content ul,
    .result-content ol {
      margin: 2px 0;
      padding-left: 0.5em;
    }

    .result-content li {
      margin-bottom: 2px;
    }

    .result-content code {
      background: var(--bg-tertiary);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
    }

    .result-content table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0;
      border: 2px solid var(--markdown-table-border-color);
    }

    .result-content th,
    .result-content td {
      border: 2px solid var(--markdown-table-border-color);
      padding: 8px;
      text-align: left;
    }

    .result-content th {
      background: rgba(255, 255, 255, 0.08);
    }

    :host([data-theme="light"]) .result-content th {
      background: rgba(0, 0, 0, 0.08);
    }
    
    .hidden { display: none !important; }
    
    .cursor-blink {
      display: inline-block;
      width: 8px;
      height: 14px;
      background: var(--accent-primary);
      animation: blink 1s infinite;
      vertical-align: middle;
      margin-left: 2px;
    }
    
    @keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }

    /* Resize Handles */
    .resize-handle {
      position: absolute;
      z-index: 2147483648;
      background: transparent;
    }

    .resize-handle.left {
      left: 0;
      top: 0;
      width: 8px;
      height: 100%;
      cursor: ew-resize;
    }

    .resize-handle.right {
      right: 0;
      top: 0;
      width: 8px;
      height: 100%;
      cursor: ew-resize;
    }

    .resize-handle.bottom {
      left: 0;
      bottom: 0;
      width: 100%;
      height: 8px;
      cursor: ns-resize;
    }


    .resize-handle.bottom-right {
      right: 0;
      bottom: 0;
      width: 16px;
      height: 16px;
      cursor: nwse-resize;
    }

    /* History List */
    .history-list {
      position: absolute;
      top: 60px; /* Below header */
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--bg-primary);
      z-index: 10;
      padding: 12px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .history-item {
      padding: 12px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: all 0.2s;
    }

    .history-item:hover {
      border-color: var(--accent-primary);
      transform: translateY(-1px);
    }

    .history-meta {
      display: flex;
      justify-content: space-between;
      color: var(--text-muted);
      font-size: 11px;
      margin-bottom: 4px;
    }

    .history-preview {
      color: var(--text-primary);
      font-size: 13px;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    
    .empty-state {
        text-align: center;
        padding: 40px 20px;
        color: var(--text-muted);
    }

    /* Copy Actions */
    .copy-actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      justify-content: flex-end;
      padding-top: 12px;
      border-top: 1px solid var(--border-color);
    }

    .copy-btn {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      padding: 4px 10px;
      font-size: 12px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .copy-btn:hover {
      background: var(--bg-secondary);
      border-color: var(--accent-primary);
      color: var(--text-primary);
    }

    .copy-btn.copied {
      background: rgba(72, 187, 120, 0.1);
      border-color: #48bb78;
      color: #48bb78;
    }

    /* Mindmap */
    .mindmap-container {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
      position: relative;
    }

    .mindmap-container.hidden {
      display: none;
    }

    .mindmap-toolbar {
      position: absolute;
      bottom: 8px;
      right: 8px;
      z-index: 10;
      display: flex;
      gap: 4px;
    }

    .mindmap-svg-wrapper {
      flex: 1;
      overflow: hidden;
      border-radius: var(--radius-md);
      background: var(--bg-secondary);
      min-height: 200px;
    }

    .mindmap-svg-wrapper svg {
      width: 100%;
      height: 100%;
      display: block;
    }

    /* markmap-toolbar styles (adapted for shadow DOM) */
    .mm-toolbar {
      position: absolute;
      bottom: 8px;
      left: 8px;
      z-index: 10;
      display: flex;
      user-select: none;
      align-items: center;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      background: var(--bg-primary);
      padding: 4px;
      line-height: 1;
    }
    .mm-toolbar:hover { border-color: var(--accent-primary); }
    .mm-toolbar svg { display: block; }
    .mm-toolbar a { display: inline-block; text-decoration: none; }
    .mm-toolbar-brand > img { width: 1rem; height: 1rem; vertical-align: middle; }
    .mm-toolbar-brand > span { padding: 0 4px; }
    .mm-toolbar-brand:not(:first-child),
    .mm-toolbar-item:not(:first-child) { margin-left: 4px; }
    .mm-toolbar-brand > *, .mm-toolbar-item > * {
      min-width: 1rem;
      cursor: pointer;
      text-align: center;
      font-size: 12px;
      line-height: 1rem;
      color: var(--text-secondary);
    }
    .mm-toolbar-brand:hover, .mm-toolbar-item:hover,
    .mm-toolbar-brand.active, .mm-toolbar-item.active {
      border-radius: 4px;
      background: var(--bg-tertiary);
    }
    .mm-toolbar-brand:hover > *, .mm-toolbar-item:hover > *,
    .mm-toolbar-brand.active > *, .mm-toolbar-item.active > * {
      color: var(--text-primary);
    }

  `;
    shadowRoot.appendChild(style);

    // Load HTML
    const container = document.createElement('div');
    container.className = 'window-container';
    container.innerHTML = `
    <!-- Resize Handles -->
    <div class="resize-handle left"></div>
    <div class="resize-handle right"></div>
    <div class="resize-handle bottom"></div>
    <div class="resize-handle bottom-right"></div>
    
    <div class="header" id="dragHandle">
      <div class="title">
        Ask Web
      </div>
      <div class="controls">
        <button id="settingsBtn" class="btn-icon" title="Settings">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <button id="historyBtn" class="btn-icon" title="History">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
        </button>
        <button class="btn-icon" id="closeBtn" title="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
    
    <div class="content">
      <div id="actionButtons" class="actions">
        <!-- Dynamic Buttons injected here -->
      </div>
      
      <div id="resultArea" class="result-area hidden">
        <div id="resultContent" class="result-content"></div>
        <div id="copyActions" class="copy-actions hidden">
           <!-- Buttons will be injected here -->
        </div>
        <div id="mindmapContainer" class="mindmap-container hidden">
          <div class="mindmap-svg-wrapper">
            <svg id="mindmapSvg"></svg>
          </div>
          <div class="mindmap-toolbar">
            <button id="mindmapBackBtn" class="copy-btn">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
              Back
            </button>
          </div>
        </div>
      </div>
      
      <div id="historyList" class="history-list hidden">
         <!-- History items injected here -->
      </div>

      
      <div id="loading" class="hidden" style="text-align: center; color: var(--text-secondary);">
        <div class="spinner" style="
          width: 24px;
          height: 24px;
          border: 3px solid var(--bg-tertiary);
          border-top-color: var(--accent-primary);
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 10px;
        "></div>
        <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
        Analyzing...
      </div>
    </div>
  `;
    shadowRoot.appendChild(container);

    document.body.appendChild(floatingWindow);

    // Track window type for state persistence
    isSelectionWindow = options.fromSelection || false;

    // Initialize Theme
    const storage = await getStorageData(['theme']);
    applyTheme(storage.theme || 'dark');

    // Load Templates
    await loadTemplates(shadowRoot);

    // Load History
    await loadLatestContent(shadowRoot);


    // Behavior
    setupDragAndResize(floatingWindow, container);
    setupEventListeners(shadowRoot);

    // Save initial state if needed
    saveWindowState();
  } catch (e) {
  }
}

function applyTheme(theme) {
  if (floatingWindow) {
    if (theme === 'light') {
      floatingWindow.setAttribute('data-theme', 'light');
    } else {
      floatingWindow.removeAttribute('data-theme');
    }
  }
}

function applyWindowState(state) {
  if (!floatingWindow || !state) return;

  const { x, y, width, height } = state;
  // Keep window fully on screen if possible, but allow dragging off partially (max 50px left/right/bottom)
  const safeX = Math.min(Math.max(50 - width, x), window.innerWidth - 50);
  const safeY = Math.min(Math.max(0, y), window.innerHeight - 50);

  floatingWindow.style.left = `${safeX}px`;
  floatingWindow.style.top = `${safeY}px`;
  floatingWindow.style.width = `${width}px`;
  floatingWindow.style.height = `${height}px`;
}

async function loadTemplates(root) {
  const data = await getStorageData(['prompt_templates']);
  const templates = data.prompt_templates || [
    { id: 'summarize', name: 'Summarize', prompt: 'Please provide a concise summary of the following web content. Focus on the main points and key takeaways:\n\n{{content}}' },
    { id: 'explain', name: 'Explain', prompt: 'Explain the following web content in simple terms that anyone can understand:\n\n{{content}}' },
    { id: 'key_points', name: 'Key Points', prompt: 'Extract the key points from the following web content as a bullet list:\n\n{{content}}' }
  ];

  const container = root.getElementById('actionButtons');
  container.innerHTML = '';

  // 1. Render Template Buttons
  templates.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary'; // Default to secondary style for templates
    btn.textContent = t.name;
    // Store prompt in dataset
    btn.dataset.prompt = t.prompt;
    btn.dataset.action = 'template';
    btn.dataset.model = t.model || '';

    // Attach click listener directly
    btn.addEventListener('click', () => handleTemplateClick(root, t.prompt, t.model));

    if (isSelectionWindow) {
      btn.style.display = 'none';
    }
    container.appendChild(btn);
  });

  // 2. Render Chat Button (Always last)
  const chatBtn = document.createElement('button');
  chatBtn.className = 'btn btn-primary'; // Chat gets primary emphasis? Or maybe distinct?
  // Let's keep Chat as Primary for now, or maybe make Summarize primary? 
  // User asked for "individual action buttons... aligned with chat button".
  chatBtn.textContent = 'Chat';
  chatBtn.id = 'chatBtn';
  chatBtn.addEventListener('click', () => handleChatClick(root));

  container.appendChild(chatBtn);

  if (isSelectionWindow) {
    chatBtn.style.display = 'none';
  }
}

// Logic for Template Clicks
async function handleTemplateClick(root, promptTemplate, modelOverride) {
  const resultArea = root.getElementById('resultArea');
  const resultContent = root.getElementById('resultContent');
  const loading = root.getElementById('loading');

  // Reset state
  resultContent.innerHTML = '';
  root.getElementById('copyActions').classList.add('hidden');
  root.getElementById('mindmapContainer').classList.add('hidden');
  resultContent.classList.remove('hidden');
  currentStreamContent = '';

  resultArea.classList.add('hidden');
  loading.classList.remove('hidden');

  try {
    const pageData = extractPageContent();
    const prompt = promptTemplate.replace('{{content}}', truncateContent(pageData.content));

    const response = await chrome.runtime.sendMessage({
      action: 'startPopupStream',
      messages: [{
        role: 'user',
        content: prompt
      }],
      model: modelOverride // Pass optional model override
    });

    // Show result area immediately for streaming
    loading.classList.add('hidden');
    resultArea.classList.remove('hidden');
    resultContent.innerHTML = '<span class="cursor-blink">▊</span>';

  } catch (err) {
    loading.classList.add('hidden');
    resultContent.textContent = 'Error: ' + err.message;
    resultArea.classList.remove('hidden');
  }
}

// Shortcut Support
async function registerShortcuts() {
  // Listen for storage changes to update shortcuts in real-time if settings change
  let templates = await getTemplates();
  let floatingShortcut = await getFloatingShortcut();

  chrome.storage.onChanged.addListener((changes) => {
    if (changes[StorageKeys.TEMPLATES]) {
      templates = changes[StorageKeys.TEMPLATES].newValue;
    }
    if (changes[StorageKeys.FLOATING_SHORTCUT]) {
      floatingShortcut = changes[StorageKeys.FLOATING_SHORTCUT].newValue;
    }
  });

  window.addEventListener('keydown', (e) => {
    // Handle Esc to hide
    if (e.key === 'Escape' && isVisible) {
      toggleFloatingWindow();
      return;
    }

    // Ignore if typing in an input

    // Check Global Floating Window Shortcut
    if (floatingShortcut) {
      const parts = floatingShortcut.split('+');
      const keyStr = parts.pop().toUpperCase();
      const ctrl = parts.includes('Ctrl');
      const alt = parts.includes('Alt');
      const shift = parts.includes('Shift');
      const meta = parts.includes('Meta');

      if (e.key.toUpperCase() === keyStr &&
        e.ctrlKey === ctrl &&
        e.altKey === alt &&
        e.shiftKey === shift &&
        e.metaKey === meta) {

        e.preventDefault();
        e.stopPropagation();
        toggleFloatingWindow();
        return;
      }
    }

    for (const t of templates) {
      if (!t.shortcut) continue;

      const parts = t.shortcut.split('+');
      const keyStr = parts.pop().toUpperCase();

      const ctrl = parts.includes('Ctrl');
      const alt = parts.includes('Alt');
      const shift = parts.includes('Shift');
      const meta = parts.includes('Meta');

      const match = e.key.toUpperCase() === keyStr &&
        e.ctrlKey === ctrl &&
        e.altKey === alt &&
        e.shiftKey === shift &&
        e.metaKey === meta;

      if (match) {
        e.preventDefault();
        e.stopPropagation();
        triggerTemplateAction(t);
        break;
      }
    }
  });
}

async function triggerTemplateAction(template) {
  if (!isVisible) {
    await toggleFloatingWindow();
  }

  // Wait for shadowRoot to be initialized
  const maxWait = 20; // 2 seconds
  let waited = 0;
  const timer = setInterval(() => {
    if (shadowRoot || waited > maxWait) {
      clearInterval(timer);
      if (shadowRoot) {
        handleTemplateClick(shadowRoot, template.prompt, template.model);
      }
    }
    waited++;
  }, 100);
}

async function handleChatClick(root) {
  const pageData = extractPageContent();
  chrome.runtime.sendMessage({
    action: 'openChat',
    pageData: pageData
  });
}

async function toggleFloatingWindow(fromSelection = false, selectionRange = null) {
  if (!floatingWindow) {
    try {
      const options = { fromSelection, selectionRange };
      await createFloatingWindow(options);
      isVisible = true;
    } catch (e) {
      console.error('[Ask Web] Failed to create floating window:', e);
    }
  } else {
    // If triggered from selection, reposition and resize the window
    if (fromSelection && selectionRange) {
      const defaultWidth = 380;
      const defaultHeight = 400;

      // Load saved selection window state if available
      const storage = await getStorageData(['selectionWindowState']);
      const savedState = storage.selectionWindowState;

      let width = defaultWidth;
      let height = defaultHeight;

      if (savedState) {
        width = savedState.width;
        height = savedState.height;
      }

      // Calculate position near selection
      const rects = selectionRange.getClientRects();
      if (rects.length > 0) {
        const lastRect = rects[rects.length - 1];

        // Try to position to the right of selection
        let x = lastRect.right + 20;
        let y = lastRect.top;

        // If not enough space on right, try left
        if (x + width > window.innerWidth - 20) {
          x = Math.max(20, lastRect.left - width - 20);
        }

        // If still not enough space, position below
        if (x < 20 || x + width > window.innerWidth - 20) {
          x = Math.min(lastRect.left, window.innerWidth - width - 20);
          y = lastRect.bottom + 20;
        }

        // Ensure y is within bounds
        if (y + height > window.innerHeight - 20) {
          y = Math.max(20, window.innerHeight - height - 20);
        }

        // Apply new position and size
        applyWindowState({ x, y, width, height });
      }

      // Update window type flag
      isSelectionWindow = true;

      // Show the window if it was hidden
      if (!isVisible) {
        isVisible = true;
        floatingWindow.style.display = 'block';
        // Reload latest content when showing
        await loadLatestContent(shadowRoot);
      }

      // Update template buttons visibility
      const templateBtns = shadowRoot.querySelectorAll('button[data-action="template"]');
      templateBtns.forEach(btn => {
        btn.style.display = 'none';
      });
      // Hide Chat button
      const chatBtn = shadowRoot.getElementById('chatBtn');
      if (chatBtn) chatBtn.style.display = 'none';

    } else {
      // Normal toggle (for Esc key, keyboard shortcuts, etc.)
      isVisible = !isVisible;
      floatingWindow.style.display = isVisible ? 'block' : 'none';

      if (isVisible) {
        // Switch to normal mode
        isSelectionWindow = false;

        // Restore normal window state
        const storage = await getStorageData(['windowState']);
        const savedState = storage.windowState || {};
        const defaultWidth = 380;
        const defaultHeight = 600;

        const defaultX = Math.max(0, window.innerWidth - defaultWidth - 20);
        const defaultY = 20;

        const x = savedState.x !== undefined ? savedState.x : defaultX;
        const y = savedState.y !== undefined ? savedState.y : defaultY;
        const width = savedState.width || defaultWidth;
        const height = savedState.height || defaultHeight;

        applyWindowState({ x, y, width, height });

        // Update template buttons visibility
        const templateBtns = shadowRoot.querySelectorAll('button[data-action="template"]');
        templateBtns.forEach(btn => {
          btn.style.display = ''; // Reset to default
        });
        // Show Chat button
        const chatBtn = shadowRoot.getElementById('chatBtn');
        if (chatBtn) chatBtn.style.display = '';
      }

      // Hide selection icon when closing the window
      if (!isVisible) {
        hideSelectionIcon();
        // Clear text selection
        window.getSelection().removeAllRanges();
        // Reset selection window flag when hiding
        isSelectionWindow = false;
      } else {
        // Reload latest content when showing
        await loadLatestContent(shadowRoot);
      }
    }
  }
}

function hideFloatingWindow() {
  if (!floatingWindow) return;
  saveWindowState();
  isVisible = false;
  floatingWindow.style.display = 'none';
  hideSelectionIcon(); // Also hide selection icon
  window.getSelection().removeAllRanges(); // Clear text selection
}

// Persistence Helper
function saveWindowState() {
  if (!floatingWindow) return;
  const rect = floatingWindow.getBoundingClientRect();
  if (floatingWindow.style.display === 'none') return;
  if (rect.width === 0 || rect.height === 0) return;

  const state = {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  };

  if (isSelectionWindow) {
    chrome.storage.local.set({ selectionWindowState: state });
  } else {
    // Save to normal window state only
    chrome.storage.local.set({ windowState: state });
  }
}

// Drag Logic - hostEl is floatingWindow, containerEl is the .window-container in Shadow DOM
function setupDragAndResize(hostEl, containerEl) {
  const dragHandle = containerEl.querySelector('#dragHandle');
  const handles = {
    left: containerEl.querySelector('.resize-handle.left'),
    right: containerEl.querySelector('.resize-handle.right'),
    bottom: containerEl.querySelector('.resize-handle.bottom'),
    bottomRight: containerEl.querySelector('.resize-handle.bottom-right')
  };

  let isMoving = false;
  let moveType = null;
  let startX, startY;
  let initialRect;

  function start(e, type) {
    if (type === 'drag' && e.target.closest('.controls')) return;

    e.preventDefault();
    isMoving = true;
    moveType = type;
    startX = e.clientX;
    startY = e.clientY;
    initialRect = hostEl.getBoundingClientRect();

    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', stop);

    // Disable text selection while moving
    document.body.style.userSelect = 'none';
  }

  function move(e) {
    if (!isMoving) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (moveType === 'drag') {
      hostEl.style.left = `${initialRect.left + dx}px`;
      hostEl.style.top = `${initialRect.top + dy}px`;
    } else if (moveType === 'resize-left') {
      const newWidth = Math.max(250, initialRect.width - dx);
      if (newWidth !== initialRect.width - dx) {
        // Hit min width
        hostEl.style.left = `${initialRect.right - newWidth}px`;
      } else {
        hostEl.style.left = `${initialRect.left + dx}px`;
      }
      hostEl.style.width = `${newWidth}px`;
    } else if (moveType === 'resize-right') {
      hostEl.style.width = `${Math.max(250, initialRect.width + dx)}px`;
    } else if (moveType === 'resize-bottom') {
      hostEl.style.height = `${Math.max(200, initialRect.height + dy)}px`;
    } else if (moveType === 'resize-bottom-right') {
      hostEl.style.width = `${Math.max(250, initialRect.width + dx)}px`;
      hostEl.style.height = `${Math.max(200, initialRect.height + dy)}px`;
    }
  }

  function stop() {
    if (!isMoving) return;
    isMoving = false;
    moveType = null;
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', stop);
    document.body.style.userSelect = '';
    saveWindowState();
  }

  // Attach Listeners
  dragHandle.addEventListener('mousedown', (e) => start(e, 'drag'));
  if (handles.left) handles.left.addEventListener('mousedown', (e) => start(e, 'resize-left'));
  if (handles.right) handles.right.addEventListener('mousedown', (e) => start(e, 'resize-right'));
  if (handles.bottom) handles.bottom.addEventListener('mousedown', (e) => start(e, 'resize-bottom'));
  if (handles.bottomRight) handles.bottomRight.addEventListener('mousedown', (e) => start(e, 'resize-bottom-right'));

  // Keep observer for visibility/system changes
  const resizeObserver = new ResizeObserver(() => {
    if (!isMoving) saveWindowState();
  });
  resizeObserver.observe(hostEl);
}

function setupEventListeners(root) {
  // Stream Listener
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'popupStreamChunk') {
      appendStreamContent(request.content, root);
    } else if (request.action === 'popupStreamEnd') {
      handleStreamEnd(root);
    } else if (request.action === 'popupStreamError') {
      // Handle error
      const loading = root.getElementById('loading');
      if (loading) loading.classList.add('hidden');

      const resultContent = root.getElementById('resultContent');
      if (resultContent) {
        resultContent.innerHTML += `<br><span style="color:red">Error: ${request.error}</span>`;
      }
    }
  });

  root.getElementById('closeBtn').addEventListener('click', hideFloatingWindow);

  const settingsBtn = root.getElementById('settingsBtn');
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openOptions' });
  });

  const historyBtn = root.getElementById('historyBtn');
  historyBtn.addEventListener('click', () => toggleHistory(root));

  const mindmapBackBtn = root.getElementById('mindmapBackBtn');
  mindmapBackBtn.addEventListener('click', () => hideMindmap(root));
}

async function handleStreamEnd(root) {
  const loading = root.getElementById('loading');
  loading.classList.add('hidden');

  // Clean up cursor
  const resultContent = root.getElementById('resultContent');
  const cursor = resultContent.querySelector('.cursor-blink');
  if (cursor) cursor.remove();

  // Save to history
  if (currentStreamContent) {
    await saveContentHistory(currentStreamContent);
    renderCopyButtons(root);
  }
}

// History Functions
function getHistoryKey() {
  return `history_${window.location.href}`;
}

async function saveContentHistory(content) {
  const key = getHistoryKey();
  const data = await getStorageData([key]);
  const history = data[key] || [];

  // Create new entry
  const entry = {
    id: Date.now(),
    timestamp: Date.now(),
    content: content,
    summary: content.substring(0, 150) + (content.length > 150 ? '...' : '')
  };

  // Add to top
  history.unshift(entry);

  // Keep last 10
  if (history.length > 10) {
    history.length = 10;
  }

  await chrome.storage.local.set({ [key]: history });
}

async function loadLatestContent(root) {
  const key = getHistoryKey();
  const data = await getStorageData([key]);
  const history = data[key] || [];

  if (history.length > 0) {
    const latest = history[0];
    const resultArea = root.getElementById('resultArea');
    const resultContent = root.getElementById('resultContent');

    try {
      if (typeof marked !== 'undefined') {
        resultContent.innerHTML = marked.parse(latest.content);
      } else {
        resultContent.textContent = latest.content;
      }
    } catch (e) {
      resultContent.textContent = latest.content; // Fallback
    }

    resultArea.classList.remove('hidden');
    currentStreamContent = latest.content; // Restore state
    renderCopyButtons(root);
  }
}

async function toggleHistory(root) {
  const historyList = root.getElementById('historyList');
  const resultArea = root.getElementById('resultArea');

  if (historyList.classList.contains('hidden')) {
    // Show History
    await renderHistoryList(root);
    historyList.classList.remove('hidden');
    resultArea.classList.add('hidden');
  } else {
    // Hide History
    historyList.classList.add('hidden');
    // Show result if we have content
    if (root.getElementById('resultContent').innerHTML) {
      resultArea.classList.remove('hidden');
    }
  }
}

async function renderHistoryList(root) {
  const key = getHistoryKey();
  const data = await getStorageData([key]);
  const history = data[key] || [];
  const container = root.getElementById('historyList');

  container.innerHTML = '';

  if (history.length === 0) {
    container.innerHTML = '<div class="empty-state">No history yet</div>';
    return;
  }

  history.forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';

    const date = new Date(item.timestamp).toLocaleString();

    div.innerHTML = `
            <div class="history-meta">${date}</div>
            <div class="history-preview">${item.summary.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
        `;

    div.addEventListener('click', () => {
      restoreHistoryItem(root, item);
    });

    container.appendChild(div);
  });
}

function restoreHistoryItem(root, item) {
  const resultArea = root.getElementById('resultArea');
  const resultContent = root.getElementById('resultContent');
  const historyList = root.getElementById('historyList');

  try {
    if (typeof marked !== 'undefined') {
      resultContent.innerHTML = marked.parse(item.content);
    } else {
      resultContent.textContent = item.content;
    }
  } catch (e) {
    resultContent.textContent = item.content;
  }

  currentStreamContent = item.content;
  renderCopyButtons(root);

  historyList.classList.add('hidden');
  resultArea.classList.remove('hidden');
}

// Stream Helpers
var currentStreamContent = '';

function appendStreamContent(content, root) {
  currentStreamContent += content;
  renderMarkdown(currentStreamContent, root, true);
}

function handleStreamError(error, root) {
  const resultArea = root.getElementById('resultArea');
  const resultContent = root.getElementById('resultContent');
  resultContent.textContent = 'Error: ' + error;
  resultArea.classList.remove('hidden');
}

function renderMarkdown(text, root, showCursor) {
  const resultContent = root.getElementById('resultContent');
  const cursorHtml = showCursor ? '<span class="cursor-blink">▊</span>' : '';

  if (typeof marked !== 'undefined') {
    // Configure marked if needed
    resultContent.innerHTML = marked.parse(text) + cursorHtml;
  } else {
    resultContent.textContent = text;
    if (showCursor) {
      // Simple text content doesn't handle HTML accumulation well if we use textContent
      // But if we use innerHTML we need to escape.
      // For now, assume marked is present as per manifest.
      resultContent.innerHTML += cursorHtml;
    }
  }
}

function renderCopyButtons(root) {
  const copyActions = root.getElementById('copyActions');
  if (!copyActions) return;

  copyActions.innerHTML = '';
  copyActions.classList.remove('hidden');

  // Helper to create button
  const createBtn = (title, iconSvg, onClick) => {
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.title = title;
    btn.innerHTML = iconSvg;
    btn.addEventListener('click', async () => {
      await onClick();
      const originalHtml = btn.innerHTML;
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      `;
      btn.classList.add('copied');
      setTimeout(() => {
        btn.innerHTML = originalHtml;
        btn.classList.remove('copied');
      }, 2000);
    });
    return btn;
  };

  // Markdown Button (Code Brackets Icon)
  const mdIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`;
  const mdBtn = createBtn('Copy Markdown', mdIcon, async () => {
    await navigator.clipboard.writeText(currentStreamContent);
  });

  // Rich Text Button (File Text Icon)
  const richIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
  const richTextBtn = createBtn('Copy Rich Text', richIcon, async () => {
    let htmlContent = '';
    if (typeof marked !== 'undefined') {
      htmlContent = marked.parse(currentStreamContent);
    } else {
      htmlContent = `<p>${currentStreamContent.replace(/\n\n/g, '</p><p>')}</p>`;
    }

    try {
      const blobHtml = new Blob([htmlContent], { type: 'text/html' });
      const blobText = new Blob([currentStreamContent], { type: 'text/plain' });
      const data = [new ClipboardItem({
        'text/html': blobHtml,
        'text/plain': blobText
      })];
      await navigator.clipboard.write(data);
    } catch (err) {
      console.error('Failed to copy rich text:', err);
      // Fallback
      await navigator.clipboard.writeText(htmlContent);
    }
  });

  copyActions.appendChild(mdBtn);
  copyActions.appendChild(richTextBtn);

  // Mindmap Button — only shown when markmap is available and content looks like markdown
  if (typeof markmap !== 'undefined' && markmap.Transformer && markmap.Markmap && looksLikeMarkdown(currentStreamContent)) {
    const mindmapIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="2"></circle><circle cx="5" cy="19" r="2"></circle><circle cx="19" cy="19" r="2"></circle><line x1="12" y1="7" x2="12" y2="13"></line><line x1="12" y1="13" x2="5" y2="17"></line><line x1="12" y1="13" x2="19" y2="17"></line></svg>`;
    const mindmapBtn = document.createElement('button');
    mindmapBtn.className = 'copy-btn';
    mindmapBtn.title = 'Show Mind Map';
    mindmapBtn.innerHTML = mindmapIcon;
    mindmapBtn.addEventListener('click', () => showMindmap(root));
    copyActions.appendChild(mindmapBtn);
  }
}

function looksLikeMarkdown(text) {
  if (!text) return false;
  return /^#{1,6}\s/m.test(text) || /^[-*+]\s/m.test(text) || /^\d+\.\s/m.test(text);
}

function showMindmap(root) {
  const resultContent = root.getElementById('resultContent');
  const copyActions = root.getElementById('copyActions');
  const mindmapContainer = root.getElementById('mindmapContainer');
  const mindmapSvg = root.getElementById('mindmapSvg');

  resultContent.classList.add('hidden');
  copyActions.classList.add('hidden');
  mindmapContainer.classList.remove('hidden');

  // Clear previous render and toolbar
  mindmapSvg.innerHTML = '';
  const oldToolbar = mindmapContainer.querySelector('.mm-toolbar');
  if (oldToolbar) oldToolbar.remove();

  try {
    const transformer = new markmap.Transformer();
    const { root: mmRoot } = transformer.transform(currentStreamContent);
    const mm = markmap.Markmap.create(mindmapSvg, { autoFit: true }, mmRoot);

    if (markmap.Toolbar) {
      const toolbar = markmap.Toolbar.create(mm);
      toolbar.showBrand = false;
      toolbar.register({
        id: 'fullscreen',
        title: 'Open in new tab',
        content: markmap.Toolbar.icon('M3 3h6v2h-4v4h-2zM11 3h6v6h-2v-4h-4zM3 11h2v4h4v2h-6zM15 13h2v4h-6v-2h4z', { stroke: 'none', fill: 'currentColor' }),
        onClick: () => openMindmapTab(),
      });
      toolbar.setItems(['zoomIn', 'zoomOut', 'fit', 'recurse', 'fullscreen']);
      mindmapContainer.appendChild(toolbar.el);
    }
  } catch (err) {
    console.error('Mindmap render error:', err);
    mindmapSvg.innerHTML = `<text x="10" y="20" fill="red">Failed to render mindmap: ${err.message}</text>`;
  }
}

function hideMindmap(root) {
  const resultContent = root.getElementById('resultContent');
  const copyActions = root.getElementById('copyActions');
  const mindmapContainer = root.getElementById('mindmapContainer');

  mindmapContainer.classList.add('hidden');
  resultContent.classList.remove('hidden');
  copyActions.classList.remove('hidden');
}

async function openMindmapTab() {
  chrome.runtime.sendMessage({ action: 'openMindmapTab', content: currentStreamContent });
}

// Content Extraction Strategy
function extractPageContent() {
  // 1. Try Selection
  const selection = window.getSelection().toString().trim();
  if (selection) {
    return { title: document.title, url: window.location.href, content: selection };
  }

  // 2. Try simple article detection
  const article = document.querySelector('article');
  if (article) {
    return { title: document.title, url: window.location.href, content: article.innerText };
  }

  // 3. Try main tag
  const main = document.querySelector('main');
  if (main) {
    return { title: document.title, url: window.location.href, content: main.innerText };
  }

  // 4. Fallback to body but try to exclude nav, header, footer if possible
  // Clone body to manipulate
  const bodyClone = document.body.cloneNode(true);
  const scripts = bodyClone.querySelectorAll('script, style, nav, header, footer, noscript');
  scripts.forEach(el => el.remove());

  return { title: document.title, url: window.location.href, content: bodyClone.innerText.trim() };
}

init();
// Text Selection Logic
let selectionIcon = null;
let selectionIconShadow = null;
let currentSelection = null;

async function registerSelectionListener() {
  // Listen for selection changes
  document.addEventListener('mouseup', handleSelection);
  document.addEventListener('keyup', handleSelection); // For keyboard selection
  document.addEventListener('mousedown', (e) => {
    // Hide icon on click elsewhere if not clicking the icon itself
    // Check both the host element and its shadow root contents
    if (selectionIcon && e.target !== selectionIcon && !selectionIcon.contains(e.target)) {
      // Also check if we're clicking inside the shadow DOM
      const path = e.composedPath();
      if (!path.includes(selectionIcon)) {
        hideSelectionIcon();
      }
    }
  });

  // Listen for setting changes
  let config = await getSelectionConfig();
  chrome.storage.onChanged.addListener((changes) => {
    if (changes[StorageKeys.ENABLE_SELECTION_ICON]) {
      config.enabled = changes[StorageKeys.ENABLE_SELECTION_ICON].newValue;
    }
    if (changes[StorageKeys.SELECTION_ICON_TRIGGER_MODE]) {
      config.triggerMode = changes[StorageKeys.SELECTION_ICON_TRIGGER_MODE].newValue;
      // Recreate icon with new trigger mode
      if (selectionIcon) {
        selectionIcon.remove();
        selectionIcon = null;
        selectionIconShadow = null;
      }
    }
  });
}

async function handleSelection(e) {
  const config = await getSelectionConfig();
  if (!config.enabled) return;

  const selection = window.getSelection();
  const text = selection.toString().trim();

  // Basic validation
  if (!text || text.length < 2) {
    hideSelectionIcon();
    return;
  }

  // Check if inside input/textarea
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
    return; // Optional: might want to allow it in some cases, but usually annoying
  }

  // Store selection for action
  currentSelection = {
    text: text,
    range: selection.getRangeAt(0).cloneRange()
  };

  // Show Icon
  showSelectionIcon(currentSelection.range);
}

async function showSelectionIcon(range) {
  if (!selectionIcon) {
    await createSelectionIcon();
  }

  const rects = range.getClientRects();
  if (rects.length === 0) return;
  const lastRect = rects[rects.length - 1];

  // Position relative to viewport since position: fixed
  const top = lastRect.bottom + 10;
  const left = lastRect.right;

  selectionIcon.style.top = `${top}px`;
  selectionIcon.style.left = `${left}px`;
  selectionIcon.style.display = 'block';

  // Ensure icon is within viewport
  const iconRect = selectionIcon.getBoundingClientRect();
  if (iconRect.right > window.innerWidth) {
    selectionIcon.style.left = `${window.innerWidth - iconRect.width - 10}px`;
  }
}

function hideSelectionIcon() {
  if (selectionIcon) {
    selectionIcon.style.display = 'none';
  }
}

async function createSelectionIcon() {
  const config = await getSelectionConfig();
  const triggerMode = config.triggerMode || 'click';

  selectionIcon = document.createElement('div');
  selectionIcon.id = 'ask-web-selection-icon';
  selectionIcon.style.position = 'fixed';
  selectionIcon.style.zIndex = '2147483647';
  selectionIcon.style.display = 'none';
  selectionIcon.style.cursor = 'pointer';

  selectionIconShadow = selectionIcon.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    .icon {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 50%;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s;
      cursor: pointer;
    }
    .icon:hover {
      transform: scale(1.1);
    }
    svg {
      color: white;
      width: 18px;
      height: 18px;
    }
  `;

  const icon = document.createElement('div');
  icon.className = 'icon';
  icon.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
    </svg>
  `;

  // Attach event listener based on trigger mode
  if (triggerMode === 'hover') {
    icon.addEventListener('mouseenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleSelectionIconClick();
    });
  } else {
    // Default to click mode
    icon.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevent losing selection
      e.stopPropagation();
      handleSelectionIconClick();
    });
  }

  selectionIconShadow.appendChild(style);
  selectionIconShadow.appendChild(icon);

  document.body.appendChild(selectionIcon);
}

async function handleSelectionIconClick() {
  hideSelectionIcon(); // Hide immediately for better UX
  const config = await getSelectionConfig();
  const selectionText = currentSelection.text;

  // Get Context
  const context = getSelectionContext(currentSelection.range);

  // Prepare Prompt
  // Replace {{selection}} and ensure context is added if not explicitly in prompt
  let prompt = config.prompt;

  // If prompt uses {{selection}}, put the selection there.
  // We also want to provide context.
  // Best approach: Construct a full prompt string that the user sees as the "User Prompt" to the model?
  // Or inject it into the system prompt?
  // The current `handleTemplateClick` sends `prompt` as the user message.

  // Let's format the context nicely.
  const fullContent = `Context before: "${context.before}"\n\nSelected Text: "${selectionText}"\n\nContext after: "${context.after}"`;

  // If user prompt has {{selection}}, replace it.
  // If user prompt has {{content}}, replace it with full context + selection?
  // Let's replace {{selection}} with the selection.
  // And replace {{content}} with selection (for backward compat if they use generic templates).

  prompt = prompt.replace(/{{selection}}/g, selectionText);
  prompt = prompt.replace(/{{content}}/g, selectionText);

  // Append context to the prompt transparently or prefix it?
  // "Using the following context: ... \n\n [User Prompt]"
  const finalPrompt = `Context: ${context.before} [TARGET]${selectionText}[/TARGET] ${context.after}\n\n${prompt}`;

  // Open Floating Window with half height for selection actions
  if (!isVisible) {
    await toggleFloatingWindow(true, currentSelection.range); // Pass selection range for positioning
  }

  // Wait for window to be ready
  const maxWait = 20;
  let waited = 0;
  const timer = setInterval(() => {
    if (shadowRoot || waited > maxWait) {
      clearInterval(timer);
      if (shadowRoot) {
        // Trigger generic template handler but with our specific prompt
        handleTemplateClick(shadowRoot, finalPrompt, config.model);
      }
    }
    waited++;
  }, 100);
}

function getSelectionContext(range, charCount = 300) {
  // Simple context extraction
  // We can use the range's containers

  let before = '';
  let after = '';

  try {
    const preRange = document.createRange();
    preRange.setStartBefore(document.body.firstChild || document.body);
    preRange.setEnd(range.startContainer, range.startOffset);
    const preText = preRange.toString();
    before = preText.slice(-charCount);

    const postRange = document.createRange();
    postRange.setStart(range.endContainer, range.endOffset);
    postRange.setEndAfter(document.body.lastChild || document.body);
    const postText = postRange.toString();
    after = postText.slice(0, charCount);
  } catch (e) {
    console.warn('Error getting context', e);
  }

  return { before, after };
}
