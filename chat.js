// Chat page JavaScript

let pageData = null;
let templates = [];
let apiConfigs = [];
let messages = [];
let isLoading = false;
let currentStreamContent = '';
let currentStreamElement = null;

// DOM Elements
const contextTitle = document.getElementById('contextTitle');
const contextUrl = document.getElementById('contextUrl');
const contextPreview = document.getElementById('contextPreview');
const modelSelect = document.getElementById('modelSelect');
const templateSelect = document.getElementById('templateSelect');
const applyTemplateBtn = document.getElementById('applyTemplate');
const clearChatBtn = document.getElementById('clearChat');
const openSettingsBtn = document.getElementById('openSettings');
const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const scrollToBottomBtn = document.getElementById('scrollToBottom');

// When true, streaming output keeps the view pinned to the bottom.
// Set to false when the user scrolls up to read earlier content.
let autoScroll = true;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await initTheme();
  initMermaid();
  await loadSettings();
  await loadPageData();
  setupEventListeners();
  setupStreamListener();
});

// Configure Mermaid for on-demand rendering matching the current theme.
// Dark is the default (no data-theme attribute); light sets data-theme="light".
function initMermaid() {
  if (typeof mermaid === 'undefined') return;
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: isLight ? 'default' : 'dark'
  });
}

// Unique, DOM-id-safe suffix for each mermaid render call.
let mermaidRenderSeq = 0;

// Rendered diagram nodes for the CURRENT stream, keyed by diagram source.
// Storing the live <div.mermaid-diagram> element (not an SVG string) lets us
// move the same node back into place after each innerHTML reset instead of
// rebuilding the SVG — which is what was causing the screen to blink. A null
// value marks a source that failed to parse, so we don't retry it every chunk.
// Reset per stream (see resetStreamMermaid) so nodes never jump between
// messages.
const mermaidNodeCache = new Map();

// Sources currently being rendered, so overlapping stream chunks don't kick
// off a duplicate render for the same diagram.
const mermaidPending = new Set();

// True while the diagram source for the open fence is still streaming in — we
// hold the DOM steady (prefix + placeholder) and skip re-renders until it
// closes, so a long script doesn't blink the screen token by token.
let mermaidStreaming = false;

function resetStreamMermaid() {
  mermaidNodeCache.clear();
  mermaidPending.clear();
  mermaidStreaming = false;
}

// Count fully-closed ```mermaid blocks in the text so far. An open
// (still-streaming) fence consumes the rest of the text and is not counted.
function countCompleteMermaidBlocks(text) {
  const matches = text.match(/```mermaid\s*\n[\s\S]*?\n```/g);
  return matches ? matches.length : 0;
}

// True when the text ends inside an unclosed ```mermaid fence: strip every
// complete block, and any ```mermaid left over must be an open one.
function inOpenMermaidFence(text) {
  return text.replace(/```mermaid\s*\n[\s\S]*?\n```/g, '').includes('```mermaid');
}

// Synchronously move already-rendered diagram nodes back into place after an
// innerHTML reset, so finished diagrams never flash back to source. Reusing
// the cached node (rather than re-parsing an SVG string) is what keeps the
// screen stable. Only the first `completeCount` blocks are eligible.
function applyCachedMermaid(container, completeCount) {
  if (!container) return;
  const blocks = container.querySelectorAll('code.language-mermaid');
  for (let i = 0; i < blocks.length && i < completeCount; i++) {
    const node = mermaidNodeCache.get(blocks[i].textContent);
    if (node) {
      const pre = blocks[i].closest('pre');
      if (pre) pre.replaceWith(node);
    }
  }
}

// Render any completed-but-unrendered mermaid blocks, then re-apply to the
// live container (which may have been re-rendered while we awaited). On parse
// failure the source is cached as null and its code block kept.
async function ensureMermaidRendered(container, completeCount) {
  if (typeof mermaid === 'undefined' || !container) return;
  const blocks = container.querySelectorAll('code.language-mermaid');
  for (let i = 0; i < blocks.length && i < completeCount; i++) {
    const source = blocks[i].textContent;
    if (mermaidNodeCache.has(source) || mermaidPending.has(source)) continue;
    mermaidPending.add(source);
    try {
      const { svg } = await mermaid.render(`mermaid-${++mermaidRenderSeq}`, source);
      const wrap = document.createElement('div');
      wrap.className = 'mermaid-diagram';
      wrap.innerHTML = svg;
      mermaidNodeCache.set(source, wrap);
    } catch (e) {
      mermaidNodeCache.set(source, null);
    } finally {
      mermaidPending.delete(source);
    }
    applyCachedMermaid(container, completeCount);
  }
}

