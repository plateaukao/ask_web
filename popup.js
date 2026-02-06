// Popup JavaScript

let pageData = null;
let templates = [];

// DOM Elements
const pageTitleEl = document.getElementById('pageTitle');
const pageUrlEl = document.getElementById('pageUrl');
const templateSelect = document.getElementById('templateSelect');
const summarizeBtn = document.getElementById('summarizeBtn');
const chatBtn = document.getElementById('chatBtn');
const settingsBtn = document.getElementById('settingsBtn');
const resultArea = document.getElementById('resultArea');
const resultContent = document.getElementById('resultContent');
const copyBtn = document.getElementById('copyBtn');
const loadingEl = document.getElementById('loading');
const errorArea = document.getElementById('errorArea');
const errorMessage = document.getElementById('errorMessage');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadTemplates();
  await extractPageContent();
  setupEventListeners();
});

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
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      showError('No active tab found');
      return;
    }

    // Update page info immediately
    pageTitleEl.textContent = tab.title || 'Untitled Page';
    pageUrlEl.textContent = tab.url || '';

    // Inject and execute content script to extract content
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractContent
    });

    if (results && results[0] && results[0].result) {
      pageData = results[0].result;
      pageTitleEl.textContent = pageData.title || tab.title || 'Untitled Page';
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
    pageTitleEl.textContent = pageData.title;
    pageUrlEl.textContent = pageData.url;
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

  // Summarize button
  summarizeBtn.addEventListener('click', handleSummarize);

  // Chat button
  chatBtn.addEventListener('click', handleChat);

  // Copy button
  copyBtn.addEventListener('click', handleCopy);
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

  // Show loading
  showLoading();

  try {
    // Process template with content
    const content = truncateContent(pageData.content);
    const prompt = processTemplate(template.prompt, content);

    // Send to background for API call
    const response = await chrome.runtime.sendMessage({
      action: 'summarize',
      prompt: prompt
    });

    if (response.error) {
      throw new Error(response.error);
    }

    showResult(response.result);
  } catch (error) {
    showError(error.message);
  }
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
  const text = resultContent.textContent;
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

function showLoading() {
  hideAll();
  loadingEl.classList.remove('hidden');
  summarizeBtn.disabled = true;
  chatBtn.disabled = true;
}

function showResult(text) {
  hideAll();
  resultContent.textContent = text;
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
