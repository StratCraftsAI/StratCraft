/**
 * TICKET_1227: duplicate indicator selection contract tests.
 *
 * A duplicate (same indicator + same effective params + same rule settings)
 * is marked live in the selector UI (findDuplicateBlockIds) and refused by
 * every validate*Config gate before the generation API is called. Same
 * indicator with different params / rule logic / field / direction is
 * legitimate and must never be flagged.
 */

import { describe, it, expect } from 'vitest';

import {
  DUPLICATE_INDICATOR_ERROR_KEY,
  canonicalJsonStringify,
  computeIndicatorBlockFingerprint,
  buildParamDefaultsIndex,
  findDuplicateBlockIds,
  checkDuplicateTemplateRules,
  checkDuplicateRawIndicatorBlocks,
  checkDuplicateRiskRules,
} from '../indicator-duplicate-contract';
import { validateMarketRegimeConfig } from '../market-regime-service';
import { validateKronosIndicatorEntryConfig } from '../kronos-indicator-entry-service';
import { validateRegimeIndicatorEntryConfig } from '../regime-indicator-entry-service';
import { validateMarketObserverConfig } from '../market-observer-service';
import { validateKronosAIEntryConfig } from '../kronos-ai-entry-service';
import { validateTraderAIEntryConfig } from '../trader-ai-entry-service';
import { validateAILiberoConfig } from '../ai-libero-service';
import { validateRiskOverrideExitConfig } from '../risk-override-exit-service';
import type { RegimeDetectionRule } from '../risk-override-exit-service';

// -----------------------------------------------------------------------------
// canonicalJsonStringify
// -----------------------------------------------------------------------------