// Render the streamed text up to the open fence, then a placeholder for the
// diagram whose source is still arriving. Called once when the fence opens;
// the DOM then stays put until it closes.
function renderStreamPrefixWithPlaceholder(contentDiv) {
  const idx = currentStreamContent.lastIndexOf('```mermaid');
  const prefix = idx >= 0 ? currentStreamContent.slice(0, idx) : currentStreamContent;
  contentDiv.innerHTML = renderMarkdown(prefix) +
    '<div class="mermaid-pending">Generating diagram…</div>';
  const completeCount = countCompleteMermaidBlocks(prefix);
  applyCachedMermaid(contentDiv, completeCount);
  ensureMermaidRendered(contentDiv, completeCount);
}

// Render/refresh all completed diagrams in a container (full markdown already
// in place). Used at stream end and for non-streamed messages.
function renderMermaidBlocks(container) {
  if (!container) return;
  const completeCount = container.querySelectorAll('code.language-mermaid').length;
  applyCachedMermaid(container, completeCount);
  ensureMermaidRendered(container, completeCount);
}

async function loadSettings() {
  // Load models from every API configuration, grouped by configuration name.
  // Option values encode both: "<configId>||<model>".
  apiConfigs = await getApiConfigs();
  const activeId = await getActiveApiConfigId();
  modelSelect.innerHTML = apiConfigs.map(config => {
    const options = (config.models || []).map(m =>
      `<option value="${escapeAttr(config.id + '||' + m)}">${escapeAttr(m)}</option>`
    ).join('');
    return `<optgroup label="${escapeAttr(config.name)}">${options}</optgroup>`;
  }).join('');

  // Restore the last selection if it still exists; otherwise use the active
  // configuration's default model.
  const stored = await getStorage([StorageKeys.CHAT_MODEL_SELECTION]);
  const saved = stored[StorageKeys.CHAT_MODEL_SELECTION];
  const activeConfig = apiConfigs.find(c => c.id === activeId) || apiConfigs[0];
  const fallback = activeConfig.id + '||' + (activeConfig.model || activeConfig.models[0]);
  const savedValue = saved ? saved.configId + '||' + saved.model : '';
  modelSelect.value = [...modelSelect.options].some(o => o.value === savedValue)
    ? savedValue
    : fallback;

  // Load templates
  templates = await getTemplates();
  templateSelect.innerHTML = templates.map(t =>
    `<option value="${t.id}">${t.name}</option>`
  ).join('');
}

function escapeAttr(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/"/g, '&quot;');
}

// The chat's model picker selects both a configuration and a model.
function selectedConfigAndModel() {
  const value = modelSelect.value || '';
  const sep = value.indexOf('||');
  if (sep === -1) return { configId: '', model: '' };
  return { configId: value.slice(0, sep), model: value.slice(sep + 2) };
}

async function loadPageData() {
  // Get page data from session storage
  const result = await chrome.storage.session.get(['currentPageData']);
  pageData = result.currentPageData;

  if (pageData) {
    contextTitle.textContent = pageData.title || 'Unknown Page';
    contextUrl.textContent = pageData.url || '';
    contextPreview.textContent = pageData.content
      ? pageData.content.substring(0, 500) + (pageData.content.length > 500 ? '...' : '')
      : 'No content extracted';
  } else {
    contextTitle.textContent = 'No page loaded';
    contextUrl.textContent = '';
    contextPreview.textContent = 'Open the extension popup on a webpage and click "Chat" to start.';
  }
}

function setupEventListeners() {
  // Persist the chosen configuration + model for the next chat session
  modelSelect.addEventListener('change', async () => {
    const { configId, model } = selectedConfigAndModel();
    if (configId && model) {
      await setStorage({ [StorageKeys.CHAT_MODEL_SELECTION]: { configId, model } });
    }
  });

  // Apply template
  applyTemplateBtn.addEventListener('click', () => {
    const templateId = templateSelect.value;
    const template = templates.find(t => t.id === templateId);
    if (template && pageData) {
      const content = truncateContent(pageData.content);
      const prompt = processTemplate(template.prompt, content);
      messageInput.value = prompt;
      adjustTextareaHeight();
      messageInput.focus();
    }
  });

  // Clear chat
  clearChatBtn.addEventListener('click', () => {
    messages = [];
    messagesContainer.innerHTML = `
      <div class="welcome-message">
        <h2>Chat with this page</h2>
        <p>Ask questions about the content, request summaries, or explore topics in depth.</p>
        <div class="quick-actions">
          <button class="quick-action" data-prompt="Summarize this page in a few sentences.">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            Summarize
          </button>
          <button class="quick-action" data-prompt="What are the key points of this content?">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="8" y1="6" x2="21" y2="6"/>
              <line x1="8" y1="12" x2="21" y2="12"/>
              <line x1="8" y1="18" x2="21" y2="18"/>
              <line x1="3" y1="6" x2="3.01" y2="6"/>
              <line x1="3" y1="12" x2="3.01" y2="12"/>
              <line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
            Key Points
          </button>
          <button class="quick-action" data-prompt="Explain this content in simple terms.">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            Explain Simply
          </button>
        </div>
      </div>
    `;
    setupQuickActions();
  });

  // Open settings
  openSettingsBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openOptions' });
  });

  // Quick actions
  setupQuickActions();

  // Message input
  messageInput.addEventListener('input', () => {
    adjustTextareaHeight();
    sendBtn.disabled = !messageInput.value.trim();
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) {
        sendMessage();
      }
    }
  });

  // Send button
  sendBtn.addEventListener('click', sendMessage);

  // Track whether the user has scrolled away from the bottom
  messagesContainer.addEventListener('scroll', () => {
    autoScroll = isNearBottom();
    updateScrollButton();
  });

  // Jump back to the bottom and resume auto-scrolling
  scrollToBottomBtn.addEventListener('click', () => {
    autoScroll = true;
    scrollToBottom();
    updateScrollButton();
  });
}

