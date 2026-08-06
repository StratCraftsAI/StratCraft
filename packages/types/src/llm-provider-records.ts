/**
 * LLM Provider Records - Centralized data-only provider definitions
 *
 * TICKET_483: Single source of truth for LLM provider model data.
 * TICKET_1276 P0b: relocated from apps/desktop/src/shared/constants so BOTH
 * the Electron main process and the MCP standalone server consume the same
 * records (the MCP-side STANDALONE_PROVIDER_CATALOG copy is deleted).
 * The desktop path re-exports from here, keeping existing import sites.
 *
 * UI-specific fields (apiKeyPlaceholder, apiKeyPattern, docsUrl) remain
 * in the plugin's llm-providers.ts config file.
 */

import { LLM_CREDENTIAL_KEYS } from './credential-keys';
import {
  LLM_PROVIDER_CLAUDE, LLM_PROVIDER_OPENAI, LLM_PROVIDER_GEMINI,
  LLM_PROVIDER_DEEPSEEK, LLM_PROVIDER_GROK, LLM_PROVIDER_QWEN,
  LLM_PROVIDER_OLLAMA, LLM_PROVIDER_LINO, LLM_PROVIDER_OPENAI_COMPATIBLE, LLM_PROVIDER_PRO_CATALOG,
} from './llm-provider-id';
import { getLlmCredentialMeta } from './llm-credential-meta';
import type { LLMCredentialMeta } from './llm-credential-meta';

/** Data-only provider record (no UI-framework fields, but credential metadata is shared) */
export interface LLMProviderRecord {
  id: string;
  name: string;
  defaultModel: string;
  secretKey: string;
  models: Array<{ id: string; name: string }>;
  /** TICKET_1265_7 D2: how this provider is authenticated (shared SSOT) */
  credential: LLMCredentialMeta;
}

/** Resolve the shared credential metadata for a provider id (throws if missing). */
function credentialFor(id: string): LLMCredentialMeta {
  // Reuse the shared case-insensitive lookup (TICKET_854) instead of a raw
  // `LLM_CREDENTIAL_META[id]` index so casing is handled in exactly one place.
  const meta = getLlmCredentialMeta(id);
  if (!meta) {
    throw new Error(`[TICKET_1265_7] No credential metadata for LLM provider '${id}'`);
  }
  return meta;
}

/** TICKET_696: Pro catalog model (backend API response type) */
export interface ProCatalogModel {
  id: string;
  name: string;
  category: string;
  tier?: string;
  /**
   * TICKET_1265_3_1: the backend's per-provider default flag (`is_default`),
   * carried through so BYOK curation can prefer the curated default when
   * computing `recommendedModel`. Absent on entries the backend does not flag.
   */
  isDefault?: boolean;
}

/** TICKET_484: Backend API model entry from /api/llm/providers/models */
export interface BackendProviderModel {
  model_id: string;
  display_name: string;
  tier: string;
  is_default: boolean;
}

/** TICKET_484: Backend API provider entry from /api/llm/providers/models */
export interface BackendProvider {
  provider: string;
  display_name: string;
  models: BackendProviderModel[];
  /**
   * TICKET_1266_1: explicit serving-kind flag. `false` marks a provider whose
   * entry exists ONLY as BYOK curation metadata (e.g. `openai_compatible` --
   * user-supplied relay endpoint, no platform key, TICKET_1266 2.3.2) and must
   * be excluded from every Pro-facing projection. Absent on current backend
   * responses; `isPlatformServedProvider` then derives the answer from the
   * credential SSOT.
   */
  platform_served?: boolean;
}

/** TICKET_484: Backend API response shape */
export interface BackendProviderResponse {
  providers: BackendProvider[];
}

/** TICKET_645: Pro plan available provider (extracted from backend API) */
export interface ProAvailableProvider {
  id: string;
  name: string;
  defaultModel: string;
  models: Array<{ id: string; name: string }>;
}

// =============================================================================
// Provider Records
// =============================================================================

