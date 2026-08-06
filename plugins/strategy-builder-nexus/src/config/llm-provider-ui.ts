/**
 * LLM Provider UI Configuration
 *
 * TICKET_646 Phase 7: Minimal UI-only provider metadata. Model lists are
 * served dynamically by `useLLMCatalog()` (TICKET_646 Phase 3/4); this file
 * contains only static BYOK setup fields (placeholder, pattern, docsUrl),
 * constants, and types needed by plugin UI components.
 *
 * Replaces the deleted `llm-providers.ts` which contained hardcoded model
 * arrays. That data now comes from the LLM catalog IPC channel.
 *
 * @see TICKET_646 - LLM Provider Model Registry Redesign
 * @see TICKET_089 - LLM Selector Component
 * @see TICKET_090 - LLM API Key Management
 */

import {
  LLM_CREDENTIAL_KEYS,
  LLM_SIGNUP_URL_CLAUDE,
  LLM_SIGNUP_URL_DEEPSEEK,
  LLM_SIGNUP_URL_GEMINI,
  LLM_SIGNUP_URL_GROK,
  LLM_SIGNUP_URL_OLLAMA,
  LLM_SIGNUP_URL_OPENAI,
  LLM_SIGNUP_URL_QWEN,
  LLM_SIGNUP_URL_LINO,
} from '@StratCraft/types';

// =============================================================================
// Types
// =============================================================================

/** TICKET_483: Pro catalog marketplace model entry */
export interface ProMarketplaceModel {
  id: string;
  name: string;
  category: string;
}

/** BYOK provider UI metadata (no model arrays -- those come from the catalog). */
export interface BYOKProviderUIConfig {
  id: string;
  name: string;
  secretKey: string;
  apiKeyPlaceholder: string;
  /** Serialized pattern string -- consumers compile via `new RegExp()`. */
  apiKeyPattern?: string;
  docsUrl?: string;
}

// =============================================================================
// Constants
// =============================================================================

/** Default provider (always available, no API key required) */
export const DEFAULT_PROVIDER_ID = 'PRO_CATALOG';

/** Default model (empty until user selects from catalog / marketplace) */
export const DEFAULT_MODEL_ID = '';

/** Max user-added models for Pro Marketplace */
export const PRO_USER_MODELS_MAX = 20;

// =============================================================================
// BYOK Provider UI Metadata
// =============================================================================

/**
 * Static UI metadata for BYOK providers. Keyed by provider ID.
 * Contains only fields needed for API key setup UI -- no model arrays.
 */
export const BYOK_PROVIDER_UI: Record<string, BYOKProviderUIConfig> = {
  CLAUDE: {
    id: 'CLAUDE',
    name: 'Claude (Anthropic)',
    secretKey: LLM_CREDENTIAL_KEYS.CLAUDE_API_KEY,
    apiKeyPlaceholder: 'sk-ant-...',
    apiKeyPattern: '^sk-ant-',
    docsUrl: LLM_SIGNUP_URL_CLAUDE,
  },
  OPENAI: {
    id: 'OPENAI',
    name: 'OpenAI',
    secretKey: LLM_CREDENTIAL_KEYS.OPENAI_API_KEY,
    apiKeyPlaceholder: 'sk-...',
    apiKeyPattern: '^sk-',
    docsUrl: LLM_SIGNUP_URL_OPENAI,
  },
  GEMINI: {
    id: 'GEMINI',
    name: 'Google Gemini',
    secretKey: LLM_CREDENTIAL_KEYS.GEMINI_API_KEY,
    apiKeyPlaceholder: 'AIza...',
    apiKeyPattern: '^AIza',
    docsUrl: LLM_SIGNUP_URL_GEMINI,
  },
  DEEPSEEK: {
    id: 'DEEPSEEK',
    name: 'DeepSeek',
    secretKey: LLM_CREDENTIAL_KEYS.DEEPSEEK_API_KEY,
    apiKeyPlaceholder: 'sk-...',
    docsUrl: LLM_SIGNUP_URL_DEEPSEEK,
  },
  GROK: {
    id: 'GROK',
    name: 'xAI Grok',
    secretKey: LLM_CREDENTIAL_KEYS.GROK_API_KEY,
    apiKeyPlaceholder: 'xai-...',
    apiKeyPattern: '^xai-',
    docsUrl: LLM_SIGNUP_URL_GROK,
  },
  QWEN: {
    id: 'QWEN',
    name: 'Alibaba Qwen',
    secretKey: LLM_CREDENTIAL_KEYS.QWEN_API_KEY,
    apiKeyPlaceholder: 'sk-...',
    docsUrl: LLM_SIGNUP_URL_QWEN,
  },
  LINO: {
    id: 'LINO',
    name: 'LinoAPI',
    secretKey: LLM_CREDENTIAL_KEYS.LINO_API_KEY,
    apiKeyPlaceholder: 'your-lino-api-key',
    docsUrl: LLM_SIGNUP_URL_LINO,
  },
  OLLAMA: {
    id: 'OLLAMA',
    name: 'Ollama (Local)',
    secretKey: LLM_CREDENTIAL_KEYS.OLLAMA_BASE_URL,
    apiKeyPlaceholder: 'http://localhost:11434',
    apiKeyPattern: '^https?://.+',
    docsUrl: LLM_SIGNUP_URL_OLLAMA,
  },
  // TICKET_1266: user-supplied OpenAI-compatible relay/proxy. The base URL is a
  // second credential handled by the host credential contribution
  // (llm-contributions.ts); here only the primary API-key field is described,
  // used by the Builder model picker's provider ordering.
  OPENAI_COMPATIBLE: {
    id: 'OPENAI_COMPATIBLE',
    name: 'OpenAI Compatible',
    secretKey: LLM_CREDENTIAL_KEYS.OPENAI_COMPATIBLE_API_KEY,
    apiKeyPlaceholder: 'sk-...',
  },
};

/**
 * Ordered list of all BYOK provider configs (for iteration in UI).
 * Excludes PRO_CATALOG which has no API key setup.
 */
export const BYOK_PROVIDERS_LIST: BYOKProviderUIConfig[] = [
  BYOK_PROVIDER_UI.CLAUDE,
  BYOK_PROVIDER_UI.OPENAI,
  BYOK_PROVIDER_UI.GEMINI,
  BYOK_PROVIDER_UI.DEEPSEEK,
  BYOK_PROVIDER_UI.GROK,
  BYOK_PROVIDER_UI.QWEN,
  BYOK_PROVIDER_UI.LINO,
  BYOK_PROVIDER_UI.OLLAMA,
  BYOK_PROVIDER_UI.OPENAI_COMPATIBLE,
];

/**
 * All provider IDs (PRO_CATALOG + BYOK). Used where a full list is needed.
 */
export const ALL_PROVIDER_IDS = ['PRO_CATALOG', ...BYOK_PROVIDERS_LIST.map(p => p.id)];

/**
 * Look up BYOK UI config by secretKey (for SecretsTab matching).
 */
export function findProviderBySecretKey(secretKey: string): BYOKProviderUIConfig | undefined {
  return BYOK_PROVIDERS_LIST.find(p => p.secretKey === secretKey);
}

/**
 * Get provider display name by ID. Returns the ID itself for unknown providers.
 */
export function getProviderName(providerId: string): string {
  if (providerId === 'PRO_CATALOG') return 'Pro';
  return BYOK_PROVIDER_UI[providerId]?.name ?? providerId;
}
