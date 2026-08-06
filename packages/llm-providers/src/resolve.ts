/**
 * Shared LLM provider resolution (TICKET_1276 P0b).
 *
 * `resolveProvidersWithStatus` is the algorithm formerly private to the
 * Electron `LLMKeyResolver.getProvidersWithStatus` (TICKET_194/645/1158/
 * 1265_7/1267); `buildLlmProvidersPayload` / `buildLlmCredentialPayload`
 * are the response constructions formerly private to the Electron
 * settings-api. Both processes now call these SAME functions with
 * process-specific IO injected, so the picker payload is identical no
 * matter which process serves it (TICKET_1276 AC2) and the MCP-side
 * STANDALONE_PROVIDER_CATALOG divergent copy is deleted.
 */

import {
  LLM_PROVIDER_RECORDS,
  getProviderRecord,
  type ProCatalogModel,
  type GuideToolbarGroup,
  type CredentialHealth,
} from '@StratCraft/types';
import type { ProviderLogger } from './logger';
import { denoiseSortModels, markRecommended } from './curation';

// =============================================================================
// Shapes
// =============================================================================

/**
 * TICKET_1265_3_1: a picker model entry. `recommended` is set when the id is in
 * the backend curated set AND was actually discovered from the user's key
 * (curated INTERSECT discovered, P2). In Round 2 (curated-only display), the
 * curation path emits ONLY recommended entries -- the flag no longer drives UI
 * grouping (no "All models" split); it is kept for internal use (degradation
 * detection, `recommendedModel` preference). Absent on the no-curation fallback
 * (OLLAMA, offline/anonymous discovery baseline).
 */
export interface CuratedModel {
  id: string;
  name: string;
  recommended?: boolean;
}

/** TICKET_194/195: Provider info with verification status and models */
export interface LLMProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  status: 'platform' | 'verified' | 'unverified';
  defaultModel: string;
  models: CuratedModel[];
  /**
   * TICKET_1267 D3: Model to select when `defaultModel` is absent from the
   * discovered `models` list. Clients select `recommendedModel ?? defaultModel`.
   * TICKET_1265_3_1: preference order upgraded -- curated `is_default` if
   * discovered, then the first model in the curated intersection, then the
   * first-model fallback.
   */
  recommendedModel?: string;
}

/** IO surface each process supplies. */
export interface ProviderResolutionDeps {
  /**
   * Whether a USABLE secret exists for this provider secretKey.
   *
   * TICKET_1313 Phase 4: "usable" means the stored value both exists AND
   * decodes with the current OS keyring master key. A row-existence-only
   * implementation is a false positive -- after a keyring master-key rotation
   * every encrypted row survives but fails its GCM auth tag, so the provider
   * would be reported `selectable` here and then fail at turn admission with
   * "No API key configured for <PROVIDER>". Wire this to
   * `SecureStore.isCredentialUsable`, never to `hasCredential`.
   */
  hasSecret(secretKey: string): Promise<boolean>;
  /** Authoritative typed health. Production adapters must supply this. */
  getSecretHealth?: (secretKey: string) => Promise<CredentialHealth>;
  /** Auth state gate (TICKET_645: pre-login shows only verified BYOK). */
  isAuthenticated(): Promise<boolean>;
  /** Per-provider key-validation flag (plugin config.json). */
  getValidationStatus(providerId: string): Promise<boolean>;
  /** BYOK-discovered models (24h cached; byok-fetcher.ts). */
  fetchByokModels(providerId: string): Promise<Array<{ id: string; name: string }>>;
  /**
   * Curation catalog models (authenticated backend fetch / snapshot / empty).
   * TICKET_1266_1: this is the COMPLETE `/api/llm/providers/models` flatten,
   * INCLUDING BYOK-only curation entries (e.g. the `OpenAI Compatible`
   * category) -- NOT the Pro-facing platform-served slice.
   */
  getProCatalogModels(): Promise<ProCatalogModel[]>;
  log: ProviderLogger;
}

interface RequiredCredentialStatus {
  configured: boolean;
  error?: Exclude<CredentialHealth, { state: 'usable' | 'missing' }>;
}

