// Chat page JavaScript

let pageData = null;
let templates = [];
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
  await loadSettings();
  await loadPageData();
  setupEventListeners();
  setupStreamListener();
});

async function loadSettings() {
  // Load model
  const model = await getModel();
  modelSelect.value = model;

  // Load templates
  templates = await getTemplates();
  templateSelect.innerHTML = templates.map(t =>
    `<option value="${t.id}">${t.name}</option>`
  ).join('');
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
  // Model change - now handles input instead of select
  modelSelect.addEventListener('change', async () => {
    await setModel(modelSelect.value);
  });
  modelSelect.addEventListener('blur', async () => {
    if (modelSelect.value.trim()) {
      await setModel(modelSelect.value.trim());
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
  if (currentStreamElement) {
    const contentDiv = currentStreamElement.querySelector('.message-content');
    if (contentDiv) {
      contentDiv.innerHTML = renderMarkdown(currentStreamContent);
      if (autoScroll) {
        scrollToBottom();
      } else {
        updateScrollButton();
      }
    }
  }
}

function handleStreamEnd() {
  if (currentStreamContent) {
    messages.push({ role: 'assistant', content: currentStreamContent });
  }
  if (currentStreamElement) {
    addCopyButton(currentStreamElement, currentStreamContent);
  }
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

  // Check for API key
  const apiKey = await getApiKey();
  if (!apiKey) {
    addMessage('assistant', 'Please set your OpenAI API key in the extension settings.');
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
  currentStreamElement = createStreamingMessage();

  // Start streaming request
  chrome.runtime.sendMessage({
    action: 'startStream',
    messages: apiMessages
  });
}

function buildSystemMessage() {
  let systemMessage = `You are a helpful assistant that answers questions about web content. Use markdown formatting for better readability (headers, lists, bold, code blocks, etc.). Be concise but thorough.`;

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
  }

  messagesContainer.appendChild(messageEl);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
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
