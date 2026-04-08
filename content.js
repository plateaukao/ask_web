// Content script for Ask Web
var floatingWindow = floatingWindow || null;
var shadowRoot = shadowRoot || null;
var isVisible = typeof isVisible !== 'undefined' ? isVisible : false;
var isSelectionWindow = typeof isSelectionWindow !== 'undefined' ? isSelectionWindow : false;
var miniFloatingBtn = miniFloatingBtn || null;

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
    } else if (request.action === 'contextMenuSelection') {
      handleContextMenuSelection(request.selectionText);
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

    // Load Styles from external CSS file
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('floating.css');
    shadowRoot.appendChild(link);

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
        <span id="processingIcon" class="processing-icon hidden" aria-label="Processing">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="12" cy="12" r="5"></circle>
          </svg>
        </span>
      </div>
      <div class="controls">
        <button id="minimizeBtn" class="btn-icon" title="Minimize to floating button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="4 14 10 14 10 20"/>
            <polyline points="20 10 14 10 14 4"/>
            <line x1="10" y1="14" x2="3" y2="21"/>
            <line x1="21" y1="3" x2="14" y2="10"/>
          </svg>
        </button>
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
async function handleTemplateClick(root, promptTemplate, modelOverride, historyMetadata = null) {
  const resultArea = root.getElementById('resultArea');
  const resultContent = root.getElementById('resultContent');
  const loading = root.getElementById('loading');
  const processingIcon = root.getElementById('processingIcon');

  // Reset state
  resultContent.innerHTML = '';
  root.getElementById('copyActions').classList.add('hidden');
  root.getElementById('mindmapContainer').classList.add('hidden');
  resultContent.classList.remove('hidden');
  currentStreamContent = '';
  currentHistoryMetadata = historyMetadata;

  resultArea.classList.add('hidden');
  loading.classList.remove('hidden');
  if (processingIcon) processingIcon.classList.remove('hidden');

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
    resultContent.innerHTML = '<span class="cursor-blink"><svg viewBox="0 0 24 24" fill="#fff" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-4 4v-4a2 2 0 0 1-2-2z"></path><path d="M8 8h8"></path><path d="M8 11h6"></path></svg></span>';

  } catch (err) {
    loading.classList.add('hidden');
    if (processingIcon) processingIcon.classList.add('hidden');
    resultContent.textContent = 'Error: ' + err.message;
    resultArea.classList.remove('hidden');
  }
}

// Shortcut Support
async function registerShortcuts() {
  // Listen for storage changes to update shortcuts in real-time if settings change
  let templates = await getTemplates();
  let floatingShortcut = await getFloatingShortcut();
  let chatShortcut = await getChatShortcut();

  chrome.storage.onChanged.addListener((changes) => {
    if (changes[StorageKeys.TEMPLATES]) {
      templates = changes[StorageKeys.TEMPLATES].newValue;
    }
    if (changes[StorageKeys.FLOATING_SHORTCUT]) {
      floatingShortcut = changes[StorageKeys.FLOATING_SHORTCUT].newValue;
    }
    if (changes[StorageKeys.CHAT_SHORTCUT]) {
      chatShortcut = changes[StorageKeys.CHAT_SHORTCUT].newValue;
    }
  });

  const handleKeydown = (e) => {
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

    // Check Global Chat Shortcut
    if (chatShortcut) {
      const parts = chatShortcut.split('+');
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
        handleChatClick();
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
  };

  // Capture phase makes Esc reliable even if page handlers stop propagation later.
  window.addEventListener('keydown', handleKeydown, true);
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
  // If mini button is showing, hide it before toggling the main window
  if (miniFloatingBtn) miniFloatingBtn.style.display = 'none';

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

function minimizeFloatingWindow() {
  if (!floatingWindow) return;

  // Capture position before hiding
  const rect = floatingWindow.getBoundingClientRect();
  saveWindowState();
  isVisible = false;
  floatingWindow.style.display = 'none';

  const btnSize = 48;

  if (!miniFloatingBtn) {
    miniFloatingBtn = document.createElement('div');
    miniFloatingBtn.id = 'ask-web-mini-btn';
    miniFloatingBtn.style.cssText =
      'position:fixed;z-index:2147483647;width:48px;height:48px;border-radius:50%;' +
      'background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);display:flex;' +
      'align-items:center;justify-content:center;cursor:pointer;' +
      'box-shadow:0 4px 20px rgba(102,126,234,0.5);user-select:none;pointer-events:auto;' +
      'transition:transform 0.15s,box-shadow 0.15s;';
    miniFloatingBtn.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="white" stroke="none">' +
      '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    miniFloatingBtn.addEventListener('mouseenter', () => {
      miniFloatingBtn.style.transform = 'scale(1.1)';
      miniFloatingBtn.style.boxShadow = '0 6px 25px rgba(102,126,234,0.7)';
    });
    miniFloatingBtn.addEventListener('mouseleave', () => {
      miniFloatingBtn.style.transform = '';
      miniFloatingBtn.style.boxShadow = '0 4px 20px rgba(102,126,234,0.5)';
    });
    document.body.appendChild(miniFloatingBtn);
    setupMiniBtnDrag(miniFloatingBtn, restoreFloatingWindow);
  }

  miniFloatingBtn.style.left = `${Math.max(0, Math.min(rect.left, window.innerWidth - btnSize))}px`;
  miniFloatingBtn.style.top = `${Math.max(0, Math.min(rect.top, window.innerHeight - btnSize))}px`;
  miniFloatingBtn.style.display = 'flex';
}