async function requiredCredentialStatus(
  deps: Pick<ProviderResolutionDeps, 'hasSecret' | 'getSecretHealth'>,
  record: (typeof LLM_PROVIDER_RECORDS)[number],
): Promise<RequiredCredentialStatus> {
  if (!record.credential.required) return { configured: true };
  const check = async (secretKey: string): Promise<RequiredCredentialStatus> => {
    if (!deps.getSecretHealth) return { configured: await deps.hasSecret(secretKey) };
    const health = await deps.getSecretHealth(secretKey);
    if (health.state === 'usable') return { configured: true };
    if (health.state === 'missing') return { configured: false };
    return { configured: false, error: health };
  };
  if (!record.secretKey) return { configured: false };
  const primary = await check(record.secretKey);
  if (!primary.configured) return primary;
  for (const field of record.credential.extraFields ?? []) {
    if (field.required) {
      const extra = await check(field.key);
      if (!extra.configured) return extra;
    }
  }
  return { configured: true };
}

async function hasRequiredCredentials(
  deps: Pick<ProviderResolutionDeps, 'hasSecret' | 'getSecretHealth'>,
  record: (typeof LLM_PROVIDER_RECORDS)[number],
): Promise<boolean> {
  return (await requiredCredentialStatus(deps, record)).configured;
}

// =============================================================================
// Core resolution (usable-only list)
// =============================================================================

/** Merge model lists preserving input order, first id wins on duplicates. */
function dedupById(models: readonly CuratedModel[]): CuratedModel[] {
  const seen = new Set<string>();
  const out: CuratedModel[] = [];
  for (const m of models) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      out.push({ id: m.id, name: m.name });
    }
  }
  return out;
}

/**
 * TICKET_194: All usable LLM providers with status.
 * TICKET_696: NONA provider removed. Returns only configured BYOK providers
 * (+ keyless providers, which are always usable).
 */
