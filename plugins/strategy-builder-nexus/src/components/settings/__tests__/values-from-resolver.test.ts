/**
 * TICKET_646 Phase 6: Unit tests for valuesFrom resolution helpers.
 *
 * Covers `interpolateArgs` and `resolveValuesFrom` with full
 * line/branch coverage per CLAUDE.md TICKET_494 mandate.
 */
import { describe, it, expect } from 'vitest';
import {
  interpolateArgs,
  resolveValuesFrom,
} from '../values-from-resolver';
import type { LLMCatalogProvider, LLMCatalogModel } from '../../../hooks/useLLMCatalog';

// =============================================================================
// Fixtures
// =============================================================================

const SAMPLE_PROVIDERS: LLMCatalogProvider[] = [
  {
    id: 'OPENAI',
    name: 'OpenAI',
    defaultModel: 'gpt-5-mini',
    models: [
      { id: 'gpt-5.2', name: 'GPT-5.2' },
      { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
    ],
  },
  {
    id: 'CLAUDE',
    name: 'Claude (Anthropic)',
    defaultModel: 'claude-4-5-sonnet-latest',
    models: [
      { id: 'claude-4-5-opus-latest', name: 'Claude 4.5 Opus' },
      { id: 'claude-4-5-sonnet-latest', name: 'Claude 4.5 Sonnet' },
    ],
  },
];

function mockGetModels(providerId: string): LLMCatalogModel[] {
  const p = SAMPLE_PROVIDERS.find((x) => x.id === providerId.toUpperCase());
  return p ? p.models : [];
}

// =============================================================================
// interpolateArgs
// =============================================================================

describe('interpolateArgs', () => {
  it('returns empty object when args is undefined', () => {
    expect(interpolateArgs(undefined, {})).toEqual({});
  });

  it('interpolates {key} placeholders from currentValues', () => {
    const args = { provider: '{llm.selectedProvider}' };
    const values = { 'llm.selectedProvider': 'OPENAI' };
    expect(interpolateArgs(args, values)).toEqual({ provider: 'OPENAI' });
  });

  it('returns empty string for missing config values', () => {
    const args = { provider: '{llm.selectedProvider}' };
    expect(interpolateArgs(args, {})).toEqual({ provider: '' });
  });

  it('passes through literal values without interpolation', () => {
    const args = { mode: 'static-value' };
    expect(interpolateArgs(args, {})).toEqual({ mode: 'static-value' });
  });

  it('handles multiple args simultaneously', () => {
    const args = {
      provider: '{llm.selectedProvider}',
      tier: 'pro',
    };
    const values = { 'llm.selectedProvider': 'GEMINI' };
    expect(interpolateArgs(args, values)).toEqual({
      provider: 'GEMINI',
      tier: 'pro',
    });
  });

  it('converts non-string currentValues to string', () => {
    const args = { count: '{some.number}' };
    const values = { 'some.number': 42 };
    expect(interpolateArgs(args, values)).toEqual({ count: '42' });
  });
});

// =============================================================================
// resolveValuesFrom
// =============================================================================

describe('resolveValuesFrom', () => {
  it('returns null when valuesFrom is undefined', () => {
    expect(resolveValuesFrom(undefined, {}, SAMPLE_PROVIDERS, mockGetModels, false)).toBeNull();
  });

  it('returns null for unknown valuesFrom source', () => {
    expect(resolveValuesFrom('unknown:source', {}, SAMPLE_PROVIDERS, mockGetModels, false)).toBeNull();
  });

  describe('llm-catalog:providers', () => {
    it('resolves provider list to value/label pairs', () => {
      const result = resolveValuesFrom(
        'llm-catalog:providers',
        {},
        SAMPLE_PROVIDERS,
        mockGetModels,
        false,
      );
      expect(result).toEqual({
        options: [
          { value: 'OPENAI', label: 'OpenAI' },
          { value: 'CLAUDE', label: 'Claude (Anthropic)' },
        ],
        loading: false,
      });
    });

    it('returns empty options when catalog is empty', () => {
      const result = resolveValuesFrom(
        'llm-catalog:providers',
        {},
        [],
        mockGetModels,
        false,
      );
      expect(result).toEqual({ options: [], loading: false });
    });

    it('sets loading=true when catalog is loading', () => {
      const result = resolveValuesFrom(
        'llm-catalog:providers',
        {},
        SAMPLE_PROVIDERS,
        mockGetModels,
        true,
      );
      expect(result?.loading).toBe(true);
    });
  });

  describe('llm-catalog:models', () => {
    it('resolves models for a given provider', () => {
      const result = resolveValuesFrom(
        'llm-catalog:models',
        { provider: 'OPENAI' },
        SAMPLE_PROVIDERS,
        mockGetModels,
        false,
      );
      expect(result).toEqual({
        options: [
          { value: 'gpt-5.2', label: 'GPT-5.2' },
          { value: 'gpt-5-mini', label: 'GPT-5 Mini' },
        ],
        loading: false,
      });
    });

    it('returns empty options when provider arg is empty', () => {
      const result = resolveValuesFrom(
        'llm-catalog:models',
        { provider: '' },
        SAMPLE_PROVIDERS,
        mockGetModels,
        false,
      );
      expect(result).toEqual({ options: [], loading: false });
    });

    it('returns empty options when provider arg is missing', () => {
      const result = resolveValuesFrom(
        'llm-catalog:models',
        {},
        SAMPLE_PROVIDERS,
        mockGetModels,
        false,
      );
      expect(result).toEqual({ options: [], loading: false });
    });

    it('returns empty options for unknown provider', () => {
      const result = resolveValuesFrom(
        'llm-catalog:models',
        { provider: 'UNKNOWN' },
        SAMPLE_PROVIDERS,
        mockGetModels,
        false,
      );
      expect(result).toEqual({ options: [], loading: false });
    });

    it('sets loading=true when catalog is loading', () => {
      const result = resolveValuesFrom(
        'llm-catalog:models',
        { provider: 'CLAUDE' },
        SAMPLE_PROVIDERS,
        mockGetModels,
        true,
      );
      expect(result?.loading).toBe(true);
      expect(result?.options).toHaveLength(2);
    });
  });
});
