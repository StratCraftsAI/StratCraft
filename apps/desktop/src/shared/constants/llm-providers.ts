/**
 * LLM Provider Records - desktop re-export shim
 *
 * TICKET_483: Single source of truth for LLM provider model data.
 * TICKET_1276 P0b: the records and helpers moved to `@StratCraft/types`
 * (llm-provider-records.ts) so the MCP standalone server consumes the same
 * data without a hardcoded copy. This file keeps every existing desktop
 * import site working.
 *
 * IMPORTANT (build correctness): `@StratCraft/types` is externalized in the
 * Electron main bundle (`const types = require("@StratCraft/types")`). A bare
 * re-export -- `export { X } from '@StratCraft/types'` -- is mis-compiled by
 * electron-vite/Rollup: whichever re-exported symbol has no same-reference
 * local use is emitted as a bare identifier in the module object instead of
 * `types.X`, causing `ReferenceError: <name> is not defined` at main-process
 * init. Binding each symbol to a local `const` forces Rollup to materialize
 * `const X = types.X`, which cannot be tree-shaken while X is exported. This
 * is the deterministic re-export form (established for LLM_CREDENTIAL_META
 * in TICKET_1265_7 D2).
 */

import {
  LLM_CREDENTIAL_META as LLM_CREDENTIAL_META_SRC,
  getLlmCredentialMeta as getLlmCredentialMeta_src,
  validateLlmCredentialValue as validateLlmCredentialValue_src,
  LLM_PROVIDER_RECORDS as LLM_PROVIDER_RECORDS_SRC,
  getProviderRecord as getProviderRecord_src,
  isPlatformServedProvider as isPlatformServedProvider_src,
  resolveModelDisplayName as resolveModelDisplayName_src,
  COST_PREFERRED_PROVIDER_ORDER as COST_PREFERRED_PROVIDER_ORDER_SRC,
  COST_PREFERRED_MODEL_OVERRIDES as COST_PREFERRED_MODEL_OVERRIDES_SRC,
  selectCostPreferredProvider as selectCostPreferredProvider_src,
  toApiProvider as toApiProvider_src,
  buildFallbackCatalog as buildFallbackCatalog_src,
} from '@StratCraft/types';

export const LLM_CREDENTIAL_META = LLM_CREDENTIAL_META_SRC;
export const getLlmCredentialMeta = getLlmCredentialMeta_src;
export const validateLlmCredentialValue = validateLlmCredentialValue_src;
export const LLM_PROVIDER_RECORDS = LLM_PROVIDER_RECORDS_SRC;
export const getProviderRecord = getProviderRecord_src;
export const isPlatformServedProvider = isPlatformServedProvider_src;
export const resolveModelDisplayName = resolveModelDisplayName_src;
export const COST_PREFERRED_PROVIDER_ORDER = COST_PREFERRED_PROVIDER_ORDER_SRC;
export const COST_PREFERRED_MODEL_OVERRIDES = COST_PREFERRED_MODEL_OVERRIDES_SRC;
export const selectCostPreferredProvider = selectCostPreferredProvider_src;
export const toApiProvider = toApiProvider_src;
export const buildFallbackCatalog = buildFallbackCatalog_src;

export type { LLMCredentialMeta } from '@StratCraft/types';
export type {
  LLMProviderRecord,
  ProCatalogModel,
  BackendProviderModel,
  BackendProvider,
  BackendProviderResponse,
  ProAvailableProvider,
} from '@StratCraft/types';
