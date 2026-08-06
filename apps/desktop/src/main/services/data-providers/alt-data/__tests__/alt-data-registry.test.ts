/**
 * AltDataProviderRegistry Unit Tests
 *
 * TICKET_568_5_1 Phase 1 + TICKET_494: full coverage of the alt-data provider
 * registry that gates the Layer 3 persistence path.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AltDataProviderRegistry, type IAlternativeDataProvider } from '../types';

function makeProvider(overrides: Partial<IAlternativeDataProvider> = {}): IAlternativeDataProvider {
  return {
    id: 'fred',
    name: 'FRED',
    source: 'macro',
    vintage_supported: true,
    live_streaming_supported: true,
    fetchFactorData: async () => [],
    ...overrides,
  };
}

describe('AltDataProviderRegistry', () => {
  beforeEach(() => {
    AltDataProviderRegistry.__resetForTests__();
  });

  it('returns undefined for unregistered providers', () => {
    expect(AltDataProviderRegistry.get('not-there')).toBeUndefined();
    expect(AltDataProviderRegistry.has('not-there')).toBe(false);
  });

  it('registers and looks up a provider', () => {
    const p = makeProvider();
    AltDataProviderRegistry.register(p);
    expect(AltDataProviderRegistry.get('fred')).toBe(p);
    expect(AltDataProviderRegistry.has('fred')).toBe(true);
  });

  it('refuses double-registration with the same id', () => {
    AltDataProviderRegistry.register(makeProvider());
    expect(() => AltDataProviderRegistry.register(makeProvider())).toThrow(
      /provider id 'fred' already registered/,
    );
  });

  it('allows re-registration after unregister', () => {
    AltDataProviderRegistry.register(makeProvider({ name: 'FRED-v1' }));
    AltDataProviderRegistry.unregister('fred');
    AltDataProviderRegistry.register(makeProvider({ name: 'FRED-v2' }));
    expect(AltDataProviderRegistry.get('fred')?.name).toBe('FRED-v2');
  });

  it('lists all registered providers', () => {
    AltDataProviderRegistry.register(makeProvider({ id: 'fred' }));
    AltDataProviderRegistry.register(
      makeProvider({ id: 'glassnode', source: 'on_chain', vintage_supported: false }),
    );
    const ids = AltDataProviderRegistry.list().map((p) => p.id).sort();
    expect(ids).toEqual(['fred', 'glassnode']);
  });

  it('preserves vintage_supported and live_streaming_supported flags exactly', () => {
    AltDataProviderRegistry.register(
      makeProvider({ id: 'newsapi', source: 'sentiment', vintage_supported: false, live_streaming_supported: true }),
    );
    const p = AltDataProviderRegistry.get('newsapi');
    expect(p?.vintage_supported).toBe(false);
    expect(p?.live_streaming_supported).toBe(true);
    expect(p?.source).toBe('sentiment');
  });
});
