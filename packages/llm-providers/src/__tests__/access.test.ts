/**
 * Shared LLM-access decision (TICKET_1306_5, finding L1).
 *
 * AC1: `resolveLlmAccess(deps)` exists once with unit tests for the priority
 * order (Plan > keyless > BYOK > none).
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveLlmAccess, type LlmAccessDeps } from '../access';

const KEYED = 'CLAUDE'; // credential.required === true
const KEYLESS = 'OLLAMA'; // credential.required === false
const PRO_CATALOG = 'PRO_CATALOG'; // Plan selection, no keyed record

function deps(overrides: Partial<LlmAccessDeps> = {}): LlmAccessDeps {
  return {
    isPlanTier: false,
    selectedProvider: undefined,
    hasAnyByok: vi.fn(async () => false),
    hasByokForSelected: vi.fn(async () => false),
    ...overrides,
  };
}

describe('resolveLlmAccess -- priority order', () => {
  it('1. Plan tier wins over everything -> platform/platform_key', async () => {
    const d = deps({ isPlanTier: true, selectedProvider: KEYED, hasAnyByok: vi.fn(async () => true) });
    const decision = await resolveLlmAccess(d);
    expect(decision).toEqual({ allowed: true, source: 'platform', reason: 'platform_key' });
    // Plan short-circuits: BYOK signals are never consulted.
    expect(d.hasAnyByok).not.toHaveBeenCalled();
  });

  it('2. keyless selected provider is always usable (any tier, no key)', async () => {
    const d = deps({ selectedProvider: KEYLESS });
    const decision = await resolveLlmAccess(d);
    expect(decision).toEqual({ allowed: true, source: 'byok', reason: 'byok_configured' });
    // No BYOK lookup needed for a keyless-by-design provider.
    expect(d.hasAnyByok).not.toHaveBeenCalled();
  });

  it('2. keyless ranks below Plan (Plan still wins if plan tier)', async () => {
    const decision = await resolveLlmAccess(deps({ isPlanTier: true, selectedProvider: KEYLESS }));
    expect(decision.source).toBe('platform');
  });

  it('3. BYOK configured, no provider selected -> byok/byok_configured', async () => {
    const d = deps({ hasAnyByok: vi.fn(async () => true) });
    const decision = await resolveLlmAccess(d);
    expect(decision).toEqual({ allowed: true, source: 'byok', reason: 'byok_configured' });
    // hasByokForSelected is only consulted when a keyed provider is selected.
    expect(d.hasByokForSelected).not.toHaveBeenCalled();
  });

  it('3. BYOK exists but the SELECTED keyed provider has no key -> selected_provider_not_configured', async () => {
    const d = deps({
      selectedProvider: KEYED,
      hasAnyByok: vi.fn(async () => true),
      hasByokForSelected: vi.fn(async () => false),
    });
    const decision = await resolveLlmAccess(d);
    expect(decision).toEqual({
      allowed: false,
      source: 'byok',
      reason: 'selected_provider_not_configured',
    });
  });

  it('3. BYOK exists and the SELECTED keyed provider has its key -> byok_configured', async () => {
    const decision = await resolveLlmAccess(
      deps({
        selectedProvider: KEYED,
        hasAnyByok: vi.fn(async () => true),
        hasByokForSelected: vi.fn(async () => true),
      }),
    );
    expect(decision).toEqual({ allowed: true, source: 'byok', reason: 'byok_configured' });
  });

  it('3. PRO_CATALOG selection never scopes the BYOK key check (it is the Plan selection)', async () => {
    const d = deps({
      selectedProvider: PRO_CATALOG,
      hasAnyByok: vi.fn(async () => true),
      hasByokForSelected: vi.fn(async () => false),
    });
    const decision = await resolveLlmAccess(d);
    // PRO_CATALOG is not a keyed provider, so we do NOT demand a selected key.
    expect(decision).toEqual({ allowed: true, source: 'byok', reason: 'byok_configured' });
    expect(d.hasByokForSelected).not.toHaveBeenCalled();
  });

  it('4. no Plan, no BYOK -> none/no_provider_configured (TICKET_638, no implicit fallback)', async () => {
    const decision = await resolveLlmAccess(deps());
    expect(decision).toEqual({ allowed: false, source: 'none', reason: 'no_provider_configured' });
  });

  it('4. an unknown selected provider (no record) does not grant keyless access', async () => {
    const decision = await resolveLlmAccess(deps({ selectedProvider: 'NOPE_NOT_A_PROVIDER' }));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('no_provider_configured');
  });
});

describe('resolveLlmAccess -- fault propagation (TICKET_858)', () => {
  it('does NOT swallow a dep failure into a silent no_key guess', async () => {
    const boom = new Error('store read failed');
    const d = deps({
      hasAnyByok: vi.fn(async () => {
        throw boom;
      }),
    });
    await expect(resolveLlmAccess(d)).rejects.toThrow('store read failed');
  });
});