async function restoreFloatingWindow() {
  if (!floatingWindow) return;
  if (miniFloatingBtn) miniFloatingBtn.style.display = 'none';
  isVisible = true;
  floatingWindow.style.display = 'block';
  await loadLatestContent(shadowRoot);
}

function setupMiniBtnDrag(btn, onClickCallback) {
  let hasMoved = false;
  let startX, startY, startLeft, startTop;

  function onMouseMove(e) {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
    const btnSize = 48;
    btn.style.left = `${Math.max(0, Math.min(startLeft + dx, window.innerWidth - btnSize))}px`;
    btn.style.top = `${Math.max(0, Math.min(startTop + dy, window.innerHeight - btnSize))}px`;
  }

  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  btn.addEventListener('mousedown', (e) => {
    hasMoved = false;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = parseInt(btn.style.left) || 0;
    startTop = parseInt(btn.style.top) || 0;
    e.preventDefault();
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  btn.addEventListener('click', () => {
    if (!hasMoved) onClickCallback();
    hasMoved = false;
  });
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
      const processingIcon = root.getElementById('processingIcon');
      if (processingIcon) processingIcon.classList.add('hidden');

      const resultContent = root.getElementById('resultContent');
      if (resultContent) {
        resultContent.innerHTML += `<br><span style="color:red">Error: ${request.error}</span>`;
      }
    }
  });

  root.getElementById('closeBtn').addEventListener('click', hideFloatingWindow);
  root.getElementById('minimizeBtn').addEventListener('click', minimizeFloatingWindow);

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
  const processingIcon = root.getElementById('processingIcon');
  if (processingIcon) processingIcon.classList.add('hidden');

  // Clean up cursor
  const resultContent = root.getElementById('resultContent');
  const cursor = resultContent.querySelector('.cursor-blink');
  if (cursor) cursor.remove();

  // Save to history
  if (currentStreamContent) {
    await saveContentHistory(currentStreamContent, currentHistoryMetadata);
    currentHistoryMetadata = null;
    renderCopyButtons(root);
  }
}

// History Functions
function getHistoryKey() {
  return `history_${window.location.href}`;
}

