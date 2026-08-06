/**
 * TICKET_646 Phase 4: Unit tests for LLMSettingsPanel pure helpers.
 *
 * Covers `resolveBYOKModelOptions` and `isStoredModelStale` with full
 * line/branch coverage per CLAUDE.md TICKET_494 mandate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getIntlLocaleMock = vi.fn(() => 'en-US');

vi.mock('@shared/utils/format-locale', () => ({
  getIntlLocale: () => getIntlLocaleMock(),
}));

import {
  resolveBYOKModelOptions,
  isStoredModelStale,
  validateCustomModelId,
  formatSnapshotTimestamp,
} from '../llm-settings-helpers';
import type { LLMCatalogModel } from '../../../hooks/useLLMCatalog';

const SAMPLE_MODELS: LLMCatalogModel[] = [
  { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
  { id: 'gpt-5.2', name: 'GPT-5.2' },
];

describe('resolveBYOKModelOptions', () => {
  it('returns empty array when catalog is empty', () => {
    expect(resolveBYOKModelOptions([])).toEqual([]);
  });

  it('returns the same models when catalog is non-empty', () => {
    expect(resolveBYOKModelOptions(SAMPLE_MODELS)).toEqual(SAMPLE_MODELS);
  });
});

describe('isStoredModelStale', () => {
  it('returns false for PRO_CATALOG provider regardless of model', () => {
    expect(isStoredModelStale('PRO_CATALOG', 'any-model', SAMPLE_MODELS)).toBe(false);
  });

  it('returns false when selectedProvider is empty', () => {
    expect(isStoredModelStale('', 'gpt-5-mini', SAMPLE_MODELS)).toBe(false);
  });

  it('returns false when selectedModel is empty', () => {
    expect(isStoredModelStale('OPENAI', '', SAMPLE_MODELS)).toBe(false);
  });

  it('returns false when catalog is empty (loading or unauthenticated)', () => {
    expect(isStoredModelStale('OPENAI', 'gpt-5-mini', [])).toBe(false);
  });

  it('returns false when selectedModel is present in catalog', () => {
    expect(isStoredModelStale('OPENAI', 'gpt-5-mini', SAMPLE_MODELS)).toBe(false);
  });

  it('returns true when selectedModel is missing from a non-empty catalog', () => {
    expect(isStoredModelStale('OPENAI', 'gpt-removed', SAMPLE_MODELS)).toBe(true);
  });

  it('is case-sensitive on model id (catalog gpt-5-mini vs stored GPT-5-MINI)', () => {
    expect(isStoredModelStale('OPENAI', 'GPT-5-MINI', SAMPLE_MODELS)).toBe(true);
  });
});

describe('validateCustomModelId', () => {
  it('returns null for a valid model ID', () => {
    expect(validateCustomModelId('gpt-4o-2024-05-13')).toBeNull();
  });

  it('returns null for a valid ID with slashes and colons', () => {
    expect(validateCustomModelId('anthropic/claude-3.5-sonnet:latest')).toBeNull();
  });

  it('returns empty error for empty string', () => {
    expect(validateCustomModelId('')).toBe('llmSettings.customModelEmpty');
  });

  it('returns empty error for whitespace-only string', () => {
    expect(validateCustomModelId('   ')).toBe('llmSettings.customModelEmpty');
  });

  it('returns no-spaces error for ID containing spaces after trim', () => {
    expect(validateCustomModelId('gpt 4o')).toBe('llmSettings.customModelNoSpaces');
  });

  it('returns no-spaces error for ID with tab character', () => {
    expect(validateCustomModelId('gpt\t4o')).toBe('llmSettings.customModelNoSpaces');
  });

  it('returns ascii-only error for non-ASCII characters', () => {
    expect(validateCustomModelId('model-\u00e9')).toBe('llmSettings.customModelAsciiOnly');
  });

  it('returns ascii-only error for emoji in model ID', () => {
    expect(validateCustomModelId('model-\u{1F680}')).toBe('llmSettings.customModelAsciiOnly');
  });

  it('trims leading/trailing whitespace before validation', () => {
    expect(validateCustomModelId('  gpt-4o  ')).toBeNull();
  });

  it('accepts all ASCII printable non-space characters', () => {
    // ! through ~ (0x21-0x7E)
    expect(validateCustomModelId('!@#$%^&*()_+-=[]{}|;:,.<>?/~')).toBeNull();
  });
});

describe('formatSnapshotTimestamp', () => {
  beforeEach(() => {
    getIntlLocaleMock.mockReturnValue('en-US');
  });

  it('returns em-dash placeholder for null timestamp', () => {
    expect(formatSnapshotTimestamp(null)).toBe('\u2014');
  });

  it('routes through getIntlLocale (TICKET_315 dependency)', () => {
    getIntlLocaleMock.mockClear();
    formatSnapshotTimestamp(Date.UTC(2026, 0, 15, 12, 30));
    expect(getIntlLocaleMock).toHaveBeenCalled();
  });

  it('produces a non-empty formatted string for a valid timestamp', () => {
    const out = formatSnapshotTimestamp(Date.UTC(2026, 0, 15, 12, 30));
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('falls back to ISO string when Intl.DateTimeFormat throws', () => {
    getIntlLocaleMock.mockReturnValue('not-a-real-locale-tag');
    const ts = Date.UTC(2026, 0, 15, 12, 30);
    const original = Intl.DateTimeFormat;
    // Force the constructor path to throw so the catch branch runs.
    (Intl as unknown as { DateTimeFormat: unknown }).DateTimeFormat = function () {
      throw new RangeError('synthetic');
    };
    try {
      expect(formatSnapshotTimestamp(ts)).toBe(new Date(ts).toISOString());
    } finally {
      (Intl as unknown as { DateTimeFormat: unknown }).DateTimeFormat = original;
    }
  });
});
