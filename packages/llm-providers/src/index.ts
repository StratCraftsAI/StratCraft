/**
 * @StratCraft/llm-providers -- shared LLM provider resolution (TICKET_1276 P0b).
 *
 * One algorithm, two processes: the Electron main process and the MCP
 * standalone server both build their `list_llm_providers` /
 * `check_llm_credential` payloads and BYOK model discovery from this
 * package, with process-specific IO (credential store, cache dir, auth
 * state) injected. No divergent copies, no bridge-shaped fallbacks.
 */

export type { ProviderLogger } from './logger';

export {
  createByokModelFetcher,
  formatModelName,
  normalizeOpenAICompatibleBaseUrl,
  validateOpenAICompatibleBaseUrl,
  discoverByokModels,
  OLLAMA_DEFAULT_BASE_URL,
  LlmCredentialValidationError,
  type BYOKModel,
  type ByokFetcherDeps,
  type ByokModelFetcher,
  type LlmCredentialValues,
  type LlmCredentialValidationErrorCode,
} from './byok-fetcher';

export {
  resolveProvidersWithStatus,
  buildLlmProvidersPayload,
  buildLlmCredentialPayload,
  buildGuideToolbarGroups,
  getProviderRecord,
  type CuratedModel,
  type LLMProviderInfo,
  type ProviderResolutionDeps,
  type LlmCatalogRow,
  type LlmProvidersPayload,
  type LlmCredentialPayload,
} from './resolve';

// TICKET_1306_5 (finding L1): the ONE LLM-access decision (Plan > keyless >
// BYOK > none). Electron `canAccessLLMFeatures` and MCP `auth-gate.ts` both
// call this pure function -- neither re-implements the priority order.
export {
  resolveLlmAccess,
  type LlmAccessDecision,
  type LlmAccessDeps,
  type LlmAccessSource,
  type LlmAccessReason,
} from './access';

// TICKET_1265_3_1: curation primitives (F5 de-noising sort, F1 intersection
// marking) shared with any consumer building a picker payload.
export {
  denoiseSortModels,
  markRecommended,
} from './curation';

// TICKET_1265_3_1 F2: path-injected snapshot IO for the P5 degradation chain,
// shared by Electron (LLMKeyResolver) and the MCP standalone process (AC9).
export {
  writeCatalogSnapshot,
  readCatalogSnapshot,
  isValidSnapshotEnvelope,
  type CatalogSnapshotEnvelope,
} from './snapshot';
