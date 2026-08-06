/**
 * Shared LLM provider resolution tests (TICKET_1276 P0b).
 *
 * These assert the SINGLE algorithm both Electron main and the MCP standalone
 * server now share: the usable-only list, the settings catalog payload, and the
 * credential-check payload. Deps are injected, so the tests drive the gates
 * (keyless-always-usable, key-required, auth/validation visibility, model
 * merge, recommendedModel) directly.
 */
import { describe, it, expect } from 'vitest';
import { LLM_PROVIDER_RECORDS, type CredentialHealth } from '@StratCraft/types';
import {
  resolveProvidersWithStatus,
  buildLlmProvidersPayload,
  buildLlmCredentialPayload,
  buildGuideToolbarGroups,
  type ProviderResolutionDeps,
} from '../resolve';

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

// The keyless (required:false) provider in the shared records -- Ollama.
const KEYLESS = LLM_PROVIDER_RECORDS.find(r => r.secretKey && !r.credential.required)!;
// A keyed provider (required:true) with a non-empty secretKey.
const KEYED = LLM_PROVIDER_RECORDS.find(r => r.secretKey && r.credential.required)!;

interface DepOverrides {
  keysPresent?: Set<string>;       // secretKeys that hasSecret() reports true for
  authenticated?: boolean;
  validated?: Set<string>;         // providerIds getValidationStatus() reports true for
  byokModels?: Record<string, Array<{ id: string; name: string }>>;
  proCatalog?: Array<{ id: string; name: string; category: string; tier?: string; isDefault?: boolean }>;
  warnings?: string[]; // sink; when supplied, log.warn appends here
  health?: Record<string, CredentialHealth>;
}

function makeDeps(o: DepOverrides = {}): ProviderResolutionDeps {
  return {
    hasSecret: async (k: string) => o.keysPresent?.has(k) ?? false,
    ...(o.health ? {
      getSecretHealth: async (key: string) => o.health![key] ?? { state: 'missing' },
    } : {}),
    isAuthenticated: async () => o.authenticated ?? false,
    getValidationStatus: async (id: string) => o.validated?.has(id) ?? false,
    fetchByokModels: async (id: string) => o.byokModels?.[id] ?? [],
    getProCatalogModels: async () => (o.proCatalog ?? []) as never,
    log: o.warnings
      ? { ...silentLog, warn: (m: string) => o.warnings!.push(m) }
      : silentLog,
  };
}

describe('resolveProvidersWithStatus', () => {
  it('lists the keyless provider unconditionally with zero secrets (platform status)', async () => {
    const providers = await resolveProvidersWithStatus(makeDeps());
    const keyless = providers.find(p => p.id === KEYLESS.id);
    expect(keyless).toBeDefined();
    expect(keyless!.status).toBe('platform');
    expect(keyless!.configured).toBe(true);
  });

  it('omits a keyed provider that has no stored key', async () => {
    const providers = await resolveProvidersWithStatus(makeDeps());
    expect(providers.find(p => p.id === KEYED.id)).toBeUndefined();
  });

  it('omits a keyed+keyed-with-key provider before login unless validated', async () => {
    const providers = await resolveProvidersWithStatus(makeDeps({
      keysPresent: new Set([KEYED.secretKey]),
      authenticated: false,
      validated: new Set(),
    }));
    expect(providers.find(p => p.id === KEYED.id)).toBeUndefined();
  });

  it('shows a keyed provider before login WHEN validated (verified status)', async () => {
    const providers = await resolveProvidersWithStatus(makeDeps({
      keysPresent: new Set([KEYED.secretKey]),
      authenticated: false,
      validated: new Set([KEYED.id]),
    }));
    const p = providers.find(x => x.id === KEYED.id);
    expect(p).toBeDefined();
    expect(p!.status).toBe('verified');
  });

  it('shows a keyed provider after login even if unvalidated (unverified status)', async () => {
    const providers = await resolveProvidersWithStatus(makeDeps({
      keysPresent: new Set([KEYED.secretKey]),
      authenticated: true,
      validated: new Set(),
    }));
    const p = providers.find(x => x.id === KEYED.id);
    expect(p).toBeDefined();
    expect(p!.status).toBe('unverified');
  });

  it('merges BYOK-discovered models and dedups by id', async () => {
    const providers = await resolveProvidersWithStatus(makeDeps({
      keysPresent: new Set([KEYED.secretKey]),
      authenticated: true,
      byokModels: { [KEYED.id]: [{ id: 'model-x', name: 'Model X' }, { id: 'model-x', name: 'dup' }] },
    }));
    const p = providers.find(x => x.id === KEYED.id)!;
    const xs = p.models.filter(m => m.id === 'model-x');
    expect(xs).toHaveLength(1);
  });

  it('sets recommendedModel when the hardcoded default is absent from the discovered list', async () => {
    // KEYED records carry models:[] (pure dynamic); discovered list lacks the
    // default, so recommendedModel must point at the first discovered model.
    const providers = await resolveProvidersWithStatus(makeDeps({
      keysPresent: new Set([KEYED.secretKey]),
      authenticated: true,
      byokModels: { [KEYED.id]: [{ id: 'fresh-1', name: 'Fresh 1' }] },
    }));
    const p = providers.find(x => x.id === KEYED.id)!;
    if (!p.models.some(m => m.id === KEYED.defaultModel)) {
      expect(p.recommendedModel).toBe('fresh-1');
    }
  });
});