export const LLM_PROVIDER_RECORDS: LLMProviderRecord[] = [
  {
    id: LLM_PROVIDER_CLAUDE,
    name: 'Claude',
    defaultModel: 'claude-4-5-sonnet-latest',
    secretKey: LLM_CREDENTIAL_KEYS.CLAUDE_API_KEY,
    models: [],
    credential: credentialFor(LLM_PROVIDER_CLAUDE),
  },
  {
    id: LLM_PROVIDER_OPENAI,
    name: 'OpenAI',
    defaultModel: 'gpt-5.2',
    secretKey: LLM_CREDENTIAL_KEYS.OPENAI_API_KEY,
    models: [],
    credential: credentialFor(LLM_PROVIDER_OPENAI),
  },
  {
    id: LLM_PROVIDER_GEMINI,
    name: 'Gemini',
    defaultModel: 'gemini-2.5-flash',
    secretKey: LLM_CREDENTIAL_KEYS.GEMINI_API_KEY,
    models: [],
    credential: credentialFor(LLM_PROVIDER_GEMINI),
  },
  {
    id: LLM_PROVIDER_DEEPSEEK,
    name: 'DeepSeek',
    defaultModel: 'deepseek-chat',
    secretKey: LLM_CREDENTIAL_KEYS.DEEPSEEK_API_KEY,
    models: [],
    credential: credentialFor(LLM_PROVIDER_DEEPSEEK),
  },
  {
    id: LLM_PROVIDER_GROK,
    name: 'Grok',
    defaultModel: 'grok-4',
    secretKey: LLM_CREDENTIAL_KEYS.GROK_API_KEY,
    models: [],
    credential: credentialFor(LLM_PROVIDER_GROK),
  },
  {
    id: LLM_PROVIDER_QWEN,
    name: 'Qwen',
    defaultModel: 'qwen3-max',
    secretKey: LLM_CREDENTIAL_KEYS.QWEN_API_KEY,
    models: [],
    credential: credentialFor(LLM_PROVIDER_QWEN),
  },
  {
    id: LLM_PROVIDER_LINO,
    name: 'LinoAPI',
    defaultModel: 'gpt-4o',
    secretKey: LLM_CREDENTIAL_KEYS.LINO_API_KEY,
    models: [],
    credential: credentialFor(LLM_PROVIDER_LINO),
  },
  {
    id: LLM_PROVIDER_OLLAMA,
    name: 'Ollama',
    defaultModel: 'llama3.1:8b',
    secretKey: LLM_CREDENTIAL_KEYS.OLLAMA_BASE_URL,
    models: [],  // dynamically discovered from local Ollama instance
    credential: credentialFor(LLM_PROVIDER_OLLAMA),
  },
  {
    // TICKET_1266: user-supplied OpenAI-protocol-compatible endpoint. `name`
    // MUST match the backend `/api/llm/providers/models` display_name
    // ('OpenAI Compatible') so the dual-layer curation intersection in
    // resolve.ts matches by category. Models are fully dynamic (discovered
    // from the user's endpoint), same as every other BYOK provider.
    id: LLM_PROVIDER_OPENAI_COMPATIBLE,
    name: 'OpenAI Compatible',
    defaultModel: 'gpt-4o',
    secretKey: LLM_CREDENTIAL_KEYS.OPENAI_COMPATIBLE_API_KEY,
    models: [],
    credential: credentialFor(LLM_PROVIDER_OPENAI_COMPATIBLE),
  },
];

// =============================================================================
// Helpers
// =============================================================================

/** Get provider record by ID (case-insensitive on the provider id) */
export function getProviderRecord(id: string): LLMProviderRecord | undefined {
  const upper = id.toUpperCase();
  return LLM_PROVIDER_RECORDS.find(p => p.id.toUpperCase() === upper);
}

/**
 * TICKET_1266_1: is this backend catalog entry a platform-served (Pro) provider,
 * as opposed to BYOK-only curation metadata?
 *
 * The `/api/llm/providers/models` response doubles as the Pro catalog AND the
 * BYOK curation source (TICKET_1266 2.3.2). Pro-facing projections (selector Pro
 * section, `llm-catalog:getModels`) must exclude BYOK-only entries, while the
 * curation projection (`resolve.ts` curated-INTERSECT-discovered) keeps them.
 *
 * Decision order:
 * 1. Explicit backend `platform_served` flag wins when present.
 * 2. Derived from the credential SSOT: a provider whose credential requires a
 *    user-supplied endpoint (primary `kind: 'baseUrl'`, e.g. OLLAMA, or a
 *    required base-URL extra field, e.g. OPENAI_COMPATIBLE) cannot be served by
 *    the platform -- the platform does not have the user's endpoint.
 * 3. Unknown provider id (no credential meta): trust the catalog (platform-served).
 */
