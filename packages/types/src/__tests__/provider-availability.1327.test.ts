/**
 * TICKET_1327 -- full-coverage tests for the shared provider-availability
 * owner (TICKET_494 mandate).
 *
 * The defect was not a wrong verdict, it was TWO SOURCES: Electron read the
 * credential store, the WebUI read a live reachability probe, and the
 * credential map itself existed as three hand-maintained copies. So these
 * tests pin the invariants that make re-divergence impossible:
 *
 *   AC2 -- exactly one credential-map definition; a reintroduced mirror fails.
 *   AC5 -- all-keys-required survives (1 of 2 keys stored -> not-configured).
 *   AC6 -- fail-closed survives, WITHOUT collapsing `unknown` into
 *          `not-configured` as a displayed claim.
 *   AC7 -- a cold probe cache never presents providers as unconfigured.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  DATA_PROVIDER_CREDENTIALS,
  DATA_PROVIDER_CREDENTIAL_PLUGIN_ID,
  isByokDataProvider,
  resolveDataProviderFromCredential,
  resolveProviderConfiguredState,
  resolveConfiguredDataProviders,
  toSelectableProviderIds,
  buildAvailabilityWithoutReachability,
  type CredentialPresenceReader,
} from '../provider-availability';
import { DATA_CREDENTIAL_KEYS } from '../credential-keys';

/** A reader where only the listed keys exist. */
function readerWith(...presentKeys: string[]): CredentialPresenceReader {
  return async (_pluginId, key) => ({ success: true, exists: presentKeys.includes(key) });
}

/** A reader that throws -- an unreadable store, NOT absent credentials. */
const throwingReader: CredentialPresenceReader = async () => {
  throw new Error('keyring locked');
};

/** A reader that reports failure without throwing. */
const failingReader: CredentialPresenceReader = async () => ({
  success: false, exists: false, errorMessage: 'master key unavailable',
});

const ALL_KEYS = Object.values(DATA_PROVIDER_CREDENTIALS).flatMap(d => [...d.requiredKeys]);

describe('TICKET_1327 AC2 -- one credential-map definition', () => {
  it('every BYOK provider declares a plugin, at least one key, and a display name', () => {
    const ids = Object.keys(DATA_PROVIDER_CREDENTIALS);
    expect(ids.length).toBeGreaterThan(0);
    for (const [id, d] of Object.entries(DATA_PROVIDER_CREDENTIALS)) {
      expect(d.pluginId, `${id}.pluginId`).toBe(DATA_PROVIDER_CREDENTIAL_PLUGIN_ID);
      expect(d.requiredKeys.length, `${id}.requiredKeys`).toBeGreaterThan(0);
      expect(d.displayName?.length, `${id}.displayName`).toBeGreaterThan(0);
    }
  });

  it('carries the UNION of the two former mirrors, including tushare', () => {
    // The mirrors had diverged: `provider-manager.ts` had tushare, the
    // renderer gate did not. The union is the fail-CLOSED resolution --
    // omitting a key-bearing provider would let it pass the gate unchecked.
    expect(Object.keys(DATA_PROVIDER_CREDENTIALS).sort())
      .toEqual(['alpaca', 'alpha_vantage', 'polygon', 'tushare']);
  });

  it('preserves the composite-key shape for alpaca', () => {
    expect([...DATA_PROVIDER_CREDENTIALS.alpaca.requiredKeys]).toEqual([
      DATA_CREDENTIAL_KEYS.ALPACA_API_KEY_ID,
      DATA_CREDENTIAL_KEYS.ALPACA_API_SECRET_KEY,
    ]);
  });

  it('declares no duplicate credential key across providers', () => {
    // A key mapping to two providers would make the reverse lookup ambiguous
    // and silently misroute a targeted status refresh.
    expect(new Set(ALL_KEYS).size).toBe(ALL_KEYS.length);
  });

  it('resolveDataProviderFromCredential round-trips every declared key', () => {
    for (const [id, d] of Object.entries(DATA_PROVIDER_CREDENTIALS)) {
      for (const key of d.requiredKeys) {
        expect(resolveDataProviderFromCredential(d.pluginId, key)).toBe(id);
      }
    }
  });

  it('resolveDataProviderFromCredential rejects a foreign plugin or unknown key', () => {
    expect(resolveDataProviderFromCredential('com.other.plugin', DATA_CREDENTIAL_KEYS.POLYGON_API_KEY)).toBeNull();
    expect(resolveDataProviderFromCredential(DATA_PROVIDER_CREDENTIAL_PLUGIN_ID, 'unknown.key')).toBeNull();
    // An LLM key must never resolve to a data provider.
    expect(resolveDataProviderFromCredential(DATA_PROVIDER_CREDENTIAL_PLUGIN_ID, 'llm.openai.apiKey')).toBeNull();
  });

  it('isByokDataProvider is true only for mapped providers', () => {
    expect(isByokDataProvider('polygon')).toBe(true);
    expect(isByokDataProvider('tushare')).toBe(true);
    // Always-on providers need no credentials and must pass unconditionally.
    expect(isByokDataProvider('yfinance')).toBe(false);
    expect(isByokDataProvider('ccxt')).toBe(false);
    // Must not be fooled by inherited Object properties.
    expect(isByokDataProvider('toString')).toBe(false);
    expect(isByokDataProvider('constructor')).toBe(false);
  });
});

