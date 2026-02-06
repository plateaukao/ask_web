// Popup JavaScript

let pageData = null;
let templates = [];
let isStreaming = false;
let streamContent = '';
let currentTabId = null;

// DOM Elements
const templateSelect = document.getElementById('templateSelect');
const summarizeBtn = document.getElementById('summarizeBtn');
const chatBtn = document.getElementById('chatBtn');
const settingsBtn = document.getElementById('settingsBtn');
const popoutBtn = document.getElementById('popoutBtn');
const resultArea = document.getElementById('resultArea');
const resultContent = document.getElementById('resultContent');
const copyBtn = document.getElementById('copyBtn');
const loadingEl = document.getElementById('loading');
const errorArea = document.getElementById('errorArea');
const errorMessage = document.getElementById('errorMessage');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await initTheme();
  await loadTemplates();
  await extractPageContent();
  await restoreState();
  setupEventListeners();
  setupStreamListener();
});

async function restoreState() {
  const state = await chrome.runtime.sendMessage({ action: 'getPopupState' });
  if (state && state.content && state.tabId === currentTabId) {
    streamContent = state.content;
    isStreaming = state.isStreaming;

    if (isStreaming) {
      showStreamingResult();
      renderMarkdownResult(streamContent, true);
    } else {
      showResult(streamContent);
    }
  }
}


async function loadTemplates() {
  templates = await getTemplates();
  templateSelect.innerHTML = templates.map(t =>
    `<option value="${t.id}">${t.name}</option>`
  ).join('');

  // Select default template
  const defaultId = await getDefaultTemplateId();
  templateSelect.value = defaultId;
}

async function extractPageContent() {
  try {
    let tab;

    // Check if we are in a popped-out window with a specific tab ID
    const urlParams = new URLSearchParams(window.location.search);
    const tabIdParam = urlParams.get('tabId');

    if (tabIdParam) {
      try {
        tab = await chrome.tabs.get(parseInt(tabIdParam));
      } catch (e) {
        console.warn('Original tab not found');
      }
    }

    // Fallback to active tab in current window
    if (!tab) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = tabs[0];
    }

    if (!tab) {
      showError('No active tab found');
      return;
    }

    currentTabId = tab.id;

    // Inject and execute content script to extract content
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractContent
    });

    if (results && results[0] && results[0].result) {
      pageData = results[0].result;
    } else {
      // Use basic tab info if extraction fails
      pageData = {
        title: tab.title,
        url: tab.url,
        content: '',
        description: ''
      };
    }
  } catch (error) {
    console.error('Error extracting content:', error);
    // Still allow using the extension with limited functionality
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    pageData = {
      title: tab?.title || 'Unknown',
      url: tab?.url || '',
      content: '',
      description: ''
    };
  }
}

// Content extraction function (injected into page)
function extractContent() {
  let content = '';
  let title = document.title || '';
  let url = window.location.href;

  // Try article, main, or common containers
  const selectors = ['article', 'main', '[role="main"]', '.article-content', '.post-content', '.entry-content', '#content', '.content'];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element && element.innerText.length > 200) {
      content = element.innerText;
      break;
    }
  }

  // Fallback to body
  if (!content) {
    const bodyClone = document.body.cloneNode(true);
    ['script', 'style', 'nav', 'header', 'footer', 'aside', '.sidebar', '.navigation', '.menu', '.ad', 'iframe', 'noscript']
      .forEach(sel => bodyClone.querySelectorAll(sel).forEach(el => el.remove()));
    content = bodyClone.innerText;
  }

  content = content.replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();

  const metaDesc = document.querySelector('meta[name="description"]');
  const description = metaDesc ? metaDesc.getAttribute('content') : '';

  return { title, url, content, description };
}

function setupEventListeners() {
  // Settings button
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Pop out button
  popoutBtn.addEventListener('click', () => {
    if (currentTabId) {
      chrome.windows.create({
        url: `popup.html?tabId=${currentTabId}`,
        type: 'popup',
        width: 400,
        height: 600
      });
      window.close(); // Close the current popup
    }
  });

  // Summarize button
  summarizeBtn.addEventListener('click', handleSummarize);

  // Chat button
  chatBtn.addEventListener('click', handleChat);

  // Copy button
  copyBtn.addEventListener('click', handleCopy);
}

