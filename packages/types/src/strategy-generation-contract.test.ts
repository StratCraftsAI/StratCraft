import { describe, expect, it } from 'vitest';
import sdkCatalog from '../../builder-templates/data/stratforge_indicator_sdk.json';
import {
  DEFAULT_REGIME_STRATEGY_NAME,
  MAX_STRATEGY_INDICATOR_LIMIT,
  MAX_STRATEGY_NAME_LENGTH,
  REGIME_OPTIONS,
  STRATEGY_INDICATOR_CATALOG,
  STRATEGY_TEMPLATE_CATALOG,
  STRATEGY_GENERATION_ENDPOINT_PAIRS,
  STRATEGY_GENERATION_ENDPOINTS,
  findStrategyIndicator,
  getStrategyTemplate,
  isRegimeId,
  isStrategyGenerationEndpoint,
  isStrategyGenerationEndpointPair,
  listStrategyIndicators,
  buildRegimeStrategyGenerationRequest,
  buildVibingChatGenerationRequest,
  mapRegimeToCaseType,
  resolveStrategyIndicatorConfigurations,
  resolveRegimeStrategyName,
} from './strategy-generation-contract';

describe('strategy generation shared contract', () => {
  it('publishes the canonical Electron regime choices', () => {
    expect(REGIME_OPTIONS.map((option) => option.id)).toEqual([
      'trend',
      'range',
      'consolidation',
      'oscillation',
      'bespoke',
    ]);
    expect(isRegimeId('trend')).toBe(true);
    expect(isRegimeId('mean_reversion')).toBe(false);
  });

  it('ratifies unique Strategy Builder generation endpoint pairs', () => {
    expect(STRATEGY_GENERATION_ENDPOINT_PAIRS.length).toBeGreaterThan(0);
    expect(new Set(
      STRATEGY_GENERATION_ENDPOINT_PAIRS.map(({ start }) => start),
    ).size).toBe(STRATEGY_GENERATION_ENDPOINT_PAIRS.length);
    for (const { start, poll } of STRATEGY_GENERATION_ENDPOINT_PAIRS) {
      expect(isStrategyGenerationEndpointPair(start, poll)).toBe(true);
      expect(isStrategyGenerationEndpoint(start)).toBe(true);
      expect(isStrategyGenerationEndpoint(poll)).toBe(true);
    }
    expect(STRATEGY_GENERATION_ENDPOINTS.size)
      .toBe(STRATEGY_GENERATION_ENDPOINT_PAIRS.length * 2);
    expect(isStrategyGenerationEndpointPair(
      STRATEGY_GENERATION_ENDPOINT_PAIRS[0].start,
      STRATEGY_GENERATION_ENDPOINT_PAIRS[1].poll,
    )).toBe(false);
    expect(isStrategyGenerationEndpointPair('/api/unratified', '/api/unratified')).toBe(false);
    expect(isStrategyGenerationEndpoint('/api/unratified')).toBe(false);
  });

  it('keeps every offered indicator backed by the StratForge SDK mapping', () => {
    const known = new Set([
      ...Object.keys(sdkCatalog.indicators),
      ...Object.keys(sdkCatalog.slug_aliases),
    ]);
    const missing = STRATEGY_INDICATOR_CATALOG.filter((indicator) =>
      !known.has(indicator.slug)
      && !indicator.aliases.some((alias) => known.has(alias)));
    expect(missing.map((indicator) => indicator.slug)).toEqual([]);
  });

  it('resolves stable slugs through slug, display name, and alias', () => {
    expect(findStrategyIndicator('RSI')?.slug).toBe('RSI');
    expect(findStrategyIndicator('relative strength index')?.slug).toBe('RSI');
    expect(findStrategyIndicator('not-a-real-indicator')).toBeUndefined();
  });

  it('filters bounded recommendations by explicit regime compatibility', () => {
    const rows = listStrategyIndicators({
      regime: 'oscillation',
      recommended_only: true,
      limit: MAX_STRATEGY_INDICATOR_LIMIT + 100,
    });
    expect(rows.length).toBeLessThanOrEqual(MAX_STRATEGY_INDICATOR_LIMIT);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.category === 'oscillator')).toBe(true);
    expect(rows[0]).toEqual(expect.objectContaining({
      slug: expect.any(String),
      display_name: expect.any(String),
      parameter_defaults: expect.any(Object),
      supported_templates: expect.any(Array),
      output_lines: expect.any(Array),
    }));
  });

  it('supports category and case-insensitive search filters', () => {
    const rows = listStrategyIndicators({
      category: 'trend',
      search: 'aroon',
      recommended_only: false,
      limit: 10,
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.category === 'trend')).toBe(true);
    expect(rows.every((row) => row.slug.toLowerCase().includes('aroon')
      || row.display_name.toLowerCase().includes('aroon'))).toBe(true);
  });

  it('uses the shared default, preserves explicit names, and enforces max length', () => {
    expect(resolveRegimeStrategyName()).toBe(DEFAULT_REGIME_STRATEGY_NAME);
    expect(resolveRegimeStrategyName('  Explicit Name  ')).toBe('Explicit Name');
    expect(resolveRegimeStrategyName('x'.repeat(MAX_STRATEGY_NAME_LENGTH + 1)))
      .toHaveLength(MAX_STRATEGY_NAME_LENGTH);
    expect(resolveRegimeStrategyName(' ', ' ')).toBe(DEFAULT_REGIME_STRATEGY_NAME);
  });

  it('materializes SuperTrend defaults for strategy generation', () => {
    expect(resolveStrategyIndicatorConfigurations(['SuperTrend'])).toEqual([expect.objectContaining({
      slug: 'SuperTrend',
      display_name: 'SuperTrend',
      parameters: { period: 10, multiplier: 3 },
      template_key: 'crossover_price_indicator',
      rule_logic: 'crossover_price_indicator',
      output_lines: ['line', 'upper_band', 'lower_band'],
    })]);
  });

  it('publishes the shared Electron strategy-template presentation contract', () => {
    expect(STRATEGY_TEMPLATE_CATALOG.crossover_price_indicator).toEqual(expect.objectContaining({
      label: 'Price-Indicator Crossover',
      type: 'crossover',
      default_rule: expect.objectContaining({ operator: '>' }),
      rule_options: expect.objectContaining({
        operators: [
          { value: '>', label: 'Crosses Above (Long)' },
          { value: '<', label: 'Crosses Below (Short)' },
        ],
      }),
    }));
    expect(getStrategyTemplate('crossover_price_indicator')?.description)
      .toContain('Compares price');
    expect(getStrategyTemplate('missing')).toBeUndefined();
  });

  it('preserves edited indicator parameters and validates template support', () => {
    expect(resolveStrategyIndicatorConfigurations([{
      slug: 'SuperTrend',
      params: { period: 14 },
      template_key: 'crossover_price_indicator',
      rule_logic: 'crosses_above',
    }])[0]).toEqual(expect.objectContaining({
      parameters: { period: 14, multiplier: 3 },
      rule_logic: 'crosses_above',
    }));

    expect(() => resolveStrategyIndicatorConfigurations([{
      slug: 'SuperTrend',
      template_key: 'unsupported_template',
    }])).toThrow("Strategy indicator 'SuperTrend' does not support template 'unsupported_template'.");
  });

  it('fails before generation when a required parameter cannot be resolved', () => {
    expect(() => resolveStrategyIndicatorConfigurations([{
      slug: 'SuperTrend',
      params: { period: null },
    }])).toThrow("Strategy indicator 'SuperTrend' is missing required parameter 'period'.");
  });

  it('builds the production market-regime request with resolved indicator metadata', () => {
    const indicators = resolveStrategyIndicatorConfigurations(['SuperTrend']);
    const request = buildRegimeStrategyGenerationRequest({
      regime: 'trend',
      indicators,
      strategyName: 'Trend Detector',
      llmProvider: 'CLAUDE',
      llmModel: 'claude-test',
      locale: 'en_US',
      apiKey: 'secret',
    });

    expect(request).toEqual(expect.objectContaining({
      strategy_name: 'Trend Detector',
      output_format: 'v3',
      storage_mode: 'local',
      language: 'cpp',
      auto_reverse: true,
      llm_api_key: 'secret',
      analysis_config: expect.objectContaining({
        auto_reverse: true,
        regime: [{
          case_type: 'TREND_DETECTION',
          params: {
            indicators: [expect.objectContaining({
              type: 'supertrend',
              name: 'SuperTrend',
              params: { period: 10, multiplier: 3 },
              template_key: 'crossover_price_indicator',
              rule_logic: 'crossover_price_indicator',
              output_lines: ['line', 'upper_band', 'lower_band'],
            })],
            factors: [],
          },
        }],
        llm_config: expect.objectContaining({
          provider: 'claude',
          model: 'claude-test',
          prompt: expect.stringContaining('SuperTrend(period=10, multiplier=3)'),
        }),
      }),
    }));
  });

  it('propagates manual signal mode through both backend contract locations', () => {
    const indicators = resolveStrategyIndicatorConfigurations([
      { slug: 'SuperTrend', category: 'trend' },
      { slug: 'RSI', category: 'range' },
    ]);
    const request = buildRegimeStrategyGenerationRequest({
      regime: 'trend',
      indicators,
      strategyName: 'Manual Trend Detector',
      llmProvider: 'CLAUDE',
      llmModel: 'claude-test',
      locale: 'en_US',
      autoReverse: false,
    });

    expect(request.auto_reverse).toBe(false);
    expect((request.analysis_config as Record<string, unknown>).auto_reverse).toBe(false);
    expect(
      ((request.analysis_config as {
        regime: Array<{ params: { indicators: Array<{ category: string }> } }>;
      }).regime[0].params.indicators).map((indicator) => indicator.category),
    ).toEqual(['trend', 'range']);
  });

  it('fails before generation when manual mode lacks either regime category', () => {
    expect(() => buildRegimeStrategyGenerationRequest({
      regime: 'trend',
      indicators: resolveStrategyIndicatorConfigurations([
        { slug: 'SuperTrend', category: 'trend' },
      ]),
      strategyName: 'Invalid Manual Detector',
      llmProvider: 'CLAUDE',
      llmModel: 'claude-test',
      locale: 'en_US',
      autoReverse: false,
    })).toThrow('Missing: range');
  });

  it('keeps bespoke backend case types aligned with the Electron request builder', () => {
    expect(mapRegimeToCaseType('bespoke')).toBe('BESPOKE');
    expect(mapRegimeToCaseType('bespoke_custom')).toBe('bespoke_custom');
  });

  it('builds the canonical Vibing Chat payload with trusted execution context', () => {
    expect(buildVibingChatGenerationRequest({
      taskId: 'vibe-1',
      sessionId: 'session-1',
      message: 'extract Larry Williams strategy',
      strategyName: 'Larry Williams',
      llmProvider: 'CLAUDE',
      llmModel: 'claude-test',
      locale: 'en_US',
      apiKey: 'trusted-key',
      currentStrategyRules: { status: 'PARTIAL' },
    })).toEqual({
      task_id: 'vibe-1',
      session_id: 'session-1',
      message: 'extract Larry Williams strategy',
      locale: 'en_US',
      model: 'claude',
      llm_model: 'claude-test',
      output_format: 'v3',
      storage_mode: 'local',
      strategy_name: 'Larry Williams',
      metadata: { mode: 'generator' },
      llm_api_key: 'trusted-key',
      current_strategy_rules: { status: 'PARTIAL' },
    });
  });

  it('omits optional Vibing Chat secrets and rules when unavailable', () => {
    const request = buildVibingChatGenerationRequest({
      taskId: 'vibe-2',
      sessionId: 'session-2',
      message: '<generate_code>',
      llmProvider: 'PRO_CATALOG',
      llmModel: 'plan-model',
      locale: 'zh_CN',
    });

    expect(request.strategy_name).toBe('');
    expect(request).not.toHaveProperty('llm_api_key');
    expect(request).not.toHaveProperty('current_strategy_rules');
  });
});
