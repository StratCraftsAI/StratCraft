import { describe, expect, it } from 'vitest';

import { validateMarketObserverConfig } from '../market-observer-service';
import {
  filterIndicatorsForContext,
  isWatchlistSupportedIndicator,
  isWatchlistSupportedIndicatorSlug,
} from '../watchlist-indicator-support';

describe('TICKET_689 watchlist indicator support', () => {
  // Category C: genuinely unsupported -- no Backtrader equivalent at all
  const genuinelyUnsupported = [
    'AllN',
    'AnyN',
    'FindFirstIndexHighest',
    'FindFirstIndexLowest',
    'FindLastIndexHighest',
    'FindLastIndexLowest',
    'Oscillator',
    'WeightedAverage',
    'haDelta',
  ];

  // Category B: approximate slug matches (DEMAOscillator -> DEMAOsc) -- LLM resolves these
  const approximateMatches = [
    'DEMAOscillator',
    'DMAOscillator',
    'HMAOscillator',
    'MA',
    'SMMAOscillator',
    'TEMAOscillator',
    'WMAOscillator',
    'ZLEMAOscillator',
    'ZLIndicatorEnvelope',
  ];

  // Additional confirmed supported slugs
  const confirmedSupported = [
    'AccDeOsc',
    'ZeroLagIndicatorOsc',
  ];

  it('accepts indicator slugs that map to backtrader aliases', () => {
    expect(isWatchlistSupportedIndicatorSlug('ATR')).toBe(true);
    expect(isWatchlistSupportedIndicatorSlug('PriceOscillator')).toBe(true);
    for (const slug of confirmedSupported) {
      expect(isWatchlistSupportedIndicatorSlug(slug)).toBe(true);
    }
  });

  it('accepts approximate-match slugs that LLM can resolve (Category B)', () => {
    for (const slug of approximateMatches) {
      expect(isWatchlistSupportedIndicatorSlug(slug)).toBe(true);
    }
  });

  it('rejects watchlist indicators with no backtrader equivalent', () => {
    expect(isWatchlistSupportedIndicatorSlug('ChandelierExit')).toBe(false);
    expect(isWatchlistSupportedIndicatorSlug('SuperTrend')).toBe(false);
    for (const slug of genuinelyUnsupported) {
      expect(isWatchlistSupportedIndicatorSlug(slug)).toBe(false);
    }
  });

  it('prefers explicit targets.nonabt metadata when present', () => {
    expect(
      isWatchlistSupportedIndicator({
        slug: 'CustomIndicator',
        targets: { nonabt: { class_name: 'CustomIndicator' } },
      }),
    ).toBe(true);
  });

  it('filters unsupported indicators from watchlist context only', () => {
    const indicators = [
      { slug: 'ATR' },
      { slug: 'ChandelierExit' },
      { slug: 'RSI' },
    ];

    expect(filterIndicatorsForContext(indicators, 'watchlist')).toEqual([
      { slug: 'ATR' },
      { slug: 'RSI' },
    ]);
    expect(filterIndicatorsForContext(indicators, 'backtest')).toEqual(indicators);
  });

  it('blocks unsupported template-based indicators before the API call', () => {
    expect(validateMarketObserverConfig({
      llm_provider: 'GROK',
      rules: [{
        rule_type: 'template_based',
        indicator: {
          slug: 'ChandelierExit',
          name: 'Chandelier Exit',
        },
      }],
    })).toEqual({
      valid: false,
      error: 'MSG_BUILDER_VALIDATION_INDICATOR_NOT_AVAILABLE_WATCHLIST',
      errorParams: { slug: 'ChandelierExit' },
    });
  });
});
