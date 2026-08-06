/**
 * SecretsPanel helpers tests
 *
 * TICKET_809_1 Phase 3 (TICKET_809_5).
 */

import { describe, expect, it } from 'vitest';

import {
  HOST_PLUGIN_ID,
  type ProviderCredentialContribution,
  type ProviderIconComponent,
} from '../../../../../shared/types/credential-contribution';
import {
  applyFilter,
  diffChangedFields,
  diffClearedFields,
  isProviderFullyConfigured,
  resolveShowAuditLog,
  resolveShowSecurityStatus,
  validateFieldPatterns,
} from '../helpers';

const TestIcon: ProviderIconComponent = () => null;

function makeOpenAi(): ProviderCredentialContribution {
  return {
    providerId: 'openai',
    domain: 'llm',
    nameKey: 'p.openai.name',
    icon: TestIcon,
    pluginId: HOST_PLUGIN_ID,
    fields: [
      {
        key: 'llm.openai.apiKey',
        labelKey: 'p.openai.apiKey',
        inputType: 'password',
        required: true,
        pattern: '^sk-',
      },
    ],
  };
}

function makeAlpaca(): ProviderCredentialContribution {
  return {
    providerId: 'alpaca',
    domain: 'data',
    nameKey: 'p.alpaca.name',
    icon: TestIcon,
    pluginId: 'com.stratcraft.back-test-nexus',
    fields: [
      { key: 'alpaca.apiKeyId', labelKey: 'p.alpaca.id', inputType: 'text', required: true },
      {
        key: 'alpaca.apiSecretKey',
        labelKey: 'p.alpaca.secret',
        inputType: 'password',
        required: true,
      },
      {
        key: 'alpaca.note',
        labelKey: 'p.alpaca.note',
        inputType: 'text',
        required: false,
      },
    ],
  };
}

describe('applyFilter', () => {
  const all = [makeOpenAi(), makeAlpaca()];

  it('returns all when filter is undefined', () => {
    expect(applyFilter(all, undefined).map(c => c.providerId)).toEqual(['openai', 'alpaca']);
  });

  it('returns all when filter is empty object', () => {
    expect(applyFilter(all, {}).map(c => c.providerId)).toEqual(['openai', 'alpaca']);
  });

  it('filters by single domain', () => {
    expect(applyFilter(all, { domains: ['llm'] }).map(c => c.providerId)).toEqual(['openai']);
    expect(applyFilter(all, { domains: ['data'] }).map(c => c.providerId)).toEqual(['alpaca']);
  });

  it('filters by multiple domains', () => {
    expect(
      applyFilter(all, { domains: ['llm', 'data'] }).map(c => c.providerId),
    ).toEqual(['openai', 'alpaca']);
  });

  it('filters by providerIds', () => {
    expect(applyFilter(all, { providerIds: ['alpaca'] }).map(c => c.providerId)).toEqual([
      'alpaca',
    ]);
  });

  it('AND-combines domains and providerIds', () => {
    expect(
      applyFilter(all, { domains: ['llm'], providerIds: ['alpaca'] }),
    ).toEqual([]);
    expect(
      applyFilter(all, { domains: ['llm'], providerIds: ['openai'] }).map(c => c.providerId),
    ).toEqual(['openai']);
  });

  it('treats empty arrays as "no constraint"', () => {
    expect(applyFilter(all, { domains: [] }).map(c => c.providerId)).toEqual(['openai', 'alpaca']);
    expect(applyFilter(all, { providerIds: [] }).map(c => c.providerId)).toEqual([
      'openai',
      'alpaca',
    ]);
  });

  it('does not mutate the input list', () => {
    const result = applyFilter(all, undefined);
    result.pop();
    expect(all).toHaveLength(2);
  });
});

describe('resolveShowAuditLog', () => {
  it('defaults true in page mode', () => {
    expect(resolveShowAuditLog({ mode: 'page' })).toBe(true);
  });
  it('defaults false in modal mode', () => {
    expect(resolveShowAuditLog({ mode: 'modal' })).toBe(false);
  });
  it('respects explicit true', () => {
    expect(resolveShowAuditLog({ mode: 'modal', showAuditLog: true })).toBe(true);
  });
  it('respects explicit false', () => {
    expect(resolveShowAuditLog({ mode: 'page', showAuditLog: false })).toBe(false);
  });
});

describe('resolveShowSecurityStatus', () => {
  it('defaults true in page mode', () => {
    expect(resolveShowSecurityStatus({ mode: 'page' })).toBe(true);
  });
  it('defaults false in modal mode', () => {
    expect(resolveShowSecurityStatus({ mode: 'modal' })).toBe(false);
  });
  it('respects explicit true', () => {
    expect(resolveShowSecurityStatus({ mode: 'modal', showSecurityStatus: true })).toBe(true);
  });
  it('respects explicit false', () => {
    expect(resolveShowSecurityStatus({ mode: 'page', showSecurityStatus: false })).toBe(false);
  });
});