export async function resolveProvidersWithStatus(
  deps: ProviderResolutionDeps,
): Promise<LLMProviderInfo[]> {
  const providers: LLMProviderInfo[] = [];

  // 1. Fetch the backend curated catalog (Pro/Gold users only; empty for
  //    unauthenticated / offline). TICKET_1265_3_1 (Round 2): this is the
  //    CURATION source -- the display set validated against discovery. When
  //    present it REPLACES the raw discovery pile (curated INTERSECT
  //    discovered, P1/P2); when absent, discovery is the fallback (P5).
  const apiModels = await deps.getProCatalogModels();

  // Build the curated set per provider category (record.name). Each entry is
  // the set of curated ids plus the backend `is_default` id, used to select the
  // display set from the discovered list (the curated intersection).
  interface CurationEntry {
    ids: Set<string>;
    defaultId?: string;
  }
  const curationByProvider = new Map<string, CurationEntry>();
  for (const model of apiModels) {
    let entry = curationByProvider.get(model.category);
    if (!entry) {
      entry = { ids: new Set() };
      curationByProvider.set(model.category, entry);
    }
    entry.ids.add(model.id);
    if (model.isDefault) {
      entry.defaultId = model.id;
    }
  }

  // 2. Check each BYOK provider
  // TICKET_645: Before login -- only verified credentials shown.
  //             After login -- all BYOK with key + backend API models.
  const isAuthenticated = await deps.isAuthenticated();

  for (const record of LLM_PROVIDER_RECORDS) {
    if (!record.secretKey) continue;

    // TICKET_1265_7 D1/D2: a provider whose credential is not required
    // (Ollama -- local base URL, default localhost) is ALWAYS usable with
    // zero stored secrets.
    // TICKET_1265_3_1 AC6: OLLAMA is local-only; curation NEVER applies. Its
    // discovered models pass through unmarked (F5 de-noising order only), so
    // the UI renders a single flat list.
    if (!record.credential.required) {
      const localModels = await deps.fetchByokModels(record.id);
      providers.push({
        id: record.id,
        name: record.name,
        configured: true,
        status: 'platform',
        defaultModel: record.defaultModel,
        models: denoiseSortModels([...record.models, ...dedupById(localModels)]),
      });
      continue;
    }

    if (!(await hasRequiredCredentials(deps, record))) continue;

    const isValidated = await deps.getValidationStatus(record.id);

    // Before login: only show verified BYOK providers
    // After login: show all BYOK providers that have a key
    if (!isAuthenticated && !isValidated) continue;

    // TICKET_1267 D1: discover this key's models from the provider's own API
    // (24h memory+disk cached). TICKET_1158: BYOK record.models is [] (pure
    // dynamic), so the discovered list IS the provider's model list.
    const discovered = dedupById([...record.models, ...(await deps.fetchByokModels(record.id))]);
    const curation = curationByProvider.get(record.name);

    let models: CuratedModel[];
    if (curation && curation.ids.size > 0 && discovered.length > 0) {
      // TICKET_1265_3_1 F1/P1/P2 (Round 2, curated-only): the display set is
      // curated INTERSECT discovered ONLY. A model appears iff the backend
      // curates it AND the user's key serves it. Non-curated discovered models
      // (dated snapshots, image/modality variants, previews) are noise and are
      // EXCLUDED -- there is no "All models" group. Curated-but-not-discovered
      // ids are also dropped (AC3: the key does not serve them). All survivors
      // carry recommended=true. F5 de-noising order applied for stability.
      const sorted = denoiseSortModels(discovered);
      const intersection = markRecommended(
        sorted.filter(m => curation.ids.has(m.id)),
        curation.ids,
      );
      if (intersection.length > 0) {
        models = intersection;
      } else {
        // TICKET_1265_3_1 F6/P6 (Round 3, intersection-collapse blackout):
        // every curated id for this provider has been retired upstream, so
        // `curated INTERSECT discovered == ∅` while the key still serves
        // models. "Never to empty" (P6) is a hard invariant that binds the
        // intersection, not just the chain endpoint: degrade to the same
        // terminal state as the no-curation branch -- denoiseSortModels(
        // discovered), unmarked -- instead of emitting an empty selector. The
        // stale backend table is escalated separately (F3); this only makes the
        // client survive the drift. A sibling provider with a healthy
        // intersection is unaffected (per-provider).
        deps.log.warn(
          `curated set for '${record.name}' does not intersect discovered ` +
            `models; curation stale, falling back to discovery`,
        );
        models = sorted;
      }
    } else if (curation && curation.ids.size > 0) {
      // TICKET_1265_3_1 F1/AC7/P5: curation available but discovery failed or
      // returned empty (network error, vendor outage). Fall back to the curated
      // set, all recommended -- better than an empty picker.
      models = apiModels
        .filter(m => m.category === record.name)
        .map(m => ({ id: m.id, name: m.name, recommended: true }));
    } else {
      // TICKET_1265_3_1 F1/AC4/P5 (degradation baseline): NO curation
      // (offline / anonymous / first run). Discovery + F5 de-noising sort IS
      // the display set -- a single flat list, no recommended marking. This is
      // the open-core BYOK experience (TICKET_435/638).
      models = denoiseSortModels(discovered);
    }

    const modelIds = new Set(models.map(m => m.id));

    // TICKET_1267 D3 + TICKET_1265_3_1 F1: when the hardcoded defaultModel is
    // not served, recommend an auto-correct in this preference order:
    //   1. the curated `is_default` model IF it was discovered,
    //   2. the first recommended (curated INTERSECT discovered) model,
    //   3. the first available model (legacy fallback).
    let recommendedModel: string | undefined;
    if (models.length > 0 && !modelIds.has(record.defaultModel)) {
      const curatedDefaultDiscovered =
        curation?.defaultId && modelIds.has(curation.defaultId) ? curation.defaultId : undefined;
      const firstRecommended = models.find(m => m.recommended)?.id;
      recommendedModel = curatedDefaultDiscovered ?? firstRecommended ?? models[0].id;
    }

    providers.push({
      id: record.id,
      name: record.name,
      configured: true,
      status: isValidated ? 'verified' : 'unverified',
      defaultModel: record.defaultModel,
      models,
      recommendedModel,
    });
  }

  return providers;
}

// =============================================================================
// list_llm_providers payload ({ providers, catalog })
// =============================================================================

export interface LlmCatalogRow {
  id: string;
  name: string;
  defaultModel: string;
  models: Array<{ id: string; name: string }>;
  credential: unknown;
  credentialRequired: boolean;
  configured: boolean;
  usable: boolean;
}

export interface LlmProvidersPayload {
  providers: LLMProviderInfo[];
  catalog: LlmCatalogRow[];
}

