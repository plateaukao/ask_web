// Storage utility functions
var StorageKeys = StorageKeys || {
  API_KEY: 'openai_api_key',
  MODEL: 'openai_model',
  API_BASE_URL: 'openai_api_base_url',
  TEMPLATES: 'prompt_templates',
  DEFAULT_TEMPLATE: 'default_template',
  THEME: 'theme',
  FLOATING_SHORTCUT: 'floating_shortcut',
  ENABLE_SELECTION_ICON: 'enable_selection_icon',
  SELECTION_MODEL: 'selection_model',
  SELECTION_PROMPT: 'selection_prompt'
};

const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1';

// Theme Helper
async function initTheme() {
  const theme = await getTheme();
  applyTheme(theme);
}

async function getTheme() {
  const result = await getStorage([StorageKeys.THEME]);
  return result[StorageKeys.THEME] || 'dark';
}

async function setTheme(theme) {
  await setStorage({ [StorageKeys.THEME]: theme });
  applyTheme(theme);
}

function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

var DefaultModels = DefaultModels || [
  { id: 'gpt-5.2-pro', name: 'GPT-5.2 Pro (Latest)' },
  { id: 'gpt-5.2', name: 'GPT-5.2' },
  { id: 'gpt-4.1', name: 'GPT-4.1' },
  { id: 'gpt-4o', name: 'GPT-4o' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' }
];

var DefaultTemplates = DefaultTemplates || [
  {
    id: 'summarize',
    name: 'Summarize',
    prompt: 'Please provide a concise summary of the following web content. Focus on the main points and key takeaways:\n\n{{content}}',
    isDefault: true
  },
  {
    id: 'explain',
    name: 'Explain Simply',
    prompt: 'Explain the following web content in simple terms that anyone can understand:\n\n{{content}}',
    isDefault: true
  },
  {
    id: 'key_points',
    name: 'Key Points',
    prompt: 'Extract the key points from the following web content as a bullet list:\n\n{{content}}',
    isDefault: true
  }
];

// Storage helpers
async function getStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

async function setStorage(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, resolve);
  });
}

async function getApiKey() {
  const result = await getStorage([StorageKeys.API_KEY]);
  return result[StorageKeys.API_KEY] || '';
}

async function setApiKey(key) {
  await setStorage({ [StorageKeys.API_KEY]: key });
}

async function getApiBaseUrl() {
  const result = await getStorage([StorageKeys.API_BASE_URL]);
  return normalizeApiBaseUrl(result[StorageKeys.API_BASE_URL]);
}

async function setApiBaseUrl(url) {
  await setStorage({ [StorageKeys.API_BASE_URL]: normalizeApiBaseUrl(url) });
}

function normalizeApiBaseUrl(url) {
  const trimmed = (url || '').trim();
  const base = trimmed || DEFAULT_API_BASE_URL;
  return base.replace(/\/+$/, '');
}

async function getModel() {
  const result = await getStorage([StorageKeys.MODEL]);
  return result[StorageKeys.MODEL] || 'gpt-4o-mini';
}

async function setModel(model) {
  await setStorage({ [StorageKeys.MODEL]: model });
}

async function getTemplates() {
  const result = await getStorage([StorageKeys.TEMPLATES]);
  return result[StorageKeys.TEMPLATES] || [...DefaultTemplates];
}

async function setTemplates(templates) {
  await setStorage({ [StorageKeys.TEMPLATES]: templates });
}

async function getDefaultTemplateId() {
  const result = await getStorage([StorageKeys.DEFAULT_TEMPLATE]);
  return result[StorageKeys.DEFAULT_TEMPLATE] || 'summarize';
}

async function setDefaultTemplateId(id) {
  await setStorage({ [StorageKeys.DEFAULT_TEMPLATE]: id });
}

async function getFloatingShortcut() {
  const result = await getStorage([StorageKeys.FLOATING_SHORTCUT]);
  return result[StorageKeys.FLOATING_SHORTCUT] || '';
}

async function setFloatingShortcut(shortcut) {
  await setStorage({ [StorageKeys.FLOATING_SHORTCUT]: shortcut });
}

// Text Selection Settings
async function getSelectionConfig() {
  const keys = [
    StorageKeys.ENABLE_SELECTION_ICON,
    StorageKeys.SELECTION_MODEL,
    StorageKeys.SELECTION_PROMPT
  ];
  const result = await getStorage(keys);
  return {
    enabled: result[StorageKeys.ENABLE_SELECTION_ICON] !== false, // Default true? Or false. Let's default to false as it might be annoying. User said "toggle to enable", implies off by default? Or "toggle to enable" just means a toggle exists. Let's default to true for discoverability, or false for safety. I'll default to TRUE so the user sees the feature they asked for immediately.
    model: result[StorageKeys.SELECTION_MODEL] || '',
    prompt: result[StorageKeys.SELECTION_PROMPT] || 'Translate and explain the following text:\n\n{{selection}}'
  };
}

async function setSelectionConfig(config) {
  const data = {};
  if (config.enabled !== undefined) data[StorageKeys.ENABLE_SELECTION_ICON] = config.enabled;
  if (config.model !== undefined) data[StorageKeys.SELECTION_MODEL] = config.model;
  if (config.prompt !== undefined) data[StorageKeys.SELECTION_PROMPT] = config.prompt;
  await setStorage(data);
}

// Text processing
function truncateContent(content, maxTokens = 12000) {
  // Rough estimation: 1 token ≈ 4 characters
  const maxChars = maxTokens * 4;
  if (content.length <= maxChars) return content;
  return content.substring(0, maxChars) + '\n\n[Content truncated due to length...]';
}

function processTemplate(template, content) {
  return template.replace('{{content}}', content);
}

// Generate unique ID
function generateId() {
  return 'tmpl_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}