// Within a small threshold of the bottom of the messages container
function isNearBottom() {
  const threshold = 40;
  return messagesContainer.scrollHeight - messagesContainer.scrollTop
    - messagesContainer.clientHeight <= threshold;
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Show the button only while loading and scrolled away from the bottom
function updateScrollButton() {
  const show = isLoading && !autoScroll;
  scrollToBottomBtn.classList.toggle('visible', show);
}

// Listen for streaming responses from background
function setupStreamListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'streamChunk') {
      handleStreamChunk(message.content);
    } else if (message.action === 'streamEnd') {
      handleStreamEnd();
    } else if (message.action === 'streamError') {
      handleStreamError(message.error);
    }
  });
}

function handleStreamChunk(content) {
  currentStreamContent += content;
  if (!currentStreamElement) return;
  const contentDiv = currentStreamElement.querySelector('.message-content');
  if (!contentDiv) return;

  if (inOpenMermaidFence(currentStreamContent)) {
    // The diagram's source is still streaming. Render the stable prefix plus a
    // placeholder once, then leave the DOM untouched until the fence closes so
    // the screen doesn't blink token by token while a long script arrives.
    if (!mermaidStreaming) {
      renderStreamPrefixWithPlaceholder(contentDiv);
      mermaidStreaming = true;
      scrollStream();
    }
    return;
  }

  mermaidStreaming = false;
  contentDiv.innerHTML = renderMarkdown(currentStreamContent);
  // Render each diagram as soon as its fence closes, not at stream end.
  const completeCount = countCompleteMermaidBlocks(currentStreamContent);
  applyCachedMermaid(contentDiv, completeCount);
  ensureMermaidRendered(contentDiv, completeCount);
  scrollStream();
}

function scrollStream() {
  if (autoScroll) {
    scrollToBottom();
  } else {
    updateScrollButton();
  }
}

function handleStreamEnd() {
  if (currentStreamContent) {
    messages.push({ role: 'assistant', content: currentStreamContent });
  }
  if (currentStreamElement) {
    addCopyButton(currentStreamElement, currentStreamContent);
    const contentDiv = currentStreamElement.querySelector('.message-content');
    if (contentDiv) {
      // Render the final text in full — the last chunk may have been held back
      // as a placeholder (open fence), and this also catches a fence that
      // closed on the very last chunk.
      contentDiv.innerHTML = renderMarkdown(currentStreamContent);
      renderMermaidBlocks(contentDiv);
    }
  }
  mermaidStreaming = false;
  currentStreamContent = '';
  currentStreamElement = null;
  isLoading = false;
  sendBtn.disabled = false;
  updateScrollButton();
}

function handleStreamError(error) {
  if (currentStreamElement) {
    const contentDiv = currentStreamElement.querySelector('.message-content');
    if (contentDiv) {
      contentDiv.innerHTML = `<span style="color: #ff6b6b;">Error: ${error}</span>`;
    }
  }
  currentStreamContent = '';
  currentStreamElement = null;
  isLoading = false;
  sendBtn.disabled = false;
  updateScrollButton();
}

function setupQuickActions() {
  document.querySelectorAll('.quick-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.dataset.prompt;
      messageInput.value = prompt;
      adjustTextareaHeight();
      sendMessage();
    });
  });
}

function adjustTextareaHeight() {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
}

