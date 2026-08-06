/**
 * Shared LLM-access decision (TICKET_1306_5, finding L1).
 *
 * The "may this session run an LLM-consuming feature?" decision tree
 * (Plan > keyless > BYOK > none) previously existed in TWO places:
 *
 *   - Electron owner: `LLMKeyResolver.canAccessLLMFeatures`
 *     (apps/desktop/src/main/services/llm-key-resolver.ts) -- the "Generate"
 *     gate: PRO/GOLD => platform key; keyless-by-design provider (TICKET_1265_7)
 *     => always usable; BYOK key present => usable; else no key.
 *   - MCP: `auth-gate.ts` bridged to Electron, then on bridge failure
 *     RE-DERIVED the same priority logic inline -- a divergent reconstructed
 *     fallback (TICKET_860 violation).
 *
 * This module is the ONE owner. It is a pure function over injected primitive
 * signals (already-resolved tier + selection + BYOK presence). Each surface
 * supplies its own IO to compute those signals but does NOT re-implement the
 * priority order:
 *
 *   - Electron `canAccessLLMFeatures` becomes a thin wrapper (builds the deps
 *     from its auth-service + credential store, maps the shared decision back
 *     to its richer `LLMAccessResult`).
 *   - MCP `auth-gate.ts` uses the Electron bridge as a performance CACHE of the
 *     desktop result; when the bridge is unreachable it calls THIS function
 *     with its own deps -- no inline re-derivation. If MCP cannot resolve its
 *     deps it fails loud (TICKET_858), never a silent divergent `no_key` guess.
 */

import { getProviderRecord } from '@StratCraft/types';

// =============================================================================
// Shapes
// =============================================================================

/** Source of the resolved access grant -- matches Electron `ApiKeySource`. */
export type LlmAccessSource = 'platform' | 'byok' | 'none';

/**
 * Canonical decision reason. The union is the superset of the reasons both
 * surfaces emit so neither has to invent a code:
 *   - `platform_key`                   : PRO/GOLD platform access.
 *   - `byok_configured`                : a usable BYOK key (or keyless provider).
 *   - `selected_provider_not_configured`: BYOK exists but the *selected*
 *                                         provider has no key.
 *   - `no_provider_configured`         : no plan, no BYOK at all.
 *   - `no_key`                         : synonym terminal used by the MCP
 *                                         standalone denial (kept for parity
 *                                         with the pre-1306_5 MCP reason).
 */
export type LlmAccessReason =
  | 'platform_key'
  | 'byok_configured'
  | 'selected_provider_not_configured'
  | 'no_provider_configured'
  | 'no_key';

/** The shared, canonical access decision. */
export interface LlmAccessDecision {
  allowed: boolean;
  source: LlmAccessSource;
  reason: LlmAccessReason;
}

/**
 * IO surface each process supplies to compute the decision. Every field is a
 * primitive signal the surface has already resolved from its own owning layer
 * (auth-service / OAuth row for tier; credential store for BYOK); the priority
 * ORDER over these signals lives only in `resolveLlmAccess`.
 */
export interface LlmAccessDeps {
  /**
   * Whether the session's account plan meets the platform-access tier
   * (PRO/GOLD). Electron resolves it via `meetsRequiredTier(userTier, 'pro')`;
   * MCP via `getSessionUserPlan` + the same tier ordering. Kept as a resolved
   * boolean so the tier-mapping table (an Electron-only shared constant) is not
   * a dependency of this package.
   */
  isPlanTier: boolean;
  /**
   * The canonical selected provider id, if any. Used only to recognise the
   * keyless-by-design case and to scope the BYOK-key check to the selection.
   */
  selectedProvider?: string;
  /**
   * Whether ANY BYOK credential is configured (across all keyed providers).
   * Drives the "BYOK exists" branch.
   */
  hasAnyByok(): Promise<boolean>;
  /**
   * Whether the *selected* provider has its required credential. Only consulted
   * when a keyed provider is explicitly selected while other BYOK keys exist,
   * to emit `selected_provider_not_configured` (TICKET_705 parity). When no
   * provider is selected this is not called.
   */
  hasByokForSelected(): Promise<boolean>;
}

// The PRO_CATALOG pseudo-provider is the Plan selection, not a keyed BYOK
// provider; a selected-provider BYOK check must never scope to it.
const PRO_CATALOG_ID = 'PRO_CATALOG';

/**
 * Resolve the LLM-access decision (Plan > keyless > BYOK > none).
 *
 * This is the SINGLE definition of the order. It mirrors the Electron
 * `canAccessLLMFeatures` tree exactly:
 *   1. Plan tier (PRO/GOLD) -> platform.
 *   2. A selected keyless-by-design provider (credential.required === false,
 *      e.g. Ollama) -> always usable, any tier, zero stored secrets
 *      (TICKET_1265_7 D1). Additive to the order: it neither reorders 1/3 nor
 *      changes a keyed provider's decision.
 *   3. BYOK configured -> usable, unless a *keyed* provider is selected whose
 *      own key is missing (TICKET_705 -> selected_provider_not_configured).
 *   4. Nothing -> no provider available (TICKET_638: no implicit fallback).
 */
export async function resolveLlmAccess(deps: LlmAccessDeps): Promise<LlmAccessDecision> {
  // 1. Plan tier => platform key.
  if (deps.isPlanTier) {
    return { allowed: true, source: 'platform', reason: 'platform_key' };
  }

  // 2. Keyless-by-design selected provider => always usable.
  if (deps.selectedProvider) {
    const record = getProviderRecord(deps.selectedProvider);
    if (record && !record.credential.required) {
      return { allowed: true, source: 'byok', reason: 'byok_configured' };
    }
  }

  // 3. BYOK configured.
  if (await deps.hasAnyByok()) {
    const selectsKeyedProvider =
      !!deps.selectedProvider && deps.selectedProvider.toUpperCase() !== PRO_CATALOG_ID;
    if (selectsKeyedProvider && !(await deps.hasByokForSelected())) {
      return { allowed: false, source: 'byok', reason: 'selected_provider_not_configured' };
    }
    return { allowed: true, source: 'byok', reason: 'byok_configured' };
  }

  // 4. No plan, no BYOK => no provider available.
  return { allowed: false, source: 'none', reason: 'no_provider_configured' };
}