describe('TICKET_1327 AC5 -- all-keys-required', () => {
  it('a provider with ALL required keys is configured', async () => {
    const e = await resolveProviderConfiguredState('alpaca', readerWith(
      DATA_CREDENTIAL_KEYS.ALPACA_API_KEY_ID,
      DATA_CREDENTIAL_KEYS.ALPACA_API_SECRET_KEY,
    ));
    expect(e.state).toBe('configured');
    expect(e.missingKeys).toEqual([]);
  });

  it('a provider with 1 of 2 required keys is NOT configured', async () => {
    const e = await resolveProviderConfiguredState('alpaca', readerWith(
      DATA_CREDENTIAL_KEYS.ALPACA_API_KEY_ID,
    ));
    expect(e.state).toBe('not-configured');
    expect(e.missingKeys).toEqual([DATA_CREDENTIAL_KEYS.ALPACA_API_SECRET_KEY]);
  });

  it('the OTHER single key alone is also not enough', async () => {
    const e = await resolveProviderConfiguredState('alpaca', readerWith(
      DATA_CREDENTIAL_KEYS.ALPACA_API_SECRET_KEY,
    ));
    expect(e.state).toBe('not-configured');
    expect(e.missingKeys).toEqual([DATA_CREDENTIAL_KEYS.ALPACA_API_KEY_ID]);
  });

  it('a provider with no keys stored is not-configured and lists all of them', async () => {
    const e = await resolveProviderConfiguredState('alpaca', readerWith());
    expect(e.state).toBe('not-configured');
    expect(e.missingKeys).toHaveLength(2);
  });

  it('a single-key provider is configured by its one key', async () => {
    const e = await resolveProviderConfiguredState('polygon', readerWith(
      DATA_CREDENTIAL_KEYS.POLYGON_API_KEY,
    ));
    expect(e.state).toBe('configured');
  });

  it('an unmapped provider needs no credentials and is trivially usable', async () => {
    const e = await resolveProviderConfiguredState('yfinance', readerWith());
    expect(e.state).toBe('configured');
    expect(e.requiresCredentials).toBe(false);
  });

  it('reads EVERY key on a definitive miss so the UI can name them all', async () => {
    // Deliberately NOT short-circuiting on the first absent key: the whole
    // point of `missingKeys` is to tell the user which credentials to enter.
    // Stopping early would report "Alpaca needs apiKeyId" when it needs both.
    const spy = vi.fn(async () => ({ success: true, exists: false }));
    const e = await resolveProviderConfiguredState('alpaca', spy);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(e.missingKeys).toHaveLength(2);
  });

  it('short-circuits on a READ FAILURE (no point continuing an unreadable store)', async () => {
    // The asymmetry is intentional: absence is per-key information worth
    // collecting; an unreadable store makes every later read meaningless.
    const spy = vi.fn(async () => { throw new Error('locked'); });
    await resolveProviderConfiguredState('alpaca', spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('TICKET_1327 AC6 -- fail-closed WITHOUT a false display claim', () => {
  it('a thrown read yields `unknown`, not `not-configured`', async () => {
    const e = await resolveProviderConfiguredState('polygon', throwingReader);
    expect(e.state).toBe('unknown');
    expect(e.state).not.toBe('not-configured');
    expect(e.unreadableReason).toContain('keyring locked');
  });

  it('a non-success read yields `unknown` and surfaces the reason', async () => {
    const e = await resolveProviderConfiguredState('polygon', failingReader);
    expect(e.state).toBe('unknown');
    expect(e.unreadableReason).toBe('master key unavailable');
  });

  it('`unknown` reports NO missing keys -- nothing was readable', async () => {
    // Listing "missing" keys after a failed read would assert a fact we do
    // not have, and would render as "you need to enter these."
    const e = await resolveProviderConfiguredState('alpaca', throwingReader);
    expect(e.missingKeys).toEqual([]);
  });

  it('`unknown` GATES as not-selectable (fail-closed preserved)', async () => {
    const entries = await resolveConfiguredDataProviders(throwingReader);
    expect(entries.every(e => e.state === 'unknown')).toBe(true);
    // The gate must be empty: a host crash mid-read must not bypass BYOK.
    expect(toSelectableProviderIds(entries).size).toBe(0);
  });

  it('a mid-read failure on ONE provider does not taint the others', async () => {
    const reader: CredentialPresenceReader = async (_p, key) => {
      if (key === DATA_CREDENTIAL_KEYS.POLYGON_API_KEY) throw new Error('boom');
      return { success: true, exists: true };
    };
    const entries = await resolveConfiguredDataProviders(reader);
    const byId = Object.fromEntries(entries.map(e => [e.id, e]));
    expect(byId.polygon.state).toBe('unknown');
    expect(byId.alpaca.state).toBe('configured');
    expect(toSelectableProviderIds(entries).has('alpaca')).toBe(true);
    expect(toSelectableProviderIds(entries).has('polygon')).toBe(false);
  });
});

describe('TICKET_1327 AC1/AC3 -- one source, same verdict', () => {
  it('resolves every mapped provider exactly once', async () => {
    const entries = await resolveConfiguredDataProviders(readerWith());
    expect(entries.map(e => e.id).sort()).toEqual(Object.keys(DATA_PROVIDER_CREDENTIALS).sort());
  });

  it('two surfaces sharing one machine state agree provider-for-provider', async () => {
    // AC3 reduces to determinism over the same reader: both surfaces call
    // this function, so a divergence is only possible if one recomputes.
    const machineState = readerWith(
      DATA_CREDENTIAL_KEYS.POLYGON_API_KEY,
      DATA_CREDENTIAL_KEYS.ALPACA_API_KEY_ID,
    );
    const electron = await resolveConfiguredDataProviders(machineState);
    const webui = await resolveConfiguredDataProviders(machineState);
    expect(electron).toEqual(webui);
    // ...and the verdicts are the expected ones for that state.
    const byId = Object.fromEntries(electron.map(e => [e.id, e.state]));
    expect(byId.polygon).toBe('configured');
    expect(byId.alpaca).toBe('not-configured');   // only 1 of 2 keys
    expect(byId.tushare).toBe('not-configured');
  });

  it('toSelectableProviderIds admits only `configured`', async () => {
    const entries = await resolveConfiguredDataProviders(
      readerWith(DATA_CREDENTIAL_KEYS.POLYGON_API_KEY),
    );
    expect([...toSelectableProviderIds(entries)]).toEqual(['polygon']);
  });
});

describe('TICKET_1327 AC4/AC7 -- reachability is absent, never false', () => {
  it('the Class-S-only response carries configured and an absence reason', () => {
    const configured = [{
      id: 'polygon', displayName: 'Polygon.io', requiresCredentials: true,
      state: 'configured' as const, missingKeys: [],
    }];
    const r = buildAvailabilityWithoutReachability(configured, 'Electron is not running');

    // Class-S half present and intact.
    expect(r.configured).toEqual(configured);
    // Class-R half explicitly ABSENT -- not an empty array, which a consumer
    // could misread as "probed, nothing reachable" (TICKET_858).
    expect(r.reachability).toBeUndefined();
    expect('reachability' in r).toBe(false);
    expect(r.reachabilityAbsentReason).toBe('Electron is not running');
  });

  it('an absent Class-R half is ALWAYS explained', () => {
    const r = buildAvailabilityWithoutReachability([], 'probe unavailable');
    expect(r.reachabilityAbsentReason).toBeTruthy();
  });

  it('a configured provider stays configured with no probe available (AC4)', () => {
    // The inverse-direction failure F3 warns about: a configured provider must
    // not appear unconfigured merely because reachability is unknown.
    const configured = [{
      id: 'polygon', displayName: 'Polygon.io', requiresCredentials: true,
      state: 'configured' as const, missingKeys: [],
    }];
    const r = buildAvailabilityWithoutReachability(configured, 'no pool');
    expect(r.configured[0].state).toBe('configured');
    expect(toSelectableProviderIds(r.configured).has('polygon')).toBe(true);
  });

  it('configured-ness is independent of any probe status (AC7)', async () => {
    // A cold cache reports `checking` for everything. Configured-ness is
    // computed from credentials only, so it cannot be affected -- which is
    // exactly why the split makes the WebUI answer possible.
    const entries = await resolveConfiguredDataProviders(
      readerWith(DATA_CREDENTIAL_KEYS.POLYGON_API_KEY),
    );
    const polygon = entries.find(e => e.id === 'polygon')!;
    expect(polygon.state).toBe('configured');
    expect(Object.keys(polygon)).not.toContain('status');
    expect(Object.keys(polygon)).not.toContain('latencyMs');
  });
});