/** Build the complete discovery surface while retaining one usable resolver. */
export async function buildGuideToolbarGroups(
  deps: ProviderResolutionDeps,
  planProviders: GuideToolbarGroup['providers'] = [],
): Promise<GuideToolbarGroup[]> {
  const usable = await resolveProvidersWithStatus(deps);
  const usableById = new Map(usable.map(provider => [provider.id, provider]));
  const byok: GuideToolbarGroup = { kind: 'byok', label: 'BYOK', providers: [] };
  const local: GuideToolbarGroup = { kind: 'local', label: 'Local', providers: [] };

  for (const record of LLM_PROVIDER_RECORDS) {
    const resolved = usableById.get(record.id);
    const credentialStatus = await requiredCredentialStatus(deps, record);
    const group = record.credential.required ? byok : local;
    const accessValid = resolved?.status === 'verified' || resolved?.status === 'platform';
    const selectable = accessValid && resolved.models.length > 0;
    const unavailableReason = credentialStatus.error
      ? undefined
      : !accessValid
        ? 'Credential validation is required in Settings'
        : 'No models are currently available from this provider';
    group.providers.push({
      id: record.id,
      name: record.name,
      availability: selectable
        ? 'selectable'
        : credentialStatus.error
          ? 'credential_error'
          : 'needs_credential',
      unavailableReason: selectable ? undefined : unavailableReason,
      ...(credentialStatus.error ? { credentialHealth: credentialStatus.error } : {}),
      models: selectable ? resolved.models : [],
      recommendedModelId: resolved?.recommendedModel ?? resolved?.defaultModel,
    });
  }

  return [{ kind: 'plan', label: 'Plan', providers: planProviders }, byok, local];
}

/**
 * TICKET_1265_7 D1/D2: `providers` is the usable-only picker slice;
 * `catalog` is the full provider list for the Settings credential section,
 * each row carrying its shared credential metadata and stored-secret status.
 */
export async function buildLlmProvidersPayload(
  deps: ProviderResolutionDeps,
): Promise<LlmProvidersPayload> {
  const usable = await resolveProvidersWithStatus(deps);
  const usableIds = new Set(usable.map(p => p.id));

  const catalog = await Promise.all(
    LLM_PROVIDER_RECORDS.map(async r => {
      const credentialStatus = await requiredCredentialStatus(deps, r);
      return {
        id: r.id,
        name: r.name,
        defaultModel: r.defaultModel,
        models: r.models,
        credential: r.credential,
        credentialRequired: r.credential.required,
        configured: r.credential.required ? credentialStatus.configured : true,
        ...(credentialStatus.error ? { credentialHealth: credentialStatus.error } : {}),
        usable: usableIds.has(r.id),
      };
    }),
  );

  return { providers: usable, catalog };
}

// =============================================================================
// check_llm_credential payload
// =============================================================================

export interface LlmCredentialPayload {
  providers: Array<{ provider: string; configured: boolean; credentialRequired: boolean }>;
  selectedProvider: string | null;
  selectedModel: string | null;
}

/**
 * TICKET_1265_7 D2: credential-kind-aware configured check (a required:false
 * provider is configured with no stored secret) + the canonical persisted
 * selection.
 */
export async function buildLlmCredentialPayload(
  deps: Pick<ProviderResolutionDeps, 'hasSecret'>,
  getSelection: () => Promise<{ provider: string; model: string } | null>,
): Promise<LlmCredentialPayload> {
  const results: Array<{ provider: string; configured: boolean; credentialRequired: boolean }> = [];

  for (const record of LLM_PROVIDER_RECORDS) {
    const credentialRequired = record.credential.required;
    if (!credentialRequired) {
      results.push({ provider: record.id, configured: true, credentialRequired });
      continue;
    }
    if (!record.secretKey) {
      results.push({ provider: record.id, configured: false, credentialRequired });
      continue;
    }
    const configured = await deps.hasSecret(record.secretKey);
    results.push({ provider: record.id, configured, credentialRequired });
  }

  const selection = await getSelection();

  return {
    providers: results,
    selectedProvider: selection?.provider ?? null,
    selectedModel: selection?.model ?? null,
  };
}

// =============================================================================
// Re-export convenience
// =============================================================================

export { getProviderRecord };