// ---------------------------------------------------------------------------
// TICKET_1265_3_1: curation-aware merge (F1)
// ---------------------------------------------------------------------------
describe('TICKET_1265_3_1 curation merge', () => {
  it('AC1/AC2-revised: display set is curated INTERSECT discovered ONLY; non-curated discovered excluded', async () => {
    const providers = await resolveProvidersWithStatus(makeDeps({
      keysPresent: new Set([KEYED.secretKey]),
      authenticated: true,
      byokModels: {
        [KEYED.id]: [
          { id: 'gpt-5.2', name: 'GPT 5.2' },
          { id: 'gpt-5-mini', name: 'GPT 5 Mini' },
          { id: 'gpt-4o-2024-08-06', name: 'GPT 4o snapshot' }, // discovered but NOT curated
        ],
      },
      proCatalog: [
        { id: 'gpt-5.2', name: 'GPT 5.2', category: KEYED.name },
        { id: 'gpt-5-mini', name: 'GPT 5 Mini', category: KEYED.name },
      ],
    }));
    const p = providers.find(x => x.id === KEYED.id)!;
    // Round 2: only the curated intersection is shown; the non-curated dated
    // snapshot is EXCLUDED (no "All models" group).
    expect(p.models.map(m => m.id).sort()).toEqual(['gpt-5-mini', 'gpt-5.2']);
    expect(p.models.some(m => m.id === 'gpt-4o-2024-08-06')).toBe(false);
    // Every survivor carries recommended=true.
    expect(p.models.every(m => m.recommended === true)).toBe(true);
  });

  it('AC3: curated-but-not-discovered models are NOT appended (no dead entries)', async () => {
    const providers = await resolveProvidersWithStatus(makeDeps({
      keysPresent: new Set([KEYED.secretKey]),
      authenticated: true,
      byokModels: { [KEYED.id]: [{ id: 'gpt-5.2', name: 'GPT 5.2' }] },
      proCatalog: [
        { id: 'gpt-5.2', name: 'GPT 5.2', category: KEYED.name },
        { id: 'gpt-not-entitled', name: 'Not Served', category: KEYED.name },
      ],
    }));
    const p = providers.find(x => x.id === KEYED.id)!;
    expect(p.models.some(m => m.id === 'gpt-not-entitled')).toBe(false);
    expect(p.models.map(m => m.id)).toEqual(['gpt-5.2']);
  });

  it('AC7: discovery empty + curation available -> curated set, all recommended', async () => {
    const providers = await resolveProvidersWithStatus(makeDeps({
      keysPresent: new Set([KEYED.secretKey]),
      authenticated: true,
      byokModels: { [KEYED.id]: [] }, // vendor outage / network error
      proCatalog: [
        { id: 'gpt-5.2', name: 'GPT 5.2', category: KEYED.name, isDefault: true },
        { id: 'gpt-5-mini', name: 'GPT 5 Mini', category: KEYED.name },
      ],
    }));
    const p = providers.find(x => x.id === KEYED.id)!;
    expect(p.models.map(m => m.id).sort()).toEqual(['gpt-5-mini', 'gpt-5.2']);
    expect(p.models.every(m => m.recommended)).toBe(true);
  });

  it('recommendedModel prefers the curated is_default when discovered', async () => {
    // KEYED.defaultModel is absent from the discovered list, so the auto-correct
    // fires; the curated is_default (gpt-5-mini) must win over first-model order.
    const providers = await resolveProvidersWithStatus(makeDeps({
      keysPresent: new Set([KEYED.secretKey]),
      authenticated: true,
      byokModels: {
        [KEYED.id]: [
          { id: 'gpt-aaa', name: 'A' },
          { id: 'gpt-5-mini', name: 'GPT 5 Mini' },
        ],
      },
      proCatalog: [
        { id: 'gpt-5-mini', name: 'GPT 5 Mini', category: KEYED.name, isDefault: true },
      ],
    }));
    const p = providers.find(x => x.id === KEYED.id)!;
    expect(p.recommendedModel).toBe('gpt-5-mini');
  });

  it('AC6: OLLAMA is never shaped by backend curation; discovered models pass through unmarked', async () => {
    const providers = await resolveProvidersWithStatus(makeDeps({
      byokModels: { [KEYLESS.id]: [{ id: 'llama3', name: 'Llama 3' }, { id: 'mistral', name: 'Mistral' }] },
      // A curation entry keyed on the keyless provider's name must be ignored.
      proCatalog: [{ id: 'llama3', name: 'Llama 3', category: KEYLESS.name, isDefault: true }],
    }));
    const keyless = providers.find(p => p.id === KEYLESS.id)!;
    expect(keyless.models.map(m => m.id).sort()).toEqual(['llama3', 'mistral']);
    expect(keyless.models.every(m => m.recommended === undefined)).toBe(true);
  });

  it('AC4/P5: no curation -> discovery + F5 de-noising sort, single flat list, nothing removed, unmarked', async () => {
    // Offline / anonymous: getProCatalogModels returns []. The discovered pile
    // is the display set; F5 sinks the dated snapshot below the plain ids and
    // orders plain ids descending. No entry is dropped and none is recommended.
    const providers = await resolveProvidersWithStatus(makeDeps({
      keysPresent: new Set([KEYED.secretKey]),
      authenticated: true,
      byokModels: {
        [KEYED.id]: [
          { id: 'gpt-4o-2024-08-06', name: 'GPT 4o snapshot' },
          { id: 'gpt-5-mini', name: 'GPT 5 Mini' },
          { id: 'gpt-5.2', name: 'GPT 5.2' },
        ],
      },
      proCatalog: [], // no curation
    }));
    const p = providers.find(x => x.id === KEYED.id)!;
    // Plain ids first (descending), dated snapshot sunk last; nothing removed.
    expect(p.models.map(m => m.id)).toEqual([
      'gpt-5.2',
      'gpt-5-mini',
      'gpt-4o-2024-08-06',
    ]);
    expect(p.models.every(m => m.recommended === undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TICKET_1265_3_1 Round 3: intersection-collapse blackout degradation (F6/P6)
// ---------------------------------------------------------------------------
describe('TICKET_1265_3_1 F6/P6 empty-intersection degradation', () => {
  it('AC11: curated set fully disjoint from discovered -> falls back to discovery + F5 (non-empty, unmarked) + log.warn', async () => {
    // Live DeepSeek drift: curated deepseek-chat/deepseek-reasoner, but the key
    // serves deepseek-v4-flash/deepseek-v4-pro. Intersection is empty; the
    // picker must show the discovered list, not an empty selector.
    const warnings: string[] = [];
    const providers = await resolveProvidersWithStatus(makeDeps({
      keysPresent: new Set([KEYED.secretKey]),
      authenticated: true,
      byokModels: {
        [KEYED.id]: [
          { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
          { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
        ],
      },
      proCatalog: [
        { id: 'deepseek-chat', name: 'DeepSeek Chat', category: KEYED.name },
        { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', category: KEYED.name },
      ],
      warnings,
    }));
    const p = providers.find(x => x.id === KEYED.id)!;
    // Non-empty, unmarked, F5-ordered (plain ids descending).
    expect(p.models.map(m => m.id)).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash']);
    expect(p.models.every(m => m.recommended === undefined)).toBe(true);
    // Drift is observable.
    expect(warnings.some(w => w.includes(KEYED.name) && /curation stale/.test(w))).toBe(true);
  });

  it('AC12: recommendedModel in the degraded case falls to the first discovered id (curated default not discovered)', async () => {
    const providers = await resolveProvidersWithStatus(makeDeps({
      keysPresent: new Set([KEYED.secretKey]),
      authenticated: true,
      byokModels: {
        [KEYED.id]: [
          { id: 'grok-4.1', name: 'Grok 4.1' },
          { id: 'grok-4.0', name: 'Grok 4.0' },
        ],
      },
      proCatalog: [
        { id: 'grok-3', name: 'Grok 3', category: KEYED.name, isDefault: true },
        { id: 'grok-3-mini', name: 'Grok 3 Mini', category: KEYED.name },
      ],
    }));
    const p = providers.find(x => x.id === KEYED.id)!;
    // curated default (grok-3) was not discovered -> preference falls to the
    // first discovered model in F5 order (grok-4.1), not the stale default.
    if (!p.models.some(m => m.id === KEYED.defaultModel)) {
      expect(p.recommendedModel).toBe('grok-4.1');
    }
  });

  it('F6 regression guard: a partial overlap still yields intersection-only (does not weaken the healthy path)', async () => {
    // One curated id retired, one still served -> intersection non-empty, so the
    // Round 2 behavior stands: only the surviving curated id shows, recommended.
    const warnings: string[] = [];
    const providers = await resolveProvidersWithStatus(makeDeps({
      keysPresent: new Set([KEYED.secretKey]),
      authenticated: true,
      byokModels: {
        [KEYED.id]: [
          { id: 'gpt-5-mini', name: 'GPT 5 Mini' },   // curated + served
          { id: 'gpt-4o-2024-08-06', name: 'snap' },  // served, not curated
        ],
      },
      proCatalog: [
        { id: 'gpt-5-mini', name: 'GPT 5 Mini', category: KEYED.name },
        { id: 'gpt-retired', name: 'Retired', category: KEYED.name }, // curated, not served
      ],
      warnings,
    }));
    const p = providers.find(x => x.id === KEYED.id)!;
    expect(p.models.map(m => m.id)).toEqual(['gpt-5-mini']);
    expect(p.models.every(m => m.recommended === true)).toBe(true);
    // Healthy intersection -> NO drift warning.
    expect(warnings).toHaveLength(0);
  });
});

describe('buildLlmProvidersPayload', () => {
  it('providers is the usable slice; catalog covers every record', async () => {
    const payload = await buildLlmProvidersPayload(makeDeps());
    expect(payload.catalog).toHaveLength(LLM_PROVIDER_RECORDS.length);
    // Keyless usable in providers; keyed-without-key not.
    expect(payload.providers.some(p => p.id === KEYLESS.id)).toBe(true);
    expect(payload.providers.some(p => p.id === KEYED.id)).toBe(false);
  });

  it('catalog row usable flag matches the usable list membership', async () => {
    const payload = await buildLlmProvidersPayload(makeDeps({
      keysPresent: new Set([KEYED.secretKey]),
      authenticated: true,
    }));
    const keyedRow = payload.catalog.find(r => r.id === KEYED.id)!;
    expect(keyedRow.usable).toBe(true);
    expect(keyedRow.configured).toBe(true);
    const keylessRow = payload.catalog.find(r => r.id === KEYLESS.id)!;
    expect(keylessRow.configured).toBe(true); // keyless configured with no secret
  });
});

describe('buildLlmCredentialPayload', () => {
  it('marks keyless as configured and keyed configured only with a key; carries selection', async () => {
    const payload = await buildLlmCredentialPayload(
      makeDeps({ keysPresent: new Set([KEYED.secretKey]) }),
      async () => ({ provider: KEYED.id, model: 'm1' }),
    );
    const keyed = payload.providers.find(p => p.provider === KEYED.id)!;
    expect(keyed.configured).toBe(true);
    expect(keyed.credentialRequired).toBe(true);
    const keyless = payload.providers.find(p => p.provider === KEYLESS.id)!;
    expect(keyless.configured).toBe(true);
    expect(keyless.credentialRequired).toBe(false);
    expect(payload.selectedProvider).toBe(KEYED.id);
    expect(payload.selectedModel).toBe('m1');
  });

  it('null selection surfaces as null provider/model', async () => {
    const payload = await buildLlmCredentialPayload(makeDeps(), async () => null);
    expect(payload.selectedProvider).toBeNull();
    expect(payload.selectedModel).toBeNull();
  });
});

describe('buildGuideToolbarGroups', () => {
  it('renders every shared record while admitting only validated providers with models', async () => {
    const groups = await buildGuideToolbarGroups(makeDeps({
      keysPresent: new Set([KEYED.secretKey]),
      authenticated: true,
      byokModels: { [KEYED.id]: [{ id: 'model-1', name: 'Model 1' }] },
    }));
    expect(groups.flatMap(group => group.providers)).toHaveLength(LLM_PROVIDER_RECORDS.length);
    expect(groups.flatMap(group => group.providers).find(provider => provider.id === KEYED.id))
      .toMatchObject({ availability: 'needs_credential', models: [] });

    const validated = await buildGuideToolbarGroups(makeDeps({
      keysPresent: new Set([KEYED.secretKey]),
      authenticated: true,
      validated: new Set([KEYED.id]),
      byokModels: { [KEYED.id]: [{ id: 'model-1', name: 'Model 1' }] },
    }));
    expect(validated.flatMap(group => group.providers).find(provider => provider.id === KEYED.id))
      .toMatchObject({
        availability: 'selectable',
        models: [{ id: 'model-1', name: 'Model 1' }],
      });
  });

  it('requires every declared OpenAI Compatible credential field', async () => {
    const compatible = LLM_PROVIDER_RECORDS.find(record => record.id === 'OPENAI_COMPATIBLE')!;
    const groups = await buildGuideToolbarGroups(makeDeps({
      keysPresent: new Set([compatible.secretKey]),
      authenticated: true,
      validated: new Set([compatible.id]),
      byokModels: { [compatible.id]: [{ id: 'relay', name: 'Relay' }] },
    }));
    expect(groups.flatMap(group => group.providers).find(provider => provider.id === compatible.id))
      .toMatchObject({ availability: 'needs_credential' });

    const complete = await buildGuideToolbarGroups(makeDeps({
      keysPresent: new Set([
        compatible.secretKey,
        ...compatible.credential.extraFields!.map(field => field.key),
      ]),
      authenticated: true,
      validated: new Set([compatible.id]),
      byokModels: { [compatible.id]: [{ id: 'relay', name: 'Relay' }] },
    }));
    expect(complete.flatMap(group => group.providers).find(provider => provider.id === compatible.id))
      .toMatchObject({ availability: 'selectable' });
  });

  it(
    'TICKET_1313 AC11: an undecryptable stored key resolves to needs_credential, '
    + 'not selectable',
    async () => {
      // `hasSecret` is decryptability, not row existence. A stored-but-
      // undecryptable key (keyring master-key rotation) reports false here,
      // exactly as a never-stored key does -- so the provider is gated at the
      // dropdown instead of failing later at turn admission with no_byok_key.
      const undecryptable = await buildGuideToolbarGroups(makeDeps({
        keysPresent: new Set(),          // row exists in SQLite, but does not decode
        authenticated: true,
        validated: new Set([KEYED.id]),  // stale llm.validated.X flag survives
        byokModels: { [KEYED.id]: [{ id: 'model-1', name: 'Model 1' }] },
      }));
      expect(undecryptable.flatMap(g => g.providers).find(p => p.id === KEYED.id))
        .toMatchObject({ availability: 'needs_credential', models: [] });
    },
  );

  it('TICKET_1314 storage failures resolve to credential_error, never needs_credential', async () => {
    const health: CredentialHealth = {
      state: 'master_key_missing',
      keyId: 'key-1',
      recoverable: true,
    };
    const groups = await buildGuideToolbarGroups(makeDeps({
      authenticated: true,
      validated: new Set([KEYED.id]),
      health: { [KEYED.secretKey]: health },
    }));
    expect(groups.flatMap(group => group.providers).find(provider => provider.id === KEYED.id))
      .toMatchObject({
        availability: 'credential_error',
        credentialHealth: health,
        unavailableReason: undefined,
      });
  });

  it(
    'TICKET_1313 AC11: a stale validation flag alone cannot make an unusable '
    + 'credential selectable',
    async () => {
      // Guards the gate ORDER: hasRequiredCredentials must reject before
      // getValidationStatus is consulted, so a stale `llm.validated.X = true`
      // left over from when the key still decoded cannot resurrect the provider.
      const providers = await resolveProvidersWithStatus(makeDeps({
        keysPresent: new Set(),
        authenticated: true,
        validated: new Set([KEYED.id]),
        byokModels: { [KEYED.id]: [{ id: 'model-1', name: 'Model 1' }] },
      }));
      expect(providers.find(p => p.id === KEYED.id)).toBeUndefined();
    },
  );

  it(
    'TICKET_1313 AC11: an undecryptable extra field alone gates the provider',
    async () => {
      // The extraFields loop in hasRequiredCredentials shares the same
      // usability contract: a decodable primary key plus an undecryptable base
      // URL must NOT report selectable.
      const compatible = LLM_PROVIDER_RECORDS.find(r => r.id === 'OPENAI_COMPATIBLE')!;
      const groups = await buildGuideToolbarGroups(makeDeps({
        keysPresent: new Set([compatible.secretKey]), // extra fields unusable
        authenticated: true,
        validated: new Set([compatible.id]),
        byokModels: { [compatible.id]: [{ id: 'relay', name: 'Relay' }] },
      }));
      expect(groups.flatMap(g => g.providers).find(p => p.id === compatible.id))
        .toMatchObject({ availability: 'needs_credential' });
    },
  );

  it(
    'TICKET_1313 AC12: re-entering the key restores selectable without any '
    + 'other state change',
    async () => {
      const base = {
        authenticated: true,
        validated: new Set([KEYED.id]),
        byokModels: { [KEYED.id]: [{ id: 'model-1', name: 'Model 1' }] },
      };
      const before = await buildGuideToolbarGroups(makeDeps({ ...base, keysPresent: new Set() }));
      expect(before.flatMap(g => g.providers).find(p => p.id === KEYED.id))
        .toMatchObject({ availability: 'needs_credential' });

      // CredentialModal save -> re-encrypted under the current keyring ->
      // isCredentialUsable now true.
      const after = await buildGuideToolbarGroups(
        makeDeps({ ...base, keysPresent: new Set([KEYED.secretKey]) }),
      );
      expect(after.flatMap(g => g.providers).find(p => p.id === KEYED.id))
        .toMatchObject({ availability: 'selectable', models: [{ id: 'model-1', name: 'Model 1' }] });
    },
  );
});
