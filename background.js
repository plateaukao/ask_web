// Background service worker for API calls
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL,
  STORAGE_KEYS,
  normalizeApiBaseUrl,
  isOfficialOpenAiUrl,
  migrateLegacyApiConfig
} from './shared.js';

// Get storage value helper
async function getStorageValue(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key]);
    });
  });
}

async function getMaxTokens() {
  const val = parseInt(await getStorageValue(STORAGE_KEYS.MAX_TOKENS), 10);
  return val > 0 ? val : DEFAULT_MAX_TOKENS;
}

// ─── API configuration sets ──────────────────────────────────────────────
// Mirrors the config helpers in utils.js — keep in sync.

async function getApiConfigs() {
  let configs = await getStorageValue(STORAGE_KEYS.API_CONFIGS);
  if (!Array.isArray(configs) || configs.length === 0) {
    const legacy = await new Promise((resolve) => {
      chrome.storage.local.get(
        [STORAGE_KEYS.API_KEY, STORAGE_KEYS.API_BASE_URL, STORAGE_KEYS.MODEL],
        resolve
      );
    });
    configs = [migrateLegacyApiConfig(legacy)];
    await chrome.storage.local.set({
      [STORAGE_KEYS.API_CONFIGS]: configs,
      [STORAGE_KEYS.ACTIVE_API_CONFIG]: configs[0].id
    });
  }
  return configs;
}

// Resolve a config by id, falling back to the active config, then the first.
async function resolveApiConfig(configId) {
  const configs = await getApiConfigs();
  const activeId = await getStorageValue(STORAGE_KEYS.ACTIVE_API_CONFIG);
  return configs.find(c => c.id === configId)
    || configs.find(c => c.id === activeId)
    || configs[0];
}

// Only the official OpenAI endpoint hard-requires a key; local/self-hosted
// servers (especially Ollama) commonly run without one.
function missingApiKeyError(config) {
  if (!config.apiKey && isOfficialOpenAiUrl(config.apiBaseUrl)) {
    return `Please set the API key for "${config.name}" in the extension settings`;
  }
  return null;
}

function buildHeaders(config) {
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;
  return headers;
}

function apiEndpointFor(config, path = '') {
  const base = normalizeApiBaseUrl(config.apiBaseUrl);
  if (!path) return base;
  // For Ollama, use native /api/chat instead of /v1/chat/completions
  if (config.isOllama && path === 'chat/completions') {
    const origin = base.replace(/\/v1\/?$/, '');
    return `${origin}/api/chat`;
  }
  const normalizedPath = '/' + path.replace(/^\/+/, '');
  return `${base}${normalizedPath}`;
}

// State tracking
let popupState = {
  isStreaming: false,
  content: '',
  tabId: null
};

// Context menu for text selection
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ask-web-selection',
    title: 'Ask Web about "%s"',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'ask-web-selection' && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'contextMenuSelection',
      selectionText: info.selectionText
    });
  }
});

// Handle extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  try {
    // Send message to content script to toggle window
    await chrome.tabs.sendMessage(tab.id, { action: 'toggleFloatingWindow' });
  } catch (error) {
    console.warn('Content script not ready or error toggling window:', error);
    // Optional: Inject content script if missing (basic fallback)
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['marked.min.js', 'utils.js', 'content.js']
    });
  }
});

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getPopupState') {
    sendResponse(popupState);
    return true;
  }

  if (request.action === 'summarize') {
    handleSummarize(request)
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === 'chat') {
    handleChat(request)
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === 'openOptions') {
    // Use tabs.create rather than openOptionsPage(): on Arc (and other
    // tab-archiving browsers) openOptionsPage tries to focus a previously
    // opened options tab that has been archived/hidden, so nothing appears.
    // Creating a fresh tab always shows a visible settings page.
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    return true;
  }

  if (request.action === 'openMindmapTab') {
    chrome.storage.session.set({ mindmapContent: request.content }).then(() => {
      chrome.tabs.create({ url: 'mindmap.html' });
    });
    return true;
  }

  if (request.action === 'openChat') {
    // Store page data for chat page to retrieve
    chrome.storage.session.set({ currentPageData: request.pageData });
    // Open chat in new tab
    chrome.tabs.create({ url: 'chat.html' });
    sendResponse({ success: true });
    return true;
  }

  // For streaming to chat page
  if (request.action === 'startStream') {
    handleStreamRequest(request, sender);
    sendResponse({ started: true });
    return true;
  }

  // For streaming to popup/content script
  if (request.action === 'startPopupStream') {
    handlePopupStreamRequest(request, sender);
    sendResponse({ started: true });
    return true;
  }
});

