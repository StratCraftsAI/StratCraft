/**
 * Alt-Data Bootstrap Tests
 *
 * TICKET_568_5_1 Phase 3: verify that initializeAltDataProviders() lands
 * the FRED provider into the registry exactly once and is idempotent.
 *
 * TICKET_568_5_1_a: same invariant for the Marketaux sentiment provider
 * (registered alongside FRED in the same bootstrap).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getAppPath: () => '/tmp' },
  safeStorage: { isEncryptionAvailable: () => false },
}));

import { AltDataProviderRegistry } from '../types';
import { initializeAltDataProviders, _resetAltDataBootstrapForTests } from '../bootstrap';

describe('initializeAltDataProviders', () => {
  beforeEach(() => {
    _resetAltDataBootstrapForTests();
  });

  it('registers the FRED provider after a single call', () => {
    expect(AltDataProviderRegistry.has('fred')).toBe(false);
    initializeAltDataProviders();
    expect(AltDataProviderRegistry.has('fred')).toBe(true);
    const fred = AltDataProviderRegistry.get('fred');
    expect(fred?.source).toBe('macro');
    expect(fred?.vintage_supported).toBe(true);
    expect(fred?.live_streaming_supported).toBe(true);
  });

  // TICKET_568_5_1_a -- Marketaux sentiment provider registered in the
  // same bootstrap as FRED. vintage_supported is intentionally false; the
  // persistence guard will refuse backtest for sentiment signals.
  it('registers the Marketaux sentiment provider', () => {
    expect(AltDataProviderRegistry.has('marketaux')).toBe(false);
    initializeAltDataProviders();
    expect(AltDataProviderRegistry.has('marketaux')).toBe(true);
    const m = AltDataProviderRegistry.get('marketaux');
    expect(m?.source).toBe('sentiment');
    expect(m?.vintage_supported).toBe(false);
    expect(m?.live_streaming_supported).toBe(true);
  });

  // TICKET_568_5_1_c -- Binance funding-rate / OI on-chain provider.
  // vintage_supported is honestly true (exchange settlements are immutable),
  // so the persistence guard ADMITS backtest registration for this source.
  it('registers the Binance funding-rate on-chain provider', () => {
    expect(AltDataProviderRegistry.has('binance-funding')).toBe(false);
    initializeAltDataProviders();
    expect(AltDataProviderRegistry.has('binance-funding')).toBe(true);
    const b = AltDataProviderRegistry.get('binance-funding');
    expect(b?.source).toBe('on_chain');
    expect(b?.vintage_supported).toBe(true);
    expect(b?.live_streaming_supported).toBe(true);
  });

  it('is idempotent (second call is a no-op, does not throw on double-register)', () => {
    initializeAltDataProviders();
    expect(() => initializeAltDataProviders()).not.toThrow();
    // Exactly four providers registered after the (idempotent) bootstrap:
    // FRED (macro) + CFTC COT (fund_flow) + Marketaux (sentiment) +
    // Binance funding (on_chain). Sorted alphabetically.
    expect(AltDataProviderRegistry.list().map((p) => p.id).sort()).toEqual([
      'binance-funding',
      'cftc-cot',
      'fred',
      'marketaux',
    ]);
  });
});
