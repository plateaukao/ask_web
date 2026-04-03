// Shared constants and helpers used by both background.js (imported as module)
// and utils.js (duplicated for content script compatibility since content scripts
// cannot use ES module imports).
//
// If you update anything here, also update the corresponding code in utils.js.

export const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_MAX_TOKENS = 100000;
export const DEFAULT_MODEL = 'gpt-5.2-pro';

export const STORAGE_KEYS = {
  API_KEY: 'openai_api_key',
  MODEL: 'openai_model',
  API_BASE_URL: 'openai_api_base_url',
  MAX_TOKENS: 'max_tokens'
};

export function normalizeApiBaseUrl(url) {
  const trimmed = (url || '').trim();
  const base = trimmed || DEFAULT_API_BASE_URL;
  return base.replace(/\/+$/, '');
}