describe('isProviderFullyConfigured', () => {
  it('returns false when a required field is missing', () => {
    expect(isProviderFullyConfigured(makeAlpaca(), {})).toBe(false);
  });

  it('returns false when a required field is empty string', () => {
    expect(
      isProviderFullyConfigured(makeAlpaca(), {
        'alpaca.apiKeyId': '',
        'alpaca.apiSecretKey': 'secret',
      }),
    ).toBe(false);
  });

  it('returns false when a required field is whitespace-only', () => {
    expect(
      isProviderFullyConfigured(makeAlpaca(), {
        'alpaca.apiKeyId': '   ',
        'alpaca.apiSecretKey': 'secret',
      }),
    ).toBe(false);
  });

  it('returns true when all required fields are populated, optional missing', () => {
    expect(
      isProviderFullyConfigured(makeAlpaca(), {
        'alpaca.apiKeyId': 'PK123',
        'alpaca.apiSecretKey': 'secret',
      }),
    ).toBe(true);
  });

  it('returns true when both required and optional populated', () => {
    expect(
      isProviderFullyConfigured(makeAlpaca(), {
        'alpaca.apiKeyId': 'PK123',
        'alpaca.apiSecretKey': 'secret',
        'alpaca.note': 'paper account',
      }),
    ).toBe(true);
  });
});

describe('validateFieldPatterns', () => {
  it('returns empty when no fields declare patterns', () => {
    expect(
      validateFieldPatterns(makeAlpaca(), {
        'alpaca.apiKeyId': 'X',
        'alpaca.apiSecretKey': 'Y',
      }),
    ).toEqual({});
  });

  it('reports pattern mismatch with descriptive error', () => {
    const errors = validateFieldPatterns(makeOpenAi(), { 'llm.openai.apiKey': 'nope' });
    expect(errors['llm.openai.apiKey']).toContain('does not match');
  });

  it('accepts pattern-matching value', () => {
    expect(
      validateFieldPatterns(makeOpenAi(), { 'llm.openai.apiKey': 'sk-test-1234' }),
    ).toEqual({});
  });

  it('skips empty values (to avoid double-reporting with required check)', () => {
    expect(validateFieldPatterns(makeOpenAi(), { 'llm.openai.apiKey': '' })).toEqual({});
    expect(validateFieldPatterns(makeOpenAi(), {})).toEqual({});
  });

  it('silently skips malformed patterns (developer error, not user error)', () => {
    const broken: ProviderCredentialContribution = {
      ...makeOpenAi(),
      fields: [
        {
          key: 'k',
          labelKey: 'l',
          inputType: 'password',
          required: true,
          pattern: '([',
        },
      ],
    };
    expect(validateFieldPatterns(broken, { k: 'whatever' })).toEqual({});
  });
});

describe('diffChangedFields', () => {
  it('returns empty when nothing changed', () => {
    expect(diffChangedFields({ a: 'x' }, { a: 'x' })).toEqual({});
  });

  it('captures new keys', () => {
    expect(diffChangedFields({}, { a: 'x' })).toEqual({ a: 'x' });
  });

  it('captures updated keys', () => {
    expect(diffChangedFields({ a: 'old' }, { a: 'new' })).toEqual({ a: 'new' });
  });

  it('ignores undefined next values', () => {
    expect(diffChangedFields({ a: 'old' }, { a: undefined })).toEqual({});
  });

  it('ignores absent next keys (no implicit delete)', () => {
    expect(diffChangedFields({ a: 'old' }, {})).toEqual({});
  });
});

describe('diffClearedFields', () => {
  it('returns empty when nothing was cleared', () => {
    expect(
      diffClearedFields(makeAlpaca(), { 'alpaca.apiKeyId': 'X' }, { 'alpaca.apiKeyId': 'X' }),
    ).toEqual([]);
  });

  it('captures keys cleared to empty string', () => {
    expect(
      diffClearedFields(makeAlpaca(), { 'alpaca.apiKeyId': 'X' }, { 'alpaca.apiKeyId': '' }),
    ).toEqual(['alpaca.apiKeyId']);
  });

  it('captures keys cleared to whitespace-only', () => {
    expect(
      diffClearedFields(makeAlpaca(), { 'alpaca.apiKeyId': 'X' }, { 'alpaca.apiKeyId': '   ' }),
    ).toEqual(['alpaca.apiKeyId']);
  });

  it('captures keys absent from next', () => {
    expect(diffClearedFields(makeAlpaca(), { 'alpaca.apiKeyId': 'X' }, {})).toEqual([
      'alpaca.apiKeyId',
    ]);
  });

  it('does not report newly added keys', () => {
    expect(diffClearedFields(makeAlpaca(), {}, { 'alpaca.apiKeyId': 'new' })).toEqual([]);
  });

  it('only considers fields declared on the contribution', () => {
    expect(
      diffClearedFields(
        makeAlpaca(),
        { 'alpaca.apiKeyId': 'X', 'extraneous.key': 'Y' },
        { 'alpaca.apiKeyId': '' },
      ),
    ).toEqual(['alpaca.apiKeyId']);
  });
});