export function isPlatformServedProvider(entry: BackendProvider): boolean {
  if (typeof entry.platform_served === 'boolean') {
    return entry.platform_served;
  }
  // TICKET_1266 R2: LinoAPI is a first-class BYOK relay. Its single API-key
  // credential cannot express that distinction, so keep it out of Pro even
  // when an older backend omits the explicit platform_served=false flag.
  if (entry.provider.toUpperCase() === LLM_PROVIDER_LINO) {
    return false;
  }
  const meta = getLlmCredentialMeta(entry.provider);
  if (!meta) {
    return true;
  }
  const needsUserEndpoint =
    meta.kind === 'baseUrl' ||
    (meta.extraFields?.some(f => f.required && f.kind === 'baseUrl') ?? false);
  return !needsUserEndpoint;
}

/** Resolve model display name from all provider records */
export function resolveModelDisplayName(modelId: string): string {
  for (const provider of LLM_PROVIDER_RECORDS) {
    const model = provider.models.find(m => m.id === modelId);
    if (model) return model.name;
  }
  return modelId;
}

// =============================================================================
// Cost-Aware Auto-Selection (TICKET_695)
// =============================================================================

/**
 * TICKET_695: Provider preference order for first-time auto-selection.
 * Ordered cheapest-first so users default to cost-effective models.
 * Only affects first launch (no persisted selection); user choice always wins.
 */
export const COST_PREFERRED_PROVIDER_ORDER: string[] = [
  LLM_PROVIDER_OLLAMA,   // local inference, $0 cost
  LLM_PROVIDER_DEEPSEEK,
  LLM_PROVIDER_GEMINI,
  LLM_PROVIDER_QWEN,
  LLM_PROVIDER_LINO,
  LLM_PROVIDER_GROK,
  LLM_PROVIDER_OPENAI,
  LLM_PROVIDER_CLAUDE,
  LLM_PROVIDER_OPENAI_COMPATIBLE,
];

/**
 * TICKET_695: Cost-preferred model overrides per provider.
 * When a provider has multiple models, prefer the cheaper variant for auto-select.
 * Providers not listed here use their defaultModel from LLM_PROVIDER_RECORDS.
 */
export const COST_PREFERRED_MODEL_OVERRIDES: Record<string, string> = {
  [LLM_PROVIDER_OPENAI]: 'gpt-5-mini',
  [LLM_PROVIDER_LINO]: 'deepseek-chat',
};

/**
 * TICKET_695: Select the most cost-effective configured BYOK provider/model.
 * Used by LLMProviderSelector for first-time auto-selection only.
 *
 * @param configuredProviderIds - Set of provider IDs that have valid API keys
 * @returns provider ID and model ID, or null if no BYOK provider is configured
 */
export function selectCostPreferredProvider(
  configuredProviderIds: Set<string>,
): { providerId: string; modelId: string } | null {
  for (const providerId of COST_PREFERRED_PROVIDER_ORDER) {
    if (!configuredProviderIds.has(providerId)) continue;
    const record = getProviderRecord(providerId);
    if (!record) continue;
    const modelId = COST_PREFERRED_MODEL_OVERRIDES[providerId] || record.defaultModel;
    return { providerId, modelId };
  }
  return null;
}

// =============================================================================
// API Provider Mapping (TICKET_696 fix)
// =============================================================================

/**
 * Map frontend provider ID to backend-compatible provider string.
 *
 * The frontend uses 'PRO_CATALOG' as the provider ID for platform-hosted models
 * (renamed from 'NONA' in TICKET_696). The backend models_config.py fuzzy match
 * only accepts: nona / openai / gemini / openrouter / deepseek / claude / grok / qwen / kimi.
 *
 * BYOK provider IDs (CLAUDE, OPENAI, etc.) are lowercased to match backend expectations.
 */
export function toApiProvider(frontendProvider: string): string {
  if (frontendProvider === LLM_PROVIDER_PRO_CATALOG) return 'nona';
  return frontendProvider.toLowerCase();
}

// =============================================================================
// Fallback Catalog
// =============================================================================

/**
 * Build fallback catalog from provider records.
 * Used for offline-first graceful degradation when backend API is unreachable.
 */
export function buildFallbackCatalog(): ProCatalogModel[] {
  return LLM_PROVIDER_RECORDS
    .flatMap(p => p.models.map(m => ({
      id: m.id,
      name: m.name,
      category: p.name,
    })));
}
