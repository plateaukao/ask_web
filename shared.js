// Shared constants and helpers used by both background.js (imported as module)
// and utils.js (duplicated for content script compatibility since content scripts
// cannot use ES module imports).
//
// If you update anything here, also update the corresponding code in utils.js.

export const DEFAULT_API_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_MAX_TOKENS = 100000;
export const DEFAULT_MODEL = 'gpt-5.2-pro';
export const DEFAULT_MODEL_IDS = ['gpt-5.2-pro', 'gpt-5.1', 'gpt-4.1'];

export const STORAGE_KEYS = {
  API_KEY: 'openai_api_key',
  MODEL: 'openai_model',
  API_BASE_URL: 'openai_api_base_url',
  MAX_TOKENS: 'max_tokens',
  API_CONFIGS: 'api_configs',
  ACTIVE_API_CONFIG: 'active_api_config_id'
};

export function normalizeApiBaseUrl(url) {
  const trimmed = (url || '').trim();
  const base = trimmed || DEFAULT_API_BASE_URL;
  return base.replace(/\/+$/, '');
}

// Heuristic: Ollama's default port is 11434. Stored as an explicit flag on
// each API config so users can override the guess for remote Ollama hosts.
export function detectOllamaUrl(url) {
  const u = (url || '').toLowerCase();
  return u.includes('11434') || /(^|[.\/-])ollama([.:\/-]|$)/.test(u);
}

// True only for the official OpenAI API host. Any other endpoint is treated as
// a third-party / self-hosted OpenAI-compatible server (llama.cpp, vLLM,
// LM Studio, etc.).
export function isOfficialOpenAiUrl(url) {
  try {
    return new URL(url || DEFAULT_API_BASE_URL).hostname === 'api.openai.com';
  } catch (e) {
    return false;
  }
}

// Build an API configuration set from the legacy single-endpoint settings
// (openai_api_key / openai_api_base_url / openai_model) so existing users
// keep working after the multi-config upgrade.
export function migrateLegacyApiConfig(legacy) {
  const apiBaseUrl = normalizeApiBaseUrl(legacy[STORAGE_KEYS.API_BASE_URL]);
  const isOllama = detectOllamaUrl(apiBaseUrl);
  const official = isOfficialOpenAiUrl(apiBaseUrl);
  const model = (legacy[STORAGE_KEYS.MODEL] || '').trim() || DEFAULT_MODEL;
  return {
    id: 'cfg_default',
    name: isOllama ? 'Ollama' : (official ? 'OpenAI' : 'Custom'),
    apiBaseUrl,
    apiKey: legacy[STORAGE_KEYS.API_KEY] || '',
    models: official ? [...new Set([model, ...DEFAULT_MODEL_IDS])] : [model],
    model,
    isOllama,
    // Preserve pre-config behavior: official OpenAI sent no reasoning_effort,
    // other OpenAI-compatible endpoints were capped to 'low'.
    reasoningEffort: official || isOllama ? 'none' : 'low',
    thinking: false
  };
}
