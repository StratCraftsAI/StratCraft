/**
 * CredentialRegistry tests
 *
 * TICKET_809_1 Phase 2 (TICKET_809_4).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CredentialTier } from '../../../shared/constants/credential-tiers';
import {
  HOST_PLUGIN_ID,
  PROVIDER_DOMAINS,
  type ProviderCredentialContribution,
  type ProviderIconComponent,
} from '../../../shared/types/credential-contribution';
import {
  CredentialContributionError,
  CredentialRegistry,
  credentialRegistry as sharedRegistry,
  type CredentialRegistryChangeDetail,
} from '../credential-registry';

const TestIcon: ProviderIconComponent = () => null;

function makeLlmContribution(
  overrides: Partial<ProviderCredentialContribution> = {},
): ProviderCredentialContribution {
  return {
    providerId: 'openai',
    domain: 'llm',
    nameKey: 'settings.providers.openai.name',
    icon: TestIcon,
    pluginId: HOST_PLUGIN_ID,
    fields: [
      {
        key: 'llm.openai.apiKey',
        labelKey: 'settings.providers.openai.apiKey',
        inputType: 'password',
        required: true,
      },
    ],
    ...overrides,
  };
}

function makeDataContribution(
  overrides: Partial<ProviderCredentialContribution> = {},
): ProviderCredentialContribution {
  return {
    providerId: 'alpaca',
    domain: 'data',
    nameKey: 'settings.providers.alpaca.name',
    icon: TestIcon,
    pluginId: 'com.stratcraft.back-test-nexus',
    fields: [
      {
        key: 'alpaca.apiKeyId',
        labelKey: 'settings.providers.alpaca.apiKeyId',
        inputType: 'text',
        required: true,
      },
      {
        key: 'alpaca.apiSecretKey',
        labelKey: 'settings.providers.alpaca.apiSecretKey',
        inputType: 'password',
        required: true,
      },
    ],
    ...overrides,
  };
}

describe('CredentialRegistry.register', () => {
  let registry: CredentialRegistry;

  beforeEach(() => {
    registry = new CredentialRegistry();
  });

  it('stores a valid contribution and reports size', () => {
    registry.register(makeLlmContribution());
    expect(registry.size()).toBe(1);
    expect(registry.has('openai')).toBe(true);
  });

  it('emits a register event with the new total', () => {
    const events: CredentialRegistryChangeDetail[] = [];
    registry.subscribe(d => events.push(d));

    registry.register(makeLlmContribution());
    registry.register(makeLlmContribution({ providerId: 'claude' }));
    expect(events).toEqual([
      { change: 'register', providerId: 'openai', total: 1 },
      { change: 'register', providerId: 'claude', total: 2 },
    ]);
  });

  it('rejects duplicate providerId with a CredentialContributionError', () => {
    registry.register(makeLlmContribution());
    expect(() => registry.register(makeLlmContribution())).toThrow(CredentialContributionError);
    expect(registry.size()).toBe(1);
  });

  it('rejects empty providerId', () => {
    expect(() =>
      registry.register(makeLlmContribution({ providerId: '' })),
    ).toThrow(/providerId/);
  });

  it('rejects empty pluginId', () => {
    expect(() =>
      registry.register(makeLlmContribution({ pluginId: '' })),
    ).toThrow(/pluginId/);
  });

  it('rejects unknown domain', () => {
    expect(() =>
      registry.register(makeLlmContribution({
        // @ts-expect-error -- intentional invalid domain for runtime test
        domain: 'nope',
      })),
    ).toThrow(/domain/);
  });

  it('rejects empty fields array', () => {
    expect(() =>
      registry.register(makeLlmContribution({ fields: [] })),
    ).toThrow(/fields/);
  });

  it('rejects duplicate field keys within one contribution', () => {
    expect(() =>
      registry.register(
        makeLlmContribution({
          fields: [
            {
              key: 'llm.openai.apiKey',
              labelKey: 'a',
              inputType: 'password',
              required: true,
            },
            {
              key: 'llm.openai.apiKey',
              labelKey: 'b',
              inputType: 'password',
              required: false,
            },
          ],
        }),
      ),
    ).toThrow(/duplicate field key/);
  });

  it('rejects empty field.key', () => {
    expect(() =>
      registry.register(
        makeLlmContribution({
          fields: [
            { key: '', labelKey: 'x', inputType: 'password', required: true },
          ],
        }),
      ),
    ).toThrow(/field.key/);
  });

  it('rejects tier override that LOWERS sensitivity', () => {
    // llm.openai.apiKey infers to T0_CRITICAL (0). T2_LOW (2) is a lower
    // sensitivity (higher number) and must be rejected.
    expect(() =>
      registry.register(
        makeLlmContribution({
          fields: [
            {
              key: 'llm.openai.apiKey',
              labelKey: 'x',
              inputType: 'password',
              required: true,
              tier: CredentialTier.T2_LOW,
            },
          ],
        }),
      ),
    ).toThrow(/lowers sensitivity/);
  });

  it('accepts tier override that RAISES sensitivity', () => {
    // license_key infers to T2_LOW (2). Overriding to T0_CRITICAL (0) raises
    // sensitivity and must be accepted.
    expect(() =>
      registry.register(
        makeLlmContribution({
          providerId: 'license-bound',
          fields: [
            {
              key: 'license_key',
              labelKey: 'x',
              inputType: 'password',
              required: true,
              tier: CredentialTier.T0_CRITICAL,
            },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('accepts tier override equal to inferred default', () => {
    expect(() =>
      registry.register(
        makeLlmContribution({
          fields: [
            {
              key: 'llm.openai.apiKey',
              labelKey: 'x',
              inputType: 'password',
              required: true,
              tier: CredentialTier.T0_CRITICAL,
            },
          ],
        }),
      ),
    ).not.toThrow();
  });
});

describe('CredentialRegistry.unregister', () => {
  let registry: CredentialRegistry;

  beforeEach(() => {
    registry = new CredentialRegistry();
  });

  it('removes a registered provider and returns true', () => {
    registry.register(makeLlmContribution());
    expect(registry.unregister('openai')).toBe(true);
    expect(registry.has('openai')).toBe(false);
    expect(registry.size()).toBe(0);
  });

  it('returns false (no-op) for unknown providerId', () => {
    const events: CredentialRegistryChangeDetail[] = [];
    registry.subscribe(d => events.push(d));

    expect(registry.unregister('ghost')).toBe(false);
    expect(events).toEqual([]);
  });

  it('emits an unregister event with the new total', () => {
    registry.register(makeLlmContribution());
    registry.register(makeLlmContribution({ providerId: 'claude' }));

    const events: CredentialRegistryChangeDetail[] = [];
    registry.subscribe(d => events.push(d));

    registry.unregister('openai');
    expect(events).toEqual([
      { change: 'unregister', providerId: 'openai', total: 1 },
    ]);
  });

  it('allows re-registration after unregister', () => {
    registry.register(makeLlmContribution());
    registry.unregister('openai');
    expect(() => registry.register(makeLlmContribution())).not.toThrow();
    expect(registry.size()).toBe(1);
  });
});

describe('CredentialRegistry.clear', () => {
  let registry: CredentialRegistry;

  beforeEach(() => {
    registry = new CredentialRegistry();
  });

  it('removes all contributions', () => {
    registry.register(makeLlmContribution());
    registry.register(makeDataContribution());
    registry.clear();
    expect(registry.size()).toBe(0);
  });

  it('emits exactly one clear event when non-empty', () => {
    registry.register(makeLlmContribution());
    const events: CredentialRegistryChangeDetail[] = [];
    registry.subscribe(d => events.push(d));

    registry.clear();
    expect(events).toEqual([{ change: 'clear', total: 0 }]);
  });

  it('is a no-op (no event) when already empty', () => {
    const events: CredentialRegistryChangeDetail[] = [];
    registry.subscribe(d => events.push(d));

    registry.clear();
    expect(events).toEqual([]);
  });
});

describe('CredentialRegistry queries', () => {
  let registry: CredentialRegistry;

  beforeEach(() => {
    registry = new CredentialRegistry();
    registry.register(makeLlmContribution());
    registry.register(makeLlmContribution({ providerId: 'claude' }));
    registry.register(makeDataContribution());
  });

  it('getAll returns contributions in registration order', () => {
    const all = registry.getAll();
    expect(all.map(c => c.providerId)).toEqual(['openai', 'claude', 'alpaca']);
  });

  it('getAll returns a copy (mutation does not leak)', () => {
    const all = registry.getAll();
    all.pop();
    expect(registry.size()).toBe(3);
  });

  it('getByDomain filters correctly', () => {
    expect(registry.getByDomain('llm').map(c => c.providerId)).toEqual([
      'openai',
      'claude',
    ]);
    expect(registry.getByDomain('data').map(c => c.providerId)).toEqual(['alpaca']);
    expect(registry.getByDomain('exchange')).toEqual([]);
  });

  it('getByDomain returns empty for every domain on an empty registry', () => {
    const empty = new CredentialRegistry();
    for (const d of PROVIDER_DOMAINS) {
      expect(empty.getByDomain(d)).toEqual([]);
    }
  });

  it('getById returns the contribution', () => {
    expect(registry.getById('openai')?.providerId).toBe('openai');
  });

  it('getById returns undefined for unknown id', () => {
    expect(registry.getById('ghost')).toBeUndefined();
  });
});

describe('CredentialRegistry subscribe', () => {
  let registry: CredentialRegistry;

  beforeEach(() => {
    registry = new CredentialRegistry();
  });

  it('returns an unsubscribe function that stops further events', () => {
    const events: CredentialRegistryChangeDetail[] = [];
    const unsubscribe = registry.subscribe(d => events.push(d));

    registry.register(makeLlmContribution());
    expect(events).toHaveLength(1);

    unsubscribe();
    registry.register(makeLlmContribution({ providerId: 'claude' }));
    expect(events).toHaveLength(1);
  });

  it('supports multiple independent subscribers', () => {
    const a: CredentialRegistryChangeDetail[] = [];
    const b: CredentialRegistryChangeDetail[] = [];
    registry.subscribe(d => a.push(d));
    registry.subscribe(d => b.push(d));

    registry.register(makeLlmContribution());

    expect(a).toEqual([{ change: 'register', providerId: 'openai', total: 1 }]);
    expect(b).toEqual([{ change: 'register', providerId: 'openai', total: 1 }]);
  });

  it('isolates one throwing subscriber from the others', () => {
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const good: CredentialRegistryChangeDetail[] = [];
      registry.subscribe(() => {
        throw new Error('subscriber boom');
      });
      registry.subscribe(d => good.push(d));

      expect(() => registry.register(makeLlmContribution())).not.toThrow();
      expect(good).toHaveLength(1);
      expect(consoleErr).toHaveBeenCalled();
    } finally {
      consoleErr.mockRestore();
    }
  });
});

describe('shared singleton registry', () => {
  afterEach(() => {
    sharedRegistry.clear();
  });

  it('is a CredentialRegistry instance', () => {
    expect(sharedRegistry).toBeInstanceOf(CredentialRegistry);
  });

  it('survives mutation within a single test', () => {
    sharedRegistry.register(makeLlmContribution());
    expect(sharedRegistry.has('openai')).toBe(true);
  });
});
