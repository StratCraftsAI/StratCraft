/**
 * Credential Key Constants
 *
 * TICKET_1023_6: Single source of truth for all credential key strings used
 * across the codebase. Every file that references a credential storage key
 * (e.g. 'alpaca.apiKeyId', 'llm.claude.apiKey') MUST import from here
 * instead of hardcoding the string.
 *
 * Organized by domain:
 *   - DATA_CREDENTIAL_KEYS: BYOK data-provider credential keys
 *   - LLM_CREDENTIAL_KEYS: BYOK LLM provider API key / URL keys
 *   - LLM_CONFIG_KEYS: LLM plugin config storage keys (not credentials,
 *     but config keys stored via plugin.setConfig)
 */

// =============================================================================
// Data Provider Credential Keys
// =============================================================================

export const DATA_CREDENTIAL_KEYS = {
  // Alpaca Markets (composite: keyId + secretKey)
  ALPACA_API_KEY_ID: 'alpaca.apiKeyId',
  ALPACA_API_SECRET_KEY: 'alpaca.apiSecretKey',

  // Alpha Vantage (single key)
  ALPHA_VANTAGE_API_KEY: 'alphaVantage.apiKey',

  // Polygon.io (single key)
  POLYGON_API_KEY: 'polygon.apiKey',

  // Tushare Pro (single token)
  TUSHARE_API_TOKEN: 'tushare.apiToken',

  // FRED (Federal Reserve Economic Data)
  FRED_API_KEY: 'fred.apiKey',

  // Marketaux (news sentiment)
  MARKETAUX_API_KEY: 'marketaux.apiKey',
} as const;

export type DataCredentialKey = typeof DATA_CREDENTIAL_KEYS[keyof typeof DATA_CREDENTIAL_KEYS];

// =============================================================================
// LLM Provider Credential Keys
// =============================================================================

export const LLM_CREDENTIAL_KEYS = {
  CLAUDE_API_KEY: 'llm.claude.apiKey',
  OPENAI_API_KEY: 'llm.openai.apiKey',
  GEMINI_API_KEY: 'llm.gemini.apiKey',
  DEEPSEEK_API_KEY: 'llm.deepseek.apiKey',
  GROK_API_KEY: 'llm.grok.apiKey',
  QWEN_API_KEY: 'llm.qwen.apiKey',
  LINO_API_KEY: 'llm.lino.apiKey',
  OLLAMA_BASE_URL: 'llm.ollama.baseUrl',
  // TICKET_1266: OpenAI-protocol-compatible relay/proxy. The API key is the
  // provider's `secretKey` (the "configured" gate); the base URL is a second
  // required credential resolved separately by the model fetcher, validator,
  // and agent loop.
  OPENAI_COMPATIBLE_API_KEY: 'llm.openaiCompatible.apiKey',
  OPENAI_COMPATIBLE_BASE_URL: 'llm.openaiCompatible.baseUrl',
} as const;

export type LlmCredentialKey = typeof LLM_CREDENTIAL_KEYS[keyof typeof LLM_CREDENTIAL_KEYS];

// =============================================================================
// LLM Plugin Config Keys
// =============================================================================

/**
 * Keys used with `plugin.setConfig` / `plugin.getConfig` for LLM selection
 * state. These are NOT credential keys (they are not encrypted), but they
 * are hardcoded strings that appear in many files and benefit from
 * centralization.
 */
export const LLM_CONFIG_KEYS = {
  SELECTED_PROVIDER: 'llm.selectedProvider',
  SELECTED_MODEL: 'llm.selectedModel',
  /**
   * TICKET_1266_1: the Pro catalog provider id that owns SELECTED_MODEL when
   * SELECTED_PROVIDER is PRO_CATALOG. Model ids are NOT unique across the Pro
   * catalog (TICKET_1266 relay curation reuses other providers' exact ids), so
   * the provider dimension must be persisted, not derived from the model id.
   */
  SELECTED_PRO_PROVIDER: 'llm.selectedProProvider',
  PRO_USER_MODELS: 'llm.pro.userModels',
  /** TICKET_1266: user-curated LinoAPI models exposed in the BYOK picker. */
  LINO_USER_MODELS: 'llm.lino.userModels',
  /** Prefix for validation status flags: `llm.validated.<provider>` */
  VALIDATION_STATUS_PREFIX: 'llm.validated.',
} as const;
