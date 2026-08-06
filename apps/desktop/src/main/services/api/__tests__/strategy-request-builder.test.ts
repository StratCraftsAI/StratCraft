/**
 * Strategy Request Builder Unit Tests
 *
 * TICKET_494: Full coverage for strategy-request-builder.ts
 * Covers mapRegimeToCaseType and buildServerRequest (pure functions, no mocks needed).
 */

import { describe, it, expect, vi } from 'vitest';

import { mapRegimeToCaseType, buildServerRequest } from '../strategy-request-builder';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('strategy-request-builder', () => {
  // =========================================================================
  // mapRegimeToCaseType
  // =========================================================================

  describe('mapRegimeToCaseType', () => {
    it('maps "trend" to "TREND_DETECTION"', () => {
      expect(mapRegimeToCaseType('trend')).toBe('TREND_DETECTION');
    });

    it('maps "range" to "RANGE_DETECTION"', () => {
      expect(mapRegimeToCaseType('range')).toBe('RANGE_DETECTION');
    });

    it('maps "consolidation" to "CONSOLIDATION_DETECTION"', () => {
      expect(mapRegimeToCaseType('consolidation')).toBe('CONSOLIDATION_DETECTION');
    });

    it('maps "oscillation" to "OSCILLATION_DETECTION"', () => {
      expect(mapRegimeToCaseType('oscillation')).toBe('OSCILLATION_DETECTION');
    });

    it('passes through bespoke_ prefixed values unchanged', () => {
      expect(mapRegimeToCaseType('bespoke_custom_regime')).toBe('bespoke_custom_regime');
    });

    it('passes through bespoke_x unchanged', () => {
      expect(mapRegimeToCaseType('bespoke_x')).toBe('bespoke_x');
    });

    it('uppercases unknown regime types', () => {
      expect(mapRegimeToCaseType('momentum')).toBe('MOMENTUM');
    });

    it('uppercases arbitrary strings', () => {
      expect(mapRegimeToCaseType('mean_reversion')).toBe('MEAN_REVERSION');
    });
  });

  // =========================================================================
  // buildServerRequest
  // =========================================================================

  describe('buildServerRequest', () => {
    it('builds correct structure with required params only', () => {
      const result = buildServerRequest({
        regime: 'trend',
        indicators: ['RSI', 'MACD'],
        strategy_name: 'My Strategy',
      });

      expect(result.strategy_name).toBe('My Strategy');
      // TICKET_1220: code generation locale is always en_US (TICKET_850)
      expect(result.locale).toBe('en_US');
      expect(result.output_format).toBe('v3');
      expect(result.storage_mode).toBe('local');
      expect(result.auto_reverse).toBe(true);

      // analysis_config
      const config = result.analysis_config as any;
      expect(config.regime).toHaveLength(1);
      expect(config.regime[0].case_type).toBe('TREND_DETECTION');
      expect(config.regime[0].params.indicators).toEqual([
        { type: 'rsi', name: 'RSI' },
        { type: 'macd', name: 'MACD' },
      ]);
      expect(config.regime[0].params.factors).toEqual([]);
      expect(config.auto_reverse).toBe(true);

      // LLM defaults: toApiProvider('') returns '', model stays undefined
      expect(config.llm_config.provider).toBe('');
      expect(config.llm_config.model).toBeUndefined();

      // Prompt without preference
      expect(config.llm_config.prompt).toContain('trend');
      expect(config.llm_config.prompt).toContain('RSI AND MACD');

      // No persona or preference keys
      expect(result).not.toHaveProperty('persona');
      expect(result).not.toHaveProperty('preference');
    });

    it('includes persona when provided', () => {
      const result = buildServerRequest({
        regime: 'range',
        indicators: ['Bollinger'],
        strategy_name: 'Test',
        persona: 'swing_trader',
      });

      expect(result.persona).toBe('swing_trader');
    });

    it('includes preference when provided and uses it in prompt', () => {
      const result = buildServerRequest({
        regime: 'trend',
        indicators: ['EMA'],
        strategy_name: 'Test',
        preference: 'Conservative approach',
      });

      expect(result.preference).toBe('Conservative approach');

      const config = result.analysis_config as any;
      expect(config.llm_config.prompt).toContain('Conservative approach');
      expect(config.llm_config.prompt).toContain('EMA');
    });

    it('uses custom llm_provider and llm_model', () => {
      const result = buildServerRequest({
        regime: 'trend',
        indicators: ['RSI'],
        strategy_name: 'Test',
        llm_provider: 'OPENAI',
        llm_model: 'gpt-4',
      });

      const config = result.analysis_config as any;
      expect(config.llm_config.provider).toBe('openai');
      expect(config.llm_config.model).toBe('gpt-4');
    });

    it('lowercases indicator type but preserves name', () => {
      const result = buildServerRequest({
        regime: 'trend',
        indicators: ['BOLLINGER_BANDS', 'ADX'],
        strategy_name: 'Test',
      });

      const config = result.analysis_config as any;
      expect(config.regime[0].params.indicators).toEqual([
        { type: 'bollinger_bands', name: 'BOLLINGER_BANDS' },
        { type: 'adx', name: 'ADX' },
      ]);
    });

    it('handles single indicator', () => {
      const result = buildServerRequest({
        regime: 'range',
        indicators: ['RSI'],
        strategy_name: 'Single',
      });

      const config = result.analysis_config as any;
      expect(config.regime[0].params.indicators).toHaveLength(1);
      expect(config.llm_config.prompt).toContain('RSI');
    });

    it('handles empty indicators array', () => {
      const result = buildServerRequest({
        regime: 'trend',
        indicators: [],
        strategy_name: 'Empty',
      });

      const config = result.analysis_config as any;
      expect(config.regime[0].params.indicators).toEqual([]);
    });

    it('uses bespoke regime type directly as case_type', () => {
      const result = buildServerRequest({
        regime: 'bespoke_my_custom',
        indicators: ['RSI'],
        strategy_name: 'Bespoke Test',
      });

      const config = result.analysis_config as any;
      expect(config.regime[0].case_type).toBe('bespoke_my_custom');
    });

    it('formats regime label with spaces for prompt', () => {
      const result = buildServerRequest({
        regime: 'mean_reversion',
        indicators: ['RSI'],
        strategy_name: 'Test',
      });

      const config = result.analysis_config as any;
      expect(config.llm_config.prompt).toContain('mean reversion');
    });
  });
});
