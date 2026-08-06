/**
 * TICKET_646 Phase 3: useLLMCatalog pure-helper unit tests.
 *
 * The hook itself is a thin React shell over `window.electronAPI.llmCatalog.*`.
 * The IPC contract is covered by:
 *   - `apps/desktop/src/main/ipc/__tests__/llm-entitlement-handlers.test.ts`
 *   - `apps/desktop/src/preload/__tests__/preload-api-functions.test.ts`
 *
 * The only non-trivial pure logic in the hook is the provider lookup index
 * used by `getModels(providerId)`. These tests cover that logic directly.
 *
 * TICKET_646 Phase 5: Type-shape tests for `LLMCatalogStatus` ensure the
 * snapshot/source contract surfaced by the hook stays aligned with the
 * preload API and main-process resolver.
 */
import { describe, it, expect } from 'vitest';
import {
  buildProviderIndex,
  lookupModels,
  type LLMCatalogProvider,
  type LLMCatalogStatus,
  type LLMCatalogSource,
} from '../useLLMCatalog';

const SAMPLE_PROVIDERS: LLMCatalogProvider[] = [
  {
    id: 'OPENAI',
    name: 'OpenAI',
    defaultModel: 'gpt-5-mini',
    models: [
      { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
      { id: 'gpt-5.2', name: 'GPT-5.2' },
    ],
  },
  {
    id: 'CLAUDE',
    name: 'Claude',
    defaultModel: 'claude-4-5-sonnet-latest',
    models: [
      { id: 'claude-4-5-sonnet-latest', name: 'Claude 4.5 Sonnet' },
    ],
  },
  {
    id: 'GEMINI',
    name: 'Gemini',
    defaultModel: 'gemini-2.5-flash',
    models: [],
  },
];

describe('buildProviderIndex', () => {
  it('indexes ids in upper case', () => {
    const idx = buildProviderIndex(SAMPLE_PROVIDERS);
    expect(idx.byId.get('OPENAI')?.id).toBe('OPENAI');
    expect(idx.byId.get('CLAUDE')?.id).toBe('CLAUDE');
    expect(idx.byId.get('GEMINI')?.id).toBe('GEMINI');
  });

  it('indexes display names in lower case', () => {
    const idx = buildProviderIndex(SAMPLE_PROVIDERS);
    expect(idx.byName.get('openai')?.id).toBe('OPENAI');
    expect(idx.byName.get('claude')?.id).toBe('CLAUDE');
    expect(idx.byName.get('gemini')?.id).toBe('GEMINI');
  });

  it('returns empty maps for empty provider list', () => {
    const idx = buildProviderIndex([]);
    expect(idx.byId.size).toBe(0);
    expect(idx.byName.size).toBe(0);
  });

  it('handles providers whose id is already upper case and name is mixed case', () => {
    const idx = buildProviderIndex([
      {
        id: 'DEEPSEEK',
        name: 'DeepSeek',
        defaultModel: 'deepseek-chat',
        models: [],
      },
    ]);
    expect(idx.byId.get('DEEPSEEK')).toBeDefined();
    expect(idx.byName.get('deepseek')).toBeDefined();
    expect(idx.byName.get('DeepSeek')).toBeUndefined();
  });
});

describe('lookupModels', () => {
  const idx = buildProviderIndex(SAMPLE_PROVIDERS);

  it('returns models when id matches in canonical upper-case form', () => {
    expect(lookupModels(idx, 'OPENAI').map(m => m.id)).toEqual([
      'gpt-5-mini',
      'gpt-5.2',
    ]);
  });

  it('returns models for a lower-case id (case-insensitive id match)', () => {
    expect(lookupModels(idx, 'openai').map(m => m.id)).toEqual([
      'gpt-5-mini',
      'gpt-5.2',
    ]);
  });

  it('returns models when keyed by display name (mixed case)', () => {
    expect(lookupModels(idx, 'Claude').map(m => m.id)).toEqual([
      'claude-4-5-sonnet-latest',
    ]);
  });

  it('returns models when keyed by display name (lower case)', () => {
    expect(lookupModels(idx, 'claude').map(m => m.id)).toEqual([
      'claude-4-5-sonnet-latest',
    ]);
  });

  it('returns the provider model array (which may be empty)', () => {
    expect(lookupModels(idx, 'GEMINI')).toEqual([]);
  });

  it('returns empty array when providerId is the empty string', () => {
    expect(lookupModels(idx, '')).toEqual([]);
  });

  it('returns empty array for an unknown provider', () => {
    expect(lookupModels(idx, 'UNKNOWN')).toEqual([]);
  });

  it('returns empty array against an empty index', () => {
    const empty = buildProviderIndex([]);
    expect(lookupModels(empty, 'OPENAI')).toEqual([]);
  });

  it('returns the provider id-keyed entry when id and a different name collide', () => {
    // Defensive check: a provider whose display name accidentally matches
    // another provider's id should still be addressable by both keys.
    const collide = buildProviderIndex([
      { id: 'A', name: 'B', defaultModel: '', models: [{ id: 'm-a', name: 'A' }] },
      { id: 'B', name: 'C', defaultModel: '', models: [{ id: 'm-b', name: 'B' }] },
    ]);
    expect(lookupModels(collide, 'A').map(m => m.id)).toEqual(['m-a']);
    expect(lookupModels(collide, 'B').map(m => m.id)).toEqual(['m-b']); // id wins over name
    expect(lookupModels(collide, 'C').map(m => m.id)).toEqual(['m-b']); // name lookup
  });
});

// ---------------------------------------------------------------------------
// TICKET_646 Phase 5: LLMCatalogStatus contract
// ---------------------------------------------------------------------------

describe('LLMCatalogStatus type contract', () => {
  it('accepts the three valid source values', () => {
    const live: LLMCatalogSource = 'live';
    const snapshot: LLMCatalogSource = 'snapshot';
    const empty: LLMCatalogSource = 'empty';
    expect([live, snapshot, snapshot, empty]).toHaveLength(4);
  });

  it('represents a fresh live status', () => {
    const status: LLMCatalogStatus = {
      source: 'live',
      snapshotTimestamp: 1700000000000,
      lastFetchAttempt: 1700000001000,
    };
    expect(status.source).toBe('live');
    expect(status.snapshotTimestamp).toBeGreaterThan(0);
    expect(status.lastFetchAttempt).toBeGreaterThan(0);
  });

  it('represents a snapshot status with no recent fetch', () => {
    const status: LLMCatalogStatus = {
      source: 'snapshot',
      snapshotTimestamp: 1699000000000,
      lastFetchAttempt: null,
    };
    expect(status.source).toBe('snapshot');
    expect(status.lastFetchAttempt).toBeNull();
    expect(status.snapshotTimestamp).not.toBeNull();
  });

  it('represents an empty status when no live and no snapshot are available', () => {
    const status: LLMCatalogStatus = {
      source: 'empty',
      snapshotTimestamp: null,
      lastFetchAttempt: 1700000002000,
    };
    expect(status.source).toBe('empty');
    expect(status.snapshotTimestamp).toBeNull();
    expect(status.lastFetchAttempt).toBeGreaterThan(0);
  });
});