describe('canonicalJsonStringify', () => {
  it('is invariant to object key insertion order', () => {
    expect(canonicalJsonStringify({ a: 1, b: 2 })).toBe(canonicalJsonStringify({ b: 2, a: 1 }));
  });

  it('sorts keys recursively in nested objects', () => {
    expect(canonicalJsonStringify({ x: { b: 1, a: [{ d: 4, c: 3 }] } })).toBe(
      '{"x":{"a":[{"c":3,"d":4}],"b":1}}',
    );
  });

  it('drops undefined-valued keys and keeps null', () => {
    expect(canonicalJsonStringify({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it('handles primitives and arrays', () => {
    expect(canonicalJsonStringify(5)).toBe('5');
    expect(canonicalJsonStringify('s')).toBe('"s"');
    expect(canonicalJsonStringify(null)).toBe('null');
    expect(canonicalJsonStringify([1, 'a'])).toBe('[1,"a"]');
  });
});

// -----------------------------------------------------------------------------
// UI layer: block fingerprints
// -----------------------------------------------------------------------------

const CATALOG = [
  { slug: 'RSI', params: [{ name: 'period', default: 14 }, { name: 'upperband', default: 70 }] },
  { slug: 'SMA', params: [{ name: 'period', default: 20 }] },
];

const rsiBlock = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  indicatorSlug: 'RSI',
  paramValues: { period: 14, upperband: 70 } as Record<string, number | string>,
  templateKey: 'boundary_comparison_oscillator',
  ruleOperator: '>',
  ruleThresholdValue: 70,
  ...overrides,
});

describe('findDuplicateBlockIds (selector UI layer)', () => {
  it('flags every member of an identical pair', () => {
    const ids = findDuplicateBlockIds([rsiBlock('a'), rsiBlock('b')], CATALOG);
    expect(ids).toEqual(new Set(['a', 'b']));
  });

  it('never flags blocks without an indicator selected', () => {
    const blank = { id: 'x', indicatorSlug: null, paramValues: {} };
    const ids = findDuplicateBlockIds([blank, { ...blank, id: 'y' }], CATALOG);
    expect(ids.size).toBe(0);
  });

  it('does not flag same indicator with a different param value', () => {
    const ids = findDuplicateBlockIds(
      [rsiBlock('a'), rsiBlock('b', { paramValues: { period: 7, upperband: 70 } })],
      CATALOG,
    );
    expect(ids.size).toBe(0);
  });

  it('does not flag same indicator with different rule threshold/operator', () => {
    expect(
      findDuplicateBlockIds([rsiBlock('a'), rsiBlock('b', { ruleThresholdValue: 30 })], CATALOG).size,
    ).toBe(0);
    expect(
      findDuplicateBlockIds([rsiBlock('a'), rsiBlock('b', { ruleOperator: '<' })], CATALOG).size,
    ).toBe(0);
  });

  it('treats untouched defaults and explicitly-set defaults as equal (effective params)', () => {
    const untouched = rsiBlock('a', { paramValues: {} });
    const explicit = rsiBlock('b', { paramValues: { period: 14, upperband: 70 } });
    expect(findDuplicateBlockIds([untouched, explicit], CATALOG)).toEqual(new Set(['a', 'b']));
  });

  it('is invariant to param key order', () => {
    const a = rsiBlock('a', { paramValues: { period: 14, upperband: 70 } });
    const b = rsiBlock('b', { paramValues: { upperband: 70, period: 14 } });
    expect(findDuplicateBlockIds([a, b], CATALOG)).toEqual(new Set(['a', 'b']));
  });

  it('distinguishes raw blocks by OHLCV field', () => {
    const close = { id: 'a', indicatorSlug: 'SMA', field: 'close', paramValues: { period: 20 } };
    const volume = { ...close, id: 'b', field: 'volume' };
    expect(findDuplicateBlockIds([close, volume], CATALOG).size).toBe(0);
    expect(findDuplicateBlockIds([close, { ...close, id: 'b' }], CATALOG)).toEqual(
      new Set(['a', 'b']),
    );
  });

  it('distinguishes directional blocks by direction', () => {
    const long = rsiBlock('a', { direction: 'long' });
    const short = rsiBlock('b', { direction: 'short' });
    expect(findDuplicateBlockIds([long, short], CATALOG).size).toBe(0);
  });

  it('clears when one of the pair is re-parameterized or removed', () => {
    const pair = [rsiBlock('a'), rsiBlock('b')];
    expect(findDuplicateBlockIds(pair, CATALOG).size).toBe(2);
    const reparam = [pair[0], rsiBlock('b', { paramValues: { period: 7, upperband: 70 } })];
    expect(findDuplicateBlockIds(reparam, CATALOG).size).toBe(0);
    expect(findDuplicateBlockIds([pair[0]], CATALOG).size).toBe(0);
  });

  it('computeIndicatorBlockFingerprint returns null without a slug', () => {
    expect(
      computeIndicatorBlockFingerprint(
        { id: 'x', indicatorSlug: null, paramValues: {} },
        buildParamDefaultsIndex(CATALOG),
      ),
    ).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Validation layer: rule/config duplicate checks
// -----------------------------------------------------------------------------

const templateRule = (overrides: Record<string, unknown> = {}) => ({
  rule_type: 'template_based' as const,
  indicator: { slug: 'RSI', name: 'RSI', params: { period: 14 } as Record<string, unknown> },
  strategy: { logic: { type: 'threshold_level', operator: '>', threshold_value: 70 } },
  ...overrides,
});

describe('checkDuplicateTemplateRules', () => {
  it('reports the colliding indicator on an identical pair', () => {
    const violation = checkDuplicateTemplateRules([templateRule(), templateRule()]);
    expect(violation).toEqual({
      error: DUPLICATE_INDICATOR_ERROR_KEY,
      errorParams: { indicator: 'RSI' },
    });
  });

  it('accepts same indicator + params with different logic', () => {
    const overbought = templateRule();
    const oversold = templateRule({
      strategy: { logic: { type: 'threshold_level', operator: '<', threshold_value: 30 } },
    });
    expect(checkDuplicateTemplateRules([overbought, oversold])).toBeNull();
  });

  it('ignores custom_expression and slug-less rules', () => {
    const expr = { rule_type: 'custom_expression', expression: 'close > open' };
    expect(checkDuplicateTemplateRules([expr, expr])).toBeNull();
  });
});

describe('checkDuplicateRawIndicatorBlocks', () => {
  const raw = (overrides: Record<string, unknown> = {}) => ({
    indicatorSlug: 'SMA',
    field: 'close',
    paramValues: { period: 20 } as Record<string, unknown>,
    ...overrides,
  });

  it('reports an identical pair', () => {
    expect(checkDuplicateRawIndicatorBlocks([raw(), raw()])).toEqual({
      error: DUPLICATE_INDICATOR_ERROR_KEY,
      errorParams: { indicator: 'SMA' },
    });
  });

  it('accepts same indicator on a different field or with different params', () => {
    expect(checkDuplicateRawIndicatorBlocks([raw(), raw({ field: 'volume' })])).toBeNull();
    expect(checkDuplicateRawIndicatorBlocks([raw(), raw({ paramValues: { period: 50 } })])).toBeNull();
  });

  it('ignores blocks without an indicator selected', () => {
    const blank = { indicatorSlug: null, field: 'close', paramValues: {} };
    expect(checkDuplicateRawIndicatorBlocks([blank, blank])).toBeNull();
  });
});

const regimeRule = (id: string, overrides: Partial<RegimeDetectionRule> = {}): RegimeDetectionRule => ({
  id,
  enabled: true,
  priority: 1,
  type: 'regime_detection',
  indicator: { name: 'ADX', parameters: { period: 14 } },
  condition: '>',
  threshold: 25,
  action: 'reduce_all',
  reducePercent: 50,
  recovery: 'auto',
  ...overrides,
});

describe('checkDuplicateRiskRules', () => {
  it('flags rules identical apart from id and priority', () => {
    expect(checkDuplicateRiskRules([regimeRule('r1'), regimeRule('r2', { priority: 9 })])).toEqual({
      error: DUPLICATE_INDICATOR_ERROR_KEY,
      errorParams: { indicator: 'ADX' },
    });
  });

  it('accepts rules differing in any semantic field', () => {
    expect(checkDuplicateRiskRules([regimeRule('r1'), regimeRule('r2', { threshold: 30 })])).toBeNull();
    expect(
      checkDuplicateRiskRules([regimeRule('r1'), regimeRule('r2', { action: 'close_all' })]),
    ).toBeNull();
  });

  it('names the rule type when the rule has no indicator', () => {
    const cb = {
      id: 'c1',
      enabled: true,
      priority: 1,
      type: 'circuit_breaker',
      triggerPnlPercent: -5,
      scope: 'portfolio',
      action: 'close_all',
      cooldownBars: 10,
    };
    expect(checkDuplicateRiskRules([cb, { ...cb, id: 'c2' }])).toEqual({
      error: DUPLICATE_INDICATOR_ERROR_KEY,
      errorParams: { indicator: 'circuit_breaker' },
    });
  });
});

// -----------------------------------------------------------------------------
// validate*Config integration: every gate refuses a duplicate pair
// -----------------------------------------------------------------------------

describe('validate*Config duplicate gates', () => {
  const expectDuplicateRefusal = (result: {
    valid: boolean;
    error?: string;
    errorParams?: Record<string, unknown>;
  }, indicator: string) => {
    expect(result.valid).toBe(false);
    expect(result.error).toBe(DUPLICATE_INDICATOR_ERROR_KEY);
    expect(result.errorParams).toEqual({ indicator });
  };

  it('validateMarketRegimeConfig refuses duplicate rules', () => {
    expectDuplicateRefusal(
      validateMarketRegimeConfig({
        llm_provider: 'anthropic',
        regime: 'trend',
        rules: [templateRule(), templateRule()],
      } as Parameters<typeof validateMarketRegimeConfig>[0]),
      'RSI',
    );
  });

  it('validateKronosIndicatorEntryConfig refuses duplicate rules', () => {
    expectDuplicateRefusal(
      validateKronosIndicatorEntryConfig({
        rules: [templateRule(), templateRule()],
      } as Parameters<typeof validateKronosIndicatorEntryConfig>[0]),
      'RSI',
    );
  });

  it('validateRegimeIndicatorEntryConfig refuses duplicate rules', () => {
    expectDuplicateRefusal(
      validateRegimeIndicatorEntryConfig({
        llm_provider: 'anthropic',
        rules: [templateRule(), templateRule()],
      } as Parameters<typeof validateRegimeIndicatorEntryConfig>[0]),
      'RSI',
    );
  });

  it('validateMarketObserverConfig refuses duplicate rules', () => {
    const rule = templateRule({
      indicator: { slug: 'ADX', name: 'ADX', params: { period: 14 } },
    });
    expectDuplicateRefusal(
      validateMarketObserverConfig({
        llm_provider: 'anthropic',
        rules: [rule, rule] as never,
      } as Parameters<typeof validateMarketObserverConfig>[0]),
      'ADX',
    );
  });

  const rawIndicatorPair = [
    { id: 'a', indicatorSlug: 'SMA', field: 'close', paramValues: { period: 20 } },
    { id: 'b', indicatorSlug: 'SMA', field: 'close', paramValues: { period: 20 } },
  ];
  const prompt = 'A prompt long enough to pass the minimum length validation.';

  it('validateKronosAIEntryConfig refuses duplicate indicators', () => {
    expectDuplicateRefusal(
      validateKronosAIEntryConfig({
        prompt,
        indicators: rawIndicatorPair,
      } as Parameters<typeof validateKronosAIEntryConfig>[0]),
      'SMA',
    );
  });

  it('validateTraderAIEntryConfig refuses duplicate indicators', () => {
    expectDuplicateRefusal(
      validateTraderAIEntryConfig({
        prompt,
        indicators: rawIndicatorPair,
      } as Parameters<typeof validateTraderAIEntryConfig>[0]),
      'SMA',
    );
  });

  it('validateAILiberoConfig refuses duplicate indicators', () => {
    expectDuplicateRefusal(
      validateAILiberoConfig({
        prompt,
        indicators: rawIndicatorPair,
      } as Parameters<typeof validateAILiberoConfig>[0]),
      'SMA',
    );
  });

  it('validateRiskOverrideExitConfig refuses duplicate enabled rules', () => {
    expectDuplicateRefusal(
      validateRiskOverrideExitConfig({
        rules: [regimeRule('r1'), regimeRule('r2', { priority: 2 })],
        hard_safety: { max_loss_percent: -10 },
      } as Parameters<typeof validateRiskOverrideExitConfig>[0]),
      'ADX',
    );
  });

  it('gates still accept non-duplicate configs', () => {
    const distinct = validateKronosIndicatorEntryConfig({
      rules: [
        templateRule(),
        templateRule({
          strategy: { logic: { type: 'threshold_level', operator: '<', threshold_value: 30 } },
        }),
      ],
    } as Parameters<typeof validateKronosIndicatorEntryConfig>[0]);
    expect(distinct.valid).toBe(true);
  });
});