async function saveContentHistory(content, metadata = null) {
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
  if (metadata && metadata.type === 'selection') {
    entry.selectionMeta = metadata;
  }

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
            <div class="history-preview">${formatHistoryGeneratedLine(item)}</div>
            <div class="history-meta">${formatHistoryMetaLine(item, date)}</div>
        `;

    div.addEventListener('click', () => {
      restoreHistoryItem(root, item);
    });

    container.appendChild(div);
  });
}

function escapeHtml(text) {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatHistoryPreview(item) {
  if (item.selectionMeta && item.selectionMeta.selectedText) {
    const selected = escapeHtml(item.selectionMeta.selectedText);
    const context = escapeHtml(item.selectionMeta.context || '');
    return `<strong>${selected}</strong>${context ? ` — ${context}` : ''}`;
  }
  return escapeHtml(item.summary || '');
}

function formatHistoryMetaLine(item, date) {
  if (item.selectionMeta && item.selectionMeta.selectedText) {
    return `<span class="history-meta-text">${formatHistoryPreview(item)}</span><span class="history-meta-time">${escapeHtml(date)}</span>`;
  }
  return `<span class="history-meta-text"></span><span class="history-meta-time">${escapeHtml(date)}</span>`;
}

function formatHistoryGeneratedLine(item) {
  return escapeHtml(item.summary || '');
}

function buildHistoryDisplayContent(item) {
  if (item.selectionMeta && item.selectionMeta.selectedText) {
    const selected = item.selectionMeta.selectedText || '';
    const context = item.selectionMeta.context || '';
    let contextWithSelection = context;
    if (contextWithSelection && contextWithSelection.includes(selected)) {
      contextWithSelection = contextWithSelection.replace(selected, `**${selected}**`);
    } else if (contextWithSelection) {
      contextWithSelection = `${contextWithSelection} **${selected}**`;
    } else {
      contextWithSelection = `**${selected}**`;
    }
    return `${contextWithSelection}\n\n---\n\n${item.content}`;
  }
  return item.content;
}

function restoreHistoryItem(root, item) {
  const resultArea = root.getElementById('resultArea');
  const resultContent = root.getElementById('resultContent');
  const historyList = root.getElementById('historyList');

  const displayContent = buildHistoryDisplayContent(item);

  try {
    if (typeof marked !== 'undefined') {
      resultContent.innerHTML = marked.parse(displayContent);
    } else {
      resultContent.textContent = displayContent;
    }
  } catch (e) {
    resultContent.textContent = displayContent;
  }

  currentStreamContent = displayContent;
  renderCopyButtons(root);

  historyList.classList.add('hidden');
  resultArea.classList.remove('hidden');
}

// Stream Helpers
var currentStreamContent = '';
var currentHistoryMetadata = null;

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
  const cursorHtml = showCursor ? '<span class="cursor-blink"><svg viewBox="0 0 24 24" fill="#fff" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-4 4v-4a2 2 0 0 1-2-2z"></path><path d="M8 8h8"></path><path d="M8 11h6"></path></svg></span>' : '';

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
    const isDark = floatingWindow.getAttribute('data-theme') !== 'light';
    const mm = markmap.Markmap.create(mindmapSvg, {
      autoFit: true,
      initialExpandLevel: 3,
      style: (id) => `#${id} { --markmap-text-color: ${isDark ? '#e2e8f0' : '#333'}; --markmap-circle-open-bg: #fff; }`,
    }, mmRoot);

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
    return { title: document.title, url: window.location.href, content: extractElementText(article) };
  }

  // 3. Try main tag
  const main = document.querySelector('main');
  if (main) {
    return { title: document.title, url: window.location.href, content: extractElementText(main) };
  }

  // 4. Try extracting content from same-origin iframes (e.g. Naver blogs)
  const iframes = document.querySelectorAll('iframe');
  for (const iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) continue;

      const iframeArticle = iframeDoc.querySelector('article');
      if (iframeArticle && iframeArticle.innerText.trim().length > 200) {
        return { title: document.title, url: window.location.href, content: extractElementText(iframeArticle) };
      }

      const iframeMain = iframeDoc.querySelector('main');
      if (iframeMain && iframeMain.innerText.trim().length > 200) {
        return { title: document.title, url: window.location.href, content: extractElementText(iframeMain) };
      }

      const iframeBody = iframeDoc.body;
      if (iframeBody) {
        const clone = iframeBody.cloneNode(true);
        clone.querySelectorAll('script, style, nav, header, footer, noscript').forEach(el => el.remove());
        const text = extractElementText(clone).trim();
        if (text.length > 200) {
          return { title: document.title, url: window.location.href, content: text };
        }
      }
    } catch (e) {
      // Cross-origin iframe — skip silently
    }
  }

  // 5. Fallback to body but try to exclude nav, header, footer if possible
  // Clone body to manipulate
  const bodyClone = document.body.cloneNode(true);
  const scripts = bodyClone.querySelectorAll('script, style, nav, header, footer, noscript');
  scripts.forEach(el => el.remove());

  return { title: document.title, url: window.location.href, content: extractElementText(bodyClone) };
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
    if (changes[StorageKeys.TEMPLATES]) {
      // Recreate icon to pick up showInSelection changes
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
  // Recreate each time to pick up template changes
  if (selectionIcon) {
    selectionIcon.remove();
    selectionIcon = null;
    selectionIconShadow = null;
  }
  await createSelectionIcon();

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
    .selection-container {
      display: flex;
      align-items: stretch;
      background: #fff;
      border: 2px solid #000;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }
    .icon {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      flex-shrink: 0;
    }
    .icon:hover {
      background: #f0f0f0;
    }
    .icon svg {
      color: #000;
      width: 18px;
      height: 18px;
    }
    .action-menu {
      display: none;
      flex-direction: row;
      align-items: stretch;
      max-width: 0;
      overflow: hidden;
      transition: max-width 0.2s ease;
    }
    .selection-container:hover .action-menu,
    .selection-container.expanded .action-menu {
      display: flex;
      max-width: 600px;
    }
    .action-menu .divider {
      width: 1px;
      background: #ddd;
      flex-shrink: 0;
    }
    .action-btn {
      display: flex;
      align-items: center;
      padding: 0 10px;
      white-space: nowrap;
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #333;
      cursor: pointer;
      border: none;
      background: transparent;
      height: 32px;
      transition: background 0.15s;
    }
    .action-btn:hover {
      background: #e8e8e8;
    }
    .action-btn.default-action {
      font-weight: 600;
    }
  `;

  const container = document.createElement('div');
  container.className = 'selection-container';

  const icon = document.createElement('div');
  icon.className = 'icon';
  icon.innerHTML = `
    <svg viewBox="0 0 24 24" fill="#fff" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-4 4v-4a2 2 0 0 1-2-2z"></path>
      <path d="M8 8h8"></path>
      <path d="M8 11h6"></path>
    </svg>
  `;

  const actionMenu = document.createElement('div');
  actionMenu.className = 'action-menu';

  container.appendChild(icon);
  container.appendChild(actionMenu);

  // Load templates with showInSelection
  const templates = await getTemplates();
  const selectionTemplates = templates.filter(t => t.showInSelection);

  if (selectionTemplates.length > 0) {
    // Add default action button first
    const divider = document.createElement('div');
    divider.className = 'divider';
    actionMenu.appendChild(divider);

    const defaultBtn = document.createElement('button');
    defaultBtn.className = 'action-btn default-action';
    defaultBtn.textContent = 'Default';
    defaultBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleSelectionIconClick();
    });
    actionMenu.appendChild(defaultBtn);

    // Add each selection template as an action button
    selectionTemplates.forEach(tmpl => {
      const sep = document.createElement('div');
      sep.className = 'divider';
      actionMenu.appendChild(sep);

      const btn = document.createElement('button');
      btn.className = 'action-btn';
      btn.textContent = tmpl.name;
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleSelectionIconClick({ prompt: tmpl.prompt, model: tmpl.model });
      });
      actionMenu.appendChild(btn);
    });

    // Main icon click triggers default action (when no menu templates)
    icon.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleSelectionIconClick();
    });
  } else {
    // No selection templates — original behavior: icon triggers action directly
    if (triggerMode === 'hover') {
      icon.addEventListener('mouseenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleSelectionIconClick();
      });
    } else {
      icon.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleSelectionIconClick();
      });
    }
  }

  selectionIconShadow.appendChild(style);
  selectionIconShadow.appendChild(container);

  document.body.appendChild(selectionIcon);
}

async function handleSelectionIconClick(templateOverride) {
  hideSelectionIcon(); // Hide immediately for better UX

  // Clear previous result immediately so stale content isn't visible
  if (shadowRoot) {
    const resultContent = shadowRoot.getElementById('resultContent');
    if (resultContent) resultContent.innerHTML = '';
    const resultArea = shadowRoot.getElementById('resultArea');
    if (resultArea) resultArea.classList.add('hidden');
    currentStreamContent = '';
  }

  const config = await getSelectionConfig();
  const selectionText = currentSelection.text;

  // Get Context
  const context = getSelectionContext(currentSelection.range);
  const historyMetadata = buildSelectionHistoryMetadata(selectionText, context);

  // Use template override prompt/model if provided, otherwise use default selection config
  let prompt = (templateOverride && templateOverride.prompt) ? templateOverride.prompt : config.prompt;
  const model = (templateOverride && templateOverride.model) ? templateOverride.model : config.model;

  const actionContext = buildSelectionContextForAction(selectionText, context);

  prompt = prompt.replace(/{{selection}}/g, selectionText);
  prompt = prompt.replace(/{{content}}/g, actionContext);

  const finalPrompt = `Context: ${actionContext}\n\n${prompt}`;

  // Open Floating Window with half height for selection actions
  if (!isVisible) {
    await toggleFloatingWindow(true, currentSelection.range);
  }

  // Wait for window to be ready
  const maxWait = 20;
  let waited = 0;
  const timer = setInterval(() => {
    if (shadowRoot || waited > maxWait) {
      clearInterval(timer);
      if (shadowRoot) {
        handleTemplateClick(shadowRoot, finalPrompt, model, historyMetadata);
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

function buildSelectionHistoryMetadata(selectionText, context) {
  const normalize = (text) => (text || '').replace(/\s+/g, ' ').trim();
  const selected = normalize(selectionText).slice(0, 200);
  const before = normalize(context.before);
  const after = normalize(context.after);
  const beforeSentences = (before.match(/[^.!?]+[.!?]?/g) || []).map(s => s.trim()).filter(Boolean);
  const afterSentences = (after.match(/[^.!?]+[.!?]?/g) || []).map(s => s.trim()).filter(Boolean);
  const contextParts = [];

  if (beforeSentences.length > 0) {
    contextParts.push(beforeSentences[beforeSentences.length - 1]);
  }
  if (selected) {
    contextParts.push(selected);
  }
  if (afterSentences.length > 0) {
    contextParts.push(afterSentences[0]);
  }

  const fallbackContext = `${before.slice(-100)}${before && selected ? ' ' : ''}${selected}${(before || selected) && after ? ' ' : ''}${after.slice(0, 100)}`.trim();
  const compactContext = (contextParts.join(' ').trim() || fallbackContext).slice(0, 280);

  return {
    type: 'selection',
    selectedText: selected,
    context: compactContext
  };
}

async function handleContextMenuSelection(selectionText) {
  if (!selectionText || selectionText.trim().length < 2) return;

  // Try to capture the live selection range for surrounding context
  const selection = window.getSelection();
  let range = null;
  let context = { before: '', after: '' };

  if (selection && selection.rangeCount > 0) {
    range = selection.getRangeAt(0).cloneRange();
    context = getSelectionContext(range);
  }

  const config = await getSelectionConfig();
  const historyMetadata = buildSelectionHistoryMetadata(selectionText, context);
  const actionContext = buildSelectionContextForAction(selectionText, context);

  let prompt = config.prompt;
  prompt = prompt.replace(/{{selection}}/g, selectionText);
  prompt = prompt.replace(/{{content}}/g, actionContext);
  const finalPrompt = `Context: ${actionContext}\n\n${prompt}`;

  if (!isVisible) {
    await toggleFloatingWindow(true, range);
  }

  const maxWait = 20;
  let waited = 0;
  const timer = setInterval(() => {
    if (shadowRoot || waited > maxWait) {
      clearInterval(timer);
      if (shadowRoot) {
        handleTemplateClick(shadowRoot, finalPrompt, config.model, historyMetadata);
      }
    }
    waited++;
  }, 100);
}

function buildSelectionContextForAction(selectionText, context) {
  const metadata = buildSelectionHistoryMetadata(selectionText, context);
  const selected = metadata.selectedText || '';
  const baseContext = metadata.context || selected;

  if (selected && baseContext.includes(selected)) {
    return baseContext.replace(selected, `[TARGET]${selected}[/TARGET]`);
  }
  if (selected) {
    return `${baseContext}${baseContext ? ' ' : ''}[TARGET]${selected}[/TARGET]`.trim();
  }
  return baseContext;
}
