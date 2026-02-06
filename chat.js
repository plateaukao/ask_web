// Chat page JavaScript

let pageData = null;
let templates = [];
let messages = [];
let isLoading = false;

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

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadPageData();
  setupEventListeners();
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
  // Model change
  modelSelect.addEventListener('change', async () => {
    await setModel(modelSelect.value);
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
    chrome.runtime.openOptionsPage();
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
  messageInput.value = '';
  messageInput.style.height = 'auto';
  sendBtn.disabled = true;

  // Build messages for API
  const systemMessage = buildSystemMessage();
  const apiMessages = [
    { role: 'system', content: systemMessage },
    ...messages.map(m => ({ role: m.role, content: m.content }))
  ];

  // Show typing indicator
  const typingEl = showTypingIndicator();
  isLoading = true;

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'chat',
      messages: apiMessages
    });

    // Remove typing indicator
    typingEl.remove();
    isLoading = false;

    if (response.error) {
      addMessage('assistant', `Error: ${response.error}`);
    } else {
      addMessage('assistant', response.result);
    }
  } catch (error) {
    typingEl.remove();
    isLoading = false;
    addMessage('assistant', `Error: ${error.message}`);
  }
}

function buildSystemMessage() {
  let systemMessage = `You are a helpful assistant that answers questions about web content. Be concise but thorough.`;

  if (pageData && pageData.content) {
    const content = truncateContent(pageData.content, 8000);
    systemMessage += `\n\nHere is the web page content the user is asking about:\n\nTitle: ${pageData.title}\nURL: ${pageData.url}\n\nContent:\n${content}`;
  }

  return systemMessage;
}

function addMessage(role, content) {
  messages.push({ role, content });

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
    <div class="message-content">${formatMessage(content)}</div>
  `;

  messagesContainer.appendChild(messageEl);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function showTypingIndicator() {
  const typingEl = document.createElement('div');
  typingEl.className = 'message assistant';
  typingEl.innerHTML = `
    <div class="message-avatar">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="M16 8l-4 4-4-4"/>
        <path d="M12 12v6"/>
      </svg>
    </div>
    <div class="message-content">
      <div class="typing-indicator">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  `;
  messagesContainer.appendChild(typingEl);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  return typingEl;
}

function formatMessage(content) {
  // Basic markdown-like formatting
  return content
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>');
}
