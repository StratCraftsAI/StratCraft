/**
 * TICKET_1023_8: closed, additive-only set of LLM provider identifiers.
 *
 * Mirrors the data-provider-id.ts pattern (TICKET_1023_3) for LLM providers.
 * The frontend uses UPPERCASE IDs (CLAUDE, OPENAI, etc.) internally; the
 * backend expects lowercase (mapped by toApiProvider in llm-providers.ts).
 *
 * PRO_CATALOG is the platform-hosted catalog provider (renamed from NONA
 * in TICKET_696). NONA is kept as a legacy constant for migration paths.
 */

export const LLM_PROVIDER_IDS = [
  'CLAUDE',
  'OPENAI',
  'GEMINI',
  'DEEPSEEK',
  'GROK',
  'QWEN',
  'LINO',
  'OLLAMA',
  // TICKET_1266: any OpenAI-protocol-compatible endpoint with a user-supplied
  // base URL (LinoAPI, OpenRouter, Azure OpenAI, corporate proxies, ...).
  'OPENAI_COMPATIBLE',
  'PRO_CATALOG',
  'NONA',
] as const;

export type LlmProviderId = typeof LLM_PROVIDER_IDS[number];

/**
 * Named constants for every LLM provider id.
 * Use these instead of raw string literals (TICKET_179).
 */
export const LLM_PROVIDER_CLAUDE:      LlmProviderId = 'CLAUDE';
export const LLM_PROVIDER_OPENAI:      LlmProviderId = 'OPENAI';
export const LLM_PROVIDER_GEMINI:      LlmProviderId = 'GEMINI';
export const LLM_PROVIDER_DEEPSEEK:    LlmProviderId = 'DEEPSEEK';
export const LLM_PROVIDER_GROK:        LlmProviderId = 'GROK';
export const LLM_PROVIDER_QWEN:        LlmProviderId = 'QWEN';
export const LLM_PROVIDER_LINO:        LlmProviderId = 'LINO';
export const LLM_PROVIDER_OLLAMA:      LlmProviderId = 'OLLAMA';
export const LLM_PROVIDER_OPENAI_COMPATIBLE: LlmProviderId = 'OPENAI_COMPATIBLE';
export const LLM_PROVIDER_PRO_CATALOG: LlmProviderId = 'PRO_CATALOG';
export const LLM_PROVIDER_NONA:        LlmProviderId = 'NONA';

/**
 * Lowercase credential-registration IDs used by llm-contributions.ts.
 * These map 1:1 with the uppercase IDs but match the credential registry
 * namespace convention (lowercase provider slug).
 */
export const LLM_CONTRIB_CLAUDE   = 'claude'   as const;
export const LLM_CONTRIB_OPENAI   = 'openai'   as const;
export const LLM_CONTRIB_GEMINI   = 'gemini'   as const;
export const LLM_CONTRIB_DEEPSEEK = 'deepseek' as const;
export const LLM_CONTRIB_GROK     = 'grok'     as const;
export const LLM_CONTRIB_QWEN     = 'qwen'     as const;
export const LLM_CONTRIB_LINO     = 'lino'     as const;
export const LLM_CONTRIB_OLLAMA   = 'ollama'   as const;
export const LLM_CONTRIB_OPENAI_COMPATIBLE = 'openaiCompatible' as const;

export function isLlmProviderId(value: unknown): value is LlmProviderId {
  return typeof value === 'string'
    && (LLM_PROVIDER_IDS as readonly string[]).includes(value);
}
