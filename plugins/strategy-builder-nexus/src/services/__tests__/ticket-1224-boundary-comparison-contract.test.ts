/**
 * TICKET_1224: boundary_comparison contract tests.
 *
 * Recurrence guard for the frontend indicator-catalog drift that let
 * unbounded oscillators (PriceOscillator/APO, MACD, Momentum, ...) claim the
 * "Oscillator Overbought/Oversold" template. The template references
 * threshold_param `upperband` / `lowerband`, which must be params the
 * indicator actually defines — otherwise the backend LLM checker rejects the
 * generation request as a fatal error.
 */

import { describe, it, expect } from 'vitest';

import {
  STRATEGY_INDICATOR_CATALOG as indicatorCatalog,
  STRATEGY_TEMPLATE_CATALOG as templateLibrary,
} from '@StratCraft/types';
import {
  BOUNDARY_COMPARISON_TEMPLATE_KEY,
  checkBoundaryThresholdParam,
  resolveBoundaryThresholdParam,
} from '../strategy-logic-contract';

interface CatalogIndicatorEntry {
  slug: string;
  params?: Array<{ name: string }>;
  template_keys?: string[];
}

const catalog = indicatorCatalog as CatalogIndicatorEntry[];

const claimingIndicators = catalog.filter((entry) =>
  (entry.template_keys ?? []).includes(BOUNDARY_COMPARISON_TEMPLATE_KEY),
);

describe('TICKET_1224 catalog contract: boundary_comparison_oscillator', () => {
  it('has at least one indicator claiming the template (RSI family present)', () => {
    const slugs = claimingIndicators.map((entry) => entry.slug);
    expect(slugs).toContain('RSI');
    expect(slugs).toContain('Stochastic');
  });

  it('every claiming indicator defines upperband AND lowerband params', () => {
    const violators = claimingIndicators
      .filter((entry) => {
        const paramNames = new Set((entry.params ?? []).map((param) => param.name));
        return !paramNames.has('upperband') || !paramNames.has('lowerband');
      })
      .map((entry) => entry.slug);
    expect(violators).toEqual([]);
  });

  it('template threshold_param_options are satisfiable by every claiming indicator', () => {
    const template = (
      templateLibrary as Record<
        string,
        { rule_options?: { threshold_param_options?: string[] } }
      >
    )[BOUNDARY_COMPARISON_TEMPLATE_KEY];
    expect(template).toBeDefined();
    const options = template.rule_options?.threshold_param_options ?? [];
    expect(options.length).toBeGreaterThan(0);

    for (const entry of claimingIndicators) {
      const paramNames = new Set((entry.params ?? []).map((param) => param.name));
      for (const option of options) {
        expect(
          paramNames.has(option),
          `${entry.slug} is missing threshold_param option "${option}"`,
        ).toBe(true);
      }
    }
  });

  it('known unbounded oscillators do NOT claim the template', () => {
    const unbounded = [
      'PriceOscillator',
      'MACD',
      'MACDHisto',
      'Momentum',
      'ROC',
      'TRIX',
      'AwesomeOscillator',
      'DetrendedPriceOscillator',
    ];
    const offenders = claimingIndicators
      .map((entry) => entry.slug)
      .filter((slug) => unbounded.includes(slug));
    expect(offenders).toEqual([]);
  });
});

describe('TICKET_1224 resolveBoundaryThresholdParam', () => {
  it('keeps an explicit threshold_param', () => {
    expect(resolveBoundaryThresholdParam('>', 'lowerband')).toBe('lowerband');
  });

  it('defaults by operator direction', () => {
    expect(resolveBoundaryThresholdParam('>', undefined)).toBe('upperband');
    expect(resolveBoundaryThresholdParam('<', undefined)).toBe('lowerband');
    expect(resolveBoundaryThresholdParam(undefined, undefined)).toBe('upperband');
  });
});

describe('TICKET_1224 checkBoundaryThresholdParam (fail-fast validation)', () => {
  const boundaryRule = (slug: string, operator = '>', thresholdParam?: string) => ({
    indicator: { slug, name: slug },
    strategy: {
      logic: {
        type: BOUNDARY_COMPARISON_TEMPLATE_KEY,
        operator,
        threshold_param: thresholdParam,
      },
    },
  });

  it('rejects PriceOscillator + upperband (the live incident)', () => {
    const violation = checkBoundaryThresholdParam(boundaryRule('PriceOscillator'));
    expect(violation).not.toBeNull();
    expect(violation?.error).toBe('MSG_BUILDER_VALIDATION_THRESHOLD_PARAM_UNSUPPORTED');
    expect(violation?.errorParams).toEqual({
      indicator: 'PriceOscillator',
      thresholdParam: 'upperband',
    });
  });

  it('rejects MACD + lowerband (operator < default)', () => {
    const violation = checkBoundaryThresholdParam(boundaryRule('MACD', '<'));
    expect(violation?.errorParams?.thresholdParam).toBe('lowerband');
  });

  it('accepts RSI + upperband', () => {
    expect(checkBoundaryThresholdParam(boundaryRule('RSI'))).toBeNull();
  });

  it('accepts every catalog indicator that claims the template', () => {
    for (const entry of claimingIndicators) {
      expect(
        checkBoundaryThresholdParam(boundaryRule(entry.slug)),
        `${entry.slug} should pass its own claimed template`,
      ).toBeNull();
      expect(
        checkBoundaryThresholdParam(boundaryRule(entry.slug, '<')),
        `${entry.slug} should pass with lowerband too`,
      ).toBeNull();
    }
  });

  it('ignores non-boundary rules', () => {
    expect(
      checkBoundaryThresholdParam({
        indicator: { slug: 'MACD', name: 'MACD' },
        strategy: { logic: { type: 'threshold_simple', operator: '>' } },
      }),
    ).toBeNull();
  });

  it('ignores rules without an indicator (handled by dedicated validation)', () => {
    expect(
      checkBoundaryThresholdParam({
        strategy: { logic: { type: BOUNDARY_COMPARISON_TEMPLATE_KEY, operator: '>' } },
      }),
    ).toBeNull();
  });

  it('accepts the mapped backend type form (boundary_comparison)', () => {
    const violation = checkBoundaryThresholdParam({
      indicator: { slug: 'PriceOscillator', name: 'Price Oscillator' },
      strategy: { logic: { type: 'boundary_comparison', operator: '>' } },
    });
    expect(violation).not.toBeNull();
    expect(violation?.errorParams?.indicator).toBe('Price Oscillator');
  });
});
