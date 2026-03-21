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
  SELECTION_PROMPT: 'selection_prompt',
  SELECTION_ICON_TRIGGER_MODE: 'selection_icon_trigger_mode'
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
  { id: 'gpt-5.1', name: 'GPT-5.1' },
  { id: 'gpt-4.1', name: 'GPT-4.1' }
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
  return result[StorageKeys.MODEL] || 'gpt-4.1-mini';
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
    StorageKeys.SELECTION_PROMPT,
    StorageKeys.SELECTION_ICON_TRIGGER_MODE
  ];
  const result = await getStorage(keys);
  return {
    enabled: result[StorageKeys.ENABLE_SELECTION_ICON] !== false, // Default true? Or false. Let's default to false as it might be annoying. User said "toggle to enable", implies off by default? Or "toggle to enable" just means a toggle exists. Let's default to true for discoverability, or false for safety. I'll default to TRUE so the user sees the feature they asked for immediately.
    model: result[StorageKeys.SELECTION_MODEL] || '',
    prompt: result[StorageKeys.SELECTION_PROMPT] || 'Translate and explain the following text:\n\n{{selection}}',
    triggerMode: result[StorageKeys.SELECTION_ICON_TRIGGER_MODE] || 'click'
  };
}

async function setSelectionConfig(config) {
  const data = {};
  if (config.enabled !== undefined) data[StorageKeys.ENABLE_SELECTION_ICON] = config.enabled;
  if (config.model !== undefined) data[StorageKeys.SELECTION_MODEL] = config.model;
  if (config.prompt !== undefined) data[StorageKeys.SELECTION_PROMPT] = config.prompt;
  if (config.triggerMode !== undefined) data[StorageKeys.SELECTION_ICON_TRIGGER_MODE] = config.triggerMode;
  await setStorage(data);
}

// ─── Semantic content extraction ────────────────────────────────────────────

/**
 * Resolve the semantic text value of a single element that may be a status
 * image/icon (checkmark, cross, warning, etc.) instead of real text.
 * Returns null when the element is not a recognisable status indicator so the
 * caller falls through to normal text extraction.
 */
function resolveStatusImage(el) {
  // ── Confluence emoticons ────────────────────────────────────────────────
  // <img class="emoticon emoticon-tick" data-emoticon-name="tick" alt="(tick)">
  const emoticon = el.dataset && el.dataset.emoticonName;
  if (emoticon) {
    const EMOTICON_MAP = {
      tick: '✓', cross: '✗',
      'thumbs-up': '👍', 'thumbs-down': '👎',
      'warning': '⚠', information: 'ℹ',
      plus: '+', minus: '−',
      smile: '😊', sad: '😞', laugh: '😄', wink: '😉', cheeky: '😛',
      'light-on': '💡', 'light-off': '💡(off)',
      'yellow-star': '★', 'red-star': '★', 'green-star': '★', 'blue-star': '★',
      heart: '❤', 'broken-heart': '💔',
      question: '?',
    };
    // data-emoticon-name uses both dash and underscore variants across versions
    const key = emoticon.toLowerCase().replace(/_/g, '-');
    if (EMOTICON_MAP[key]) return EMOTICON_MAP[key];
  }

  // ── Confluence Status macro lozenge ────────────────────────────────────
  // Renders as: <span class="status-macro aui-lozenge aui-lozenge-success">On track</span>
  // or <span data-macro-name="status" ...>
  if (el.tagName !== 'IMG') {
    const cls = (el.getAttribute('class') || '').toLowerCase();
    const macroName = el.dataset && el.dataset.macroName;
    if (macroName === 'status' || cls.includes('status-macro') || cls.includes('aui-lozenge')) {
      const text = (el.textContent || '').trim();
      if (text) {
        // Colour hint from class
        if (cls.includes('success') || cls.includes('green')) return `[${text}✓]`;
        if (cls.includes('error') || cls.includes('red')) return `[${text}✗]`;
        if (cls.includes('warning') || cls.includes('yellow')) return `[${text}⚠]`;
        return `[${text}]`;
      }
    }
    return null; // non-img elements without status class → normal extraction
  }

  // ── Generic <img> resolution ────────────────────────────────────────────
  const alt = (el.alt || '').trim();
  const src = (el.src || el.getAttribute('src') || '').toLowerCase();
  const ariaLabel = (el.getAttribute('aria-label') || '').trim();
  const title = (el.title || '').trim();
  const cls = (el.getAttribute('class') || '').toLowerCase();

  // Prefer explicit aria-label / title when meaningful
  const label = ariaLabel || title || alt;

  // Normalise known positive/negative keywords → symbols
  const STATUS_POSITIVE = /^(\(tick\)|yes|true|supported|available|check|enabled|done|success|complete|✓|✔|☑)$/i;
  const STATUS_NEGATIVE = /^(\(cross\)|no|false|unsupported|unavailable|disabled|✗|✘|☒|none|not supported|not available)$/i;
  const STATUS_WARNING  = /^(\(warning\)|warning|partial|limited|⚠|△)$/i;
  const STATUS_INFO     = /^(\(info\)|info|information|note|ℹ)$/i;

  if (STATUS_POSITIVE.test(label)) return '✓';
  if (STATUS_NEGATIVE.test(label)) return '✗';
  if (STATUS_WARNING.test(label))  return '⚠';
  if (STATUS_INFO.test(label))     return 'ℹ';

  // CSS class hints (emoticon-tick, icon-check, fa-check-circle, …)
  if (/emoticon-tick|icon-tick|icon-check|fa-check|check-mark|icon-yes/.test(cls)) return '✓';
  if (/emoticon-cross|icon-cross|icon-times|fa-times|icon-no|icon-x\b/.test(cls)) return '✗';
  if (/icon-warning|fa-warning|fa-exclamation/.test(cls)) return '⚠';

  // Image src path hints
  if (/[/_-](tick|check|yes|success|enabled|available|done|correct|complete|supported)[._/-]/.test(src)) return '✓';
  if (/emoticons\/check/.test(src)) return '✓';
  if (/[/_-](cross|no|false|disabled|unavailable|unsupported|wrong|error|fail|x)[._/-]/.test(src)) return '✗';
  if (/emoticons\/cross/.test(src)) return '✗';
  if (/[/_-](warning|warn|caution)[._/-]/.test(src)) return '⚠';

  // Fall back to alt text if present (captures "(tick)", "(cross)" etc.)
  if (alt) return alt;

  return null; // unrecognised image — will be skipped by innerText anyway
}

