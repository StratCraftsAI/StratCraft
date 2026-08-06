/**
 * FRED -> Guard Contract Integration Test
 *
 * TICKET_568_5_1 Phase 3 acceptance criteria 5/6:
 *   "Quant Lab backtest source picker refuses any signal whose underlying
 *    provider reports vintage_supported: false; the refusal message names
 *    TICKET_196_7_7."
 *   "FRED macro provider implemented end-to-end."
 *
 * This test does NOT exercise the full persistSignal() database write
 * path (that is owned by `discovery-persistence.test.ts` with extensive
 * Phase 1 coverage of the registry guard). What this test owns is the
 * INVARIANT bridge:
 *
 *   the REAL FredProvider satisfies the guard's vintage_supported=true
 *   precondition once initializeAltDataProviders() has run.
 *
 * That bridge is the load-bearing claim of Phase 3 -- everything else is
 * already covered by the unit tests for fred-provider, the registry, and
 * the persistence guard.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getAppPath: () => '/tmp' },
  safeStorage: { isEncryptionAvailable: () => false },
}));

import { AltDataProviderRegistry } from '../types';
import { initializeAltDataProviders, _resetAltDataBootstrapForTests } from '../bootstrap';

describe('FRED provider satisfies the alt-data persistence guard (TICKET_568_5_1 Phase 3)', () => {
  beforeEach(() => {
    _resetAltDataBootstrapForTests();
  });

  it('after bootstrap, the registered provider id matches the persistence guard contract', () => {
    initializeAltDataProviders();
    const provider = AltDataProviderRegistry.get('fred');
    expect(provider).toBeDefined();
    // The guard refuses any provider where vintage_supported !== true.
    // FRED's whole point is vintage support via ALFRED.
    expect(provider!.vintage_supported).toBe(true);
    // Live-only consumers (TICKET_196_7_7) require live_streaming_supported=true.
    expect(provider!.live_streaming_supported).toBe(true);
    // Source bucketing must be `macro` so Layer 3 UI category routing finds it.
    expect(provider!.source).toBe('macro');
  });

  it('before bootstrap, no fred provider is registered (registry empty)', () => {
    expect(AltDataProviderRegistry.get('fred')).toBeUndefined();
    expect(AltDataProviderRegistry.has('fred')).toBe(false);
  });
});

// TICKET_568_5_1_a -- Marketaux sentiment provider satisfies the LIVE-only
// path of the alt-data contract. The persistence guard's vintage refusal
// branch is the EXPECTED behavior for sentiment (news archives cannot be
// reconstructed at a past knowledge_time); live consumers (TICKET_196_7_7)
// remain usable because live_streaming_supported is true.
describe('Marketaux provider satisfies the alt-data contract (TICKET_568_5_1_a)', () => {
  beforeEach(() => {
    _resetAltDataBootstrapForTests();
  });

  it('after bootstrap, the marketaux provider id matches the persistence guard contract', () => {
    initializeAltDataProviders();
    const provider = AltDataProviderRegistry.get('marketaux');
    expect(provider).toBeDefined();
    // vintage_supported MUST be false (news archive cannot be replayed).
    // The persistence guard will refuse backtest registration on this --
    // that is the correct behavior, not a workaround.
    expect(provider!.vintage_supported).toBe(false);
    // Live consumers (TICKET_196_7_7) must remain usable.
    expect(provider!.live_streaming_supported).toBe(true);
    // Source bucketing must be `sentiment` so Layer 3 UI category routing
    // finds it.
    expect(provider!.source).toBe('sentiment');
  });
});

// TICKET_568_5_1_c -- Binance funding-rate / OI on-chain provider satisfies
// the FULL alt-data contract: vintage_supported=true (exchange settlements
// are immutable), live_streaming_supported=true. This is the first on-chain
// provider that the persistence guard ADMITS for backtest registration --
// the macro-style "vintage refused" branch does NOT fire for raw exchange
// microstructure.
describe('Binance funding-rate provider satisfies the alt-data contract (TICKET_568_5_1_c)', () => {
  beforeEach(() => {
    _resetAltDataBootstrapForTests();
  });

  it('after bootstrap, the binance-funding provider id matches the persistence guard contract', () => {
    initializeAltDataProviders();
    const provider = AltDataProviderRegistry.get('binance-funding');
    expect(provider).toBeDefined();
    // Exchange settlements are immutable -- vintage is honestly true.
    // The persistence guard ADMITS backtest registration on this branch.
    expect(provider!.vintage_supported).toBe(true);
    // Live consumers (TICKET_196_7_7) must remain usable.
    expect(provider!.live_streaming_supported).toBe(true);
    // Source bucketing must be `on_chain` so Layer 3 UI category routing
    // finds it.
    expect(provider!.source).toBe('on_chain');
  });
});