// Listen for streaming responses from background
function setupStreamListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'popupStreamChunk') {
      handleStreamChunk(message.content);
    } else if (message.action === 'popupStreamEnd') {
      handleStreamEnd();
    } else if (message.action === 'popupStreamError') {
      handleStreamError(message.error);
    }
  });
}

function handleStreamChunk(content) {
  streamContent += content;
  renderMarkdownResult(streamContent, true);
}

function handleStreamEnd() {
  isStreaming = false;
  summarizeBtn.disabled = false;
  chatBtn.disabled = false;
  // Re-render without cursor
  renderMarkdownResult(streamContent, false);
}

function handleStreamError(error) {
  isStreaming = false;
  showError(error);
  streamContent = '';
}

async function handleSummarize() {
  if (!pageData || !pageData.content) {
    showError('No content found on this page');
    return;
  }

  // Check for API key
  const apiKey = await getApiKey();
  if (!apiKey) {
    showError('Please set your OpenAI API key in settings');
    return;
  }

  // Get selected template
  const templateId = templateSelect.value;
  const template = templates.find(t => t.id === templateId);
  if (!template) {
    showError('Template not found');
    return;
  }

  // Show streaming result area
  showStreamingResult();
  isStreaming = true;
  streamContent = '';

  // Process template with content
  const content = truncateContent(pageData.content);
  const prompt = processTemplate(template.prompt, content);

  // Build messages for streaming API
  const messages = [
    {
      role: 'system',
      content: 'You are a helpful assistant that summarizes web content clearly and concisely. Use markdown formatting for better readability.'
    },
    {
      role: 'user',
      content: prompt
    }
  ];

  // Start streaming request
  chrome.runtime.sendMessage({
    action: 'startPopupStream',
    messages: messages,
    tabId: currentTabId
  });
}

async function handleChat() {
  if (!pageData) {
    showError('No page data available');
    return;
  }

  // Open chat page with current page data
  chrome.runtime.sendMessage({
    action: 'openChat',
    pageData: pageData
  });
}

function handleCopy() {
  const text = resultContent.innerText;
  navigator.clipboard.writeText(text).then(() => {
    copyBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    `;
    setTimeout(() => {
      copyBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      `;
    }, 2000);
  });
}

function showStreamingResult() {
  hideAll();
  resultContent.innerHTML = '<span class="cursor-blink">▊</span>';
  resultArea.classList.remove('hidden');
  summarizeBtn.disabled = true;
  chatBtn.disabled = true;
}

function renderMarkdownResult(text, showCursor = false) {
  const cursorHtml = showCursor ? '<span class="cursor-blink">▊</span>' : '';

  if (typeof marked !== 'undefined') {
    marked.setOptions({
      breaks: true,
      gfm: true,
      headerIds: false,
      mangle: false
    });
    resultContent.innerHTML = marked.parse(text) + cursorHtml;
  } else {
    resultContent.textContent = text;
    if (showCursor) {
      resultContent.innerHTML += cursorHtml;
    }
  }

  // Auto-resize if popped out
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('tabId')) {
    // We are in a popped out window
    const bodyHeight = document.body.scrollHeight;
    const currentHeight = window.outerHeight;
    // Calculate max available height (bottom of screen)
    const maxFreeHeight = screen.availHeight - window.screenY - 20; // 20px buffer
    const desiredHeight = Math.min(bodyHeight + 40, maxFreeHeight); // 40px for window chrome

    if (desiredHeight > currentHeight) {
      window.resizeTo(window.outerWidth, desiredHeight);
    }
  }
}

function showResult(text) {
  hideAll();
  renderMarkdownResult(text, false);
  resultArea.classList.remove('hidden');
  summarizeBtn.disabled = false;
  chatBtn.disabled = false;
}

function showError(message) {
  hideAll();
  errorMessage.textContent = message;
  errorArea.classList.remove('hidden');
  summarizeBtn.disabled = false;
  chatBtn.disabled = false;
}

function hideAll() {
  loadingEl.classList.add('hidden');
  resultArea.classList.add('hidden');
  errorArea.classList.add('hidden');
}