async function handleSummarize(request) {
  const config = await resolveApiConfig(request.configId);
  const keyError = missingApiKeyError(config);
  if (keyError) {
    throw new Error(keyError);
  }

  const model = request.model || config.model || DEFAULT_MODEL;

  const messages = [
    {
      role: 'system',
      content: 'You are a helpful assistant that summarizes web content clearly and concisely. Use markdown formatting for better readability.'
    },
    {
      role: 'user',
      content: request.prompt
    }
  ];

  const maxTokens = await getMaxTokens();
  // For popup, we'll do non-streaming for simplicity but can be changed
  const body = prepareRequestBody(model, {
    messages: messages,
    temperature: 0.7,
    max_tokens: maxTokens,
    stream: false
  }, config);

  const endpoint = apiEndpointFor(config, 'chat/completions');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    let errorMsg = `API request failed (${response.status}) - ${endpoint}`;
    try {
      const error = await response.json();
      errorMsg = error.error?.message || errorMsg;
    } catch (e) {
      // Response body is not valid JSON
    }
    throw new Error(errorMsg);
  }

  const data = await response.json();
  // Ollama native: data.message.content, OpenAI: data.choices[0].message.content
  const content = data.message?.content || data.choices?.[0]?.message?.content;
  return { result: content };
}

async function handleChat(request) {
  const config = await resolveApiConfig(request.configId);
  const keyError = missingApiKeyError(config);
  if (keyError) {
    throw new Error(keyError);
  }

  const model = request.model || config.model || DEFAULT_MODEL;

  const maxTokens = await getMaxTokens();
  const body = prepareRequestBody(model, {
    messages: request.messages,
    temperature: 0.7,
    max_tokens: maxTokens,
    stream: false
  }, config);

  const endpoint = apiEndpointFor(config, 'chat/completions');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    let errorMsg = `API request failed (${response.status}) - ${endpoint}`;
    try {
      const error = await response.json();
      errorMsg = error.error?.message || errorMsg;
    } catch (e) {
      // Response body is not valid JSON
    }
    throw new Error(errorMsg);
  }

  const data = await response.json();
  const content = data.message?.content || data.choices?.[0]?.message?.content;
  return { result: content };
}

// Streaming handler for chat page
async function handleStreamRequest(request, sender) {
  const config = await resolveApiConfig(request.configId);
  const keyError = missingApiKeyError(config);
  if (keyError) {
    chrome.tabs.sendMessage(sender.tab.id, {
      action: 'streamError',
      error: keyError
    });
    return;
  }

  const model = request.model || config.model || DEFAULT_MODEL;

  try {
    const maxTokens = await getMaxTokens();
    const body = prepareRequestBody(model, {
      messages: request.messages,
      temperature: 0.7,
      max_tokens: maxTokens,
      stream: true
    }, config);

    const endpoint = apiEndpointFor(config, 'chat/completions');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      let errorMsg = `API request failed (${response.status}) - ${endpoint}`;
      try {
        const error = await response.json();
        errorMsg = error.error?.message || errorMsg;
      } catch (e) {
        // Response body is not valid JSON (e.g. HTML error page)
      }
      chrome.tabs.sendMessage(sender.tab.id, {
        action: 'streamError',
        error: errorMsg
      });
      return;
    }

    const ollama = !!config.isOllama;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const chunk = parseStreamChunk(line, ollama);
        if (chunk.error) {
          chrome.tabs.sendMessage(sender.tab.id, { action: 'streamError', error: chunk.error });
          return;
        }
        if (chunk.done) {
          chrome.tabs.sendMessage(sender.tab.id, { action: 'streamEnd' });
          return;
        }
        if (chunk.content) {
          chrome.tabs.sendMessage(sender.tab.id, { action: 'streamChunk', content: chunk.content });
        }
      }
    }

    chrome.tabs.sendMessage(sender.tab.id, { action: 'streamEnd' });
  } catch (error) {
    chrome.tabs.sendMessage(sender.tab.id, {
      action: 'streamError',
      error: error.message
    });
  }
}

