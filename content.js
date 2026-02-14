// Content script for Ask Web
var floatingWindow = floatingWindow || null;
var shadowRoot = shadowRoot || null;
var isVisible = typeof isVisible !== 'undefined' ? isVisible : false;

// Initialize
function init() {
  // Prevent adding listeners multiple times
  if (window.hasAskWebListeners) return;
  window.hasAskWebListeners = true;

  console.log('[Ask Web] Content script loaded');
  registerShortcuts(); // Initialize global shortcuts
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
async function createFloatingWindow() {
  if (floatingWindow) return;

  // Load state
  const state = await getStorageData(['windowState']);

  // Default to Top-Right
  const defaultWidth = 380;
  const defaultHeight = 600;
  const defaultX = Math.max(0, window.innerWidth - defaultWidth - 20);
  const defaultY = 20;

  let { x, y, width, height } = state.windowState || {};

  // Validate loaded state (force defaults if missing or at 0,0 which is suspicious for first run)
  if (!width || width < 200) width = defaultWidth;
  if (!height || height < 200) height = defaultHeight;
  if (x === undefined || (x === 0 && y === 0)) x = defaultX;
  if (y === undefined || (x === defaultX && y === 0)) y = defaultY;

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
}

// Logic for Template Clicks
async function handleTemplateClick(root, promptTemplate, modelOverride) {
  const resultArea = root.getElementById('resultArea');
  const resultContent = root.getElementById('resultContent');
  const loading = root.getElementById('loading');

  // Reset state
  resultContent.innerHTML = '';
  root.getElementById('copyActions').classList.add('hidden');
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

async function toggleFloatingWindow() {
  if (!floatingWindow) {
    try {
      await createFloatingWindow();
      isVisible = true;
    } catch (err) {
      console.error('[Ask Web] Error creating floating window:', err);
    }
  } else {
    if (!document.body.contains(floatingWindow)) {
      document.body.appendChild(floatingWindow);
    }

    if (isVisible) {
      hideFloatingWindow();
    } else {
      isVisible = true;
      floatingWindow.style.display = 'block';
    }
  }
}

function hideFloatingWindow() {
  if (!floatingWindow) return;
  saveWindowState();
  isVisible = false;
  floatingWindow.style.display = 'none';
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
  chrome.storage.local.set({ windowState: state });
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