/**
 * Convert a <table> element into a Markdown table string.
 * Each cell is extracted with full semantic awareness (status images, etc.).
 */
function tableToMarkdown(table) {
  const rows = Array.from(table.querySelectorAll(':scope > * > tr, :scope > tr'));
  if (!rows.length) return table.innerText.trim();

  const grid = rows.map(row =>
    Array.from(row.querySelectorAll('td, th')).map(cell => {
      const text = extractElementText(cell).replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
      return text || ' ';
    })
  );

  if (!grid.length || !grid[0].length) return table.innerText.trim();

  // Determine column count (handle ragged rows)
  const colCount = Math.max(...grid.map(r => r.length));

  const pad = row => {
    while (row.length < colCount) row.push(' ');
    return row;
  };

  const lines = [];
  grid.forEach((row, i) => {
    lines.push('| ' + pad(row).join(' | ') + ' |');
    // Insert separator after the first row (header)
    if (i === 0) lines.push('| ' + Array(colCount).fill('---').join(' | ') + ' |');
  });

  return lines.join('\n');
}

/**
 * Extract meaningful text from a DOM element with semantic enhancements:
 *  - Tables are converted to Markdown table syntax.
 *  - Status images (Confluence emoticons, generic check/cross icons) are
 *    resolved to Unicode symbols instead of being silently dropped.
 *  - aria-label and title attributes are used as fallbacks for images.
 */
function extractElementText(element) {
  // Walk child nodes and build a text representation
  function walk(node) {
    // Text node
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toUpperCase();

    // Skip invisible or decorative elements
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(tag)) return '';

    // Table: reconstruct as Markdown
    if (tag === 'TABLE') return '\n\n' + tableToMarkdown(node) + '\n\n';

    // Table structural elements handled inside tableToMarkdown — skip at top level
    if (['THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH'].includes(tag)) {
      return Array.from(node.childNodes).map(walk).join('');
    }

    // Images: attempt status resolution first
    if (tag === 'IMG') {
      const status = resolveStatusImage(node);
      return status !== null ? status : '';
    }

    // Non-img elements: check for Confluence Status macro / lozenge
    const statusText = resolveStatusImage(node);
    if (statusText !== null) return statusText;

    // Block-level elements: add newlines for readability
    const BLOCK = ['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE',
                   'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
                   'UL', 'OL', 'LI', 'DL', 'DT', 'DD',
                   'FIGURE', 'FIGCAPTION', 'HEADER', 'FOOTER', 'ASIDE'];
    const isBlock = BLOCK.includes(tag);

    const inner = Array.from(node.childNodes).map(walk).join('');
    return isBlock ? '\n' + inner + '\n' : inner;
  }

  const raw = walk(element);
  // Normalise excessive blank lines while preserving intentional double-breaks
  return raw.replace(/\n{3,}/g, '\n\n').trim();
}

// Text processing
function truncateContent(content, maxTokens = 50000) {
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