// Streaming handler for popup
async function handlePopupStreamRequest(request, sender) { // Added sender
  const config = await resolveApiConfig(request.configId);
  const keyError = missingApiKeyError(config);
  if (keyError) {
    if (sender?.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, {
        action: 'popupStreamError',
        error: keyError
      });
    } else {
      chrome.runtime.sendMessage({
        action: 'popupStreamError',
        error: keyError
      });
    }
    return;
  }

  // Determine target: sender tab (content script) or runtime (popup)
  const targetTabId = sender?.tab?.id;

  // Reset state
  popupState = {
    isStreaming: true,
    content: '',
    tabId: targetTabId || null
  };

  const model = request.model || config.model || DEFAULT_MODEL;

  try {
    const maxTokens = await getMaxTokens();
    const body = prepareRequestBody(model, {
      messages: request.messages,
      temperature: 0.7,
      max_tokens: maxTokens,
      stream: true
    }, config);

    const endpoint = apiEndpointFor(config, 'chat/completions');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      let errorMsg = `API request failed (${response.status}) - ${endpoint}`;
      try {
        const error = await response.json();
        errorMsg = error.error?.message || errorMsg;
      } catch (e) {
        // Response body is not valid JSON (e.g. HTML error page)
      }
      popupState.isStreaming = false;

      if (targetTabId) {
        chrome.tabs.sendMessage(targetTabId, { action: 'popupStreamError', error: errorMsg });
      } else {
        chrome.runtime.sendMessage({ action: 'popupStreamError', error: errorMsg });
      }
      return;
    }

    const ollama = !!config.isOllama;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const chunk = parseStreamChunk(line, ollama);
        if (chunk.error) {
          popupState.isStreaming = false;
          const msg = { action: 'popupStreamError', error: chunk.error };
          if (targetTabId) {
            chrome.tabs.sendMessage(targetTabId, msg);
          } else {
            chrome.runtime.sendMessage(msg);
          }
          return;
        }
        if (chunk.done) {
          popupState.isStreaming = false;
          const msg = { action: 'popupStreamEnd' };
          if (targetTabId) {
            chrome.tabs.sendMessage(targetTabId, msg);
          } else {
            chrome.runtime.sendMessage(msg);
          }
          return;
        }
        if (chunk.content) {
          popupState.content += chunk.content;
          const msg = { action: 'popupStreamChunk', content: chunk.content };
          if (targetTabId) {
            chrome.tabs.sendMessage(targetTabId, msg);
          } else {
            chrome.runtime.sendMessage(msg);
          }
        }
      }
    }

    popupState.isStreaming = false;
    if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, { action: 'popupStreamEnd' });
    } else {
      chrome.runtime.sendMessage({ action: 'popupStreamEnd' });
    }
  } catch (error) {
    popupState.isStreaming = false;
    const errorMsg = error.message;
    if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, { action: 'popupStreamError', error: errorMsg });
    } else {
      chrome.runtime.sendMessage({ action: 'popupStreamError', error: errorMsg });
    }
  }
}
// Parse a streaming chunk and extract content, handling both OpenAI SSE and Ollama NDJSON formats
function parseStreamChunk(line, isOllama) {
  if (isOllama) {
    const trimmed = line.trim();
    if (!trimmed) return { content: null, done: false };
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.error) return { content: null, done: false, error: parsed.error };
      if (parsed.done) return { content: parsed.message?.content || null, done: true };
      return { content: parsed.message?.content || null, done: false };
    } catch (e) {
      console.warn('[Ask Web] Failed to parse Ollama streaming chunk:', trimmed, e.message);
      return { content: null, done: false };
    }
  } else {
    if (!line.startsWith('data: ')) return { content: null, done: false };
    const data = line.slice(6);
    if (data === '[DONE]') return { content: null, done: true };
    try {
      const parsed = JSON.parse(data);
      return { content: parsed.choices?.[0]?.delta?.content || null, done: false };
    } catch (e) {
      console.warn('[Ask Web] Failed to parse streaming chunk:', data, e.message);
      return { content: null, done: false };
    }
  }
}

// Helper to handle model-specific parameters (e.g., o1/o3 reasoning models)
function prepareRequestBody(model, baseParams, config) {
  // Check if it's a reasoning model (o1, o3, etc.)
  const isReasoningModel =
    model.startsWith('o1-') ||
    model.startsWith('o3-') ||
    model.includes('reasoning') ||
    model.includes('5'); // User mentioned 5.2-pro

  const body = { ...baseParams, model };

  if (isReasoningModel) {
    if (body.max_tokens) {
      body.max_completion_tokens = body.max_tokens;
      delete body.max_tokens;
    }
    // Reasoning models usually don't support temperature
    delete body.temperature;
  }

  if (config.isOllama) {
    // Ollama native API: thinking is a simple on/off toggle
    body.think = !!config.thinking;
  } else {
    // OpenAI-style endpoints: per-config reasoning effort ('none' = don't
    // send the parameter). The official OpenAI API rejects reasoning_effort
    // on non-reasoning models, so only attach it there when the model
    // supports it; other OpenAI-compatible servers ignore unknown fields.
    const effort = config.reasoningEffort;
    if (effort && effort !== 'none' &&
        (!isOfficialOpenAiUrl(config.apiBaseUrl) || isReasoningModel)) {
      body.reasoning_effort = effort;
    }
  }

  return body;
}