async function sendMessage() {
  const content = messageInput.value.trim();
  if (!content || isLoading) return;

  // Check for API key on the selected configuration (local servers like
  // Ollama don't need one)
  const { configId, model } = selectedConfigAndModel();
  const config = await resolveApiConfig(configId);
  if (configRequiresApiKey(config)) {
    addMessage('assistant', `Please set the API key for "${config.name}" in the extension settings.`);
    return;
  }

  // Clear welcome message if present
  const welcomeMsg = messagesContainer.querySelector('.welcome-message');
  if (welcomeMsg) {
    welcomeMsg.remove();
  }

  // Add user message
  addMessage('user', content);
  messages.push({ role: 'user', content });
  messageInput.value = '';
  messageInput.style.height = 'auto';
  sendBtn.disabled = true;
  isLoading = true;
  autoScroll = true;
  updateScrollButton();

  // Build messages for API
  const systemMessage = buildSystemMessage();
  const apiMessages = [
    { role: 'system', content: systemMessage },
    ...messages.map(m => ({ role: m.role, content: m.content }))
  ];

  // Create assistant message placeholder for streaming
  currentStreamContent = '';
  resetStreamMermaid();
  currentStreamElement = createStreamingMessage();

  // Start streaming request with the selected configuration + model
  chrome.runtime.sendMessage({
    action: 'startStream',
    messages: apiMessages,
    configId,
    model
  });
}

function buildSystemMessage() {
  let systemMessage = `You are a helpful assistant that answers questions about web content. Use markdown formatting for better readability (headers, lists, bold, code blocks, etc.). Be concise but thorough.

Whenever a diagram would explain something more clearly than prose — architecture, control or data flow, a sequence of events, a timeline, relationships, a decision tree, or a process — supplement your reply with a Mermaid diagram in a fenced \`\`\`mermaid code block. The diagram renders automatically. Keep diagrams focused, write a short sentence of prose alongside them, and use valid Mermaid syntax (flowchart, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, gantt, etc.). Only add a diagram when it genuinely aids understanding — skip it for simple factual answers.`;

  if (pageData && pageData.content) {
    const content = truncateContent(pageData.content, 8000);
    systemMessage += `\n\nHere is the web page content the user is asking about:\n\nTitle: ${pageData.title}\nURL: ${pageData.url}\n\nContent:\n${content}`;
  }

  return systemMessage;
}

function addMessage(role, content) {
  const messageEl = document.createElement('div');
  messageEl.className = `message ${role}`;

  const avatarSvg = role === 'user'
    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
       </svg>`
    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="M16 8l-4 4-4-4"/>
        <path d="M12 12v6"/>
       </svg>`;

  messageEl.innerHTML = `
    <div class="message-avatar">${avatarSvg}</div>
    <div class="message-content">${renderMarkdown(content)}</div>
  `;

  if (role === 'assistant') {
    addCopyButton(messageEl, content);
    renderMermaidStatic(messageEl.querySelector('.message-content'));
  }

  messagesContainer.appendChild(messageEl);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// One-shot render for a finished, non-streamed message. Doesn't use the
// per-stream node cache, so it can't move nodes out of streamed messages.
async function renderMermaidStatic(container) {
  if (typeof mermaid === 'undefined' || !container) return;
  for (const code of container.querySelectorAll('code.language-mermaid')) {
    const pre = code.closest('pre');
    if (!pre) continue;
    try {
      const { svg } = await mermaid.render(`mermaid-${++mermaidRenderSeq}`, code.textContent);
      const wrap = document.createElement('div');
      wrap.className = 'mermaid-diagram';
      wrap.innerHTML = svg;
      pre.replaceWith(wrap);
    } catch (e) {
      // Leave the raw code block in place if the diagram can't be parsed.
    }
  }
}

function createStreamingMessage() {
  const messageEl = document.createElement('div');
  messageEl.className = 'message assistant';
  messageEl.innerHTML = `
    <div class="message-avatar">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="M16 8l-4 4-4-4"/>
        <path d="M12 12v6"/>
      </svg>
    </div>
    <div class="message-content">
      <span class="cursor-blink">▊</span>
    </div>
  `;
  messagesContainer.appendChild(messageEl);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  return messageEl;
}

function addCopyButton(messageEl, rawContent) {
  const btn = document.createElement('button');
  btn.className = 'copy-btn';
  btn.title = 'Copy to clipboard';
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>`;
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(rawContent);
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>`;
      setTimeout(() => {
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>`;
      }, 2000);
    } catch (e) {
      // fallback ignored
    }
  });
  messageEl.appendChild(btn);
}

// Markdown rendering using marked.js (loaded via CDN in HTML)
function renderMarkdown(content) {
  if (typeof marked !== 'undefined') {
    // Configure marked for safe rendering
    marked.setOptions({
      breaks: true,
      gfm: true,
      headerIds: false,
      mangle: false
    });
    return marked.parse(content);
  }
  // Fallback to basic formatting if marked is not loaded
  return content
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>');
}
