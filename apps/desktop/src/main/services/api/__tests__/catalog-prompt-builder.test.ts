import { describe, it, expect } from 'vitest';
import { buildCatalogPrompt } from '../catalog-prompt-builder';
import type { CatalogStrategy } from '../../../../shared/data/catalog-strategy-registry';

const MOCK_STRATEGY: CatalogStrategy = {
  id: 'dual-ma-crossover',
  title: 'Dual Moving Average Crossover',
  subtitle: 'Classic trend-following strategy',
  category: 'trend-following',
  categoryTitle: 'Trend Following',
  riskLevel: 'MEDIUM',
  timeframe: ['1h', '4h', 'Daily'],
  marketType: ['Equities', 'Forex'],
  worksIn: ['Strong trends', 'Bull markets'],
  failsIn: ['Choppy / range-bound markets'],
  pipeline: [
    { title: 'Filter', conditions: ['ADX > 25', 'Volume above average', 'No earnings in 48h'] },
    { title: 'Signal', conditions: ['Fast MA crosses above Slow MA', 'Price above 200 SMA', 'RSI not overbought'] },
    { title: 'Confirm', conditions: ['Volume spike on crossover bar', 'MACD histogram positive', 'Price above VWAP'] },
    { title: 'Size', conditions: ['Risk 1% per trade', 'ATR-based position sizing', 'Max 3 concurrent positions'] },
    { title: 'Exit', conditions: ['Reverse crossover', 'Trailing stop at 2x ATR', 'Take profit at 3:1 R:R'] },
  ],
  indicators: [
    { name: 'SMA(20)', role: 'primary', formula: 'sum(close,20)/20' },
    { name: 'SMA(50)', role: 'confirmation', formula: 'sum(close,50)/50' },
    { name: 'ATR(14)', role: 'risk', formula: 'TR average over 14 periods' },
  ],
  entryRules: ['Fast MA crosses above Slow MA'],
  exitRules: ['Fast MA crosses below Slow MA', 'Trailing stop hit'],
  riskRules: ['1% max risk per trade', 'Max 3 concurrent'],
  sourceUrl: 'https://example.com',
};

describe('catalog-prompt-builder', () => {
  describe('buildCatalogPrompt', () => {
    it('includes strategy title and subtitle', () => {
      const prompt = buildCatalogPrompt(MOCK_STRATEGY);
      expect(prompt).toContain('Dual Moving Average Crossover');
      expect(prompt).toContain('Classic trend-following strategy');
    });

    it('includes category', () => {
      const prompt = buildCatalogPrompt(MOCK_STRATEGY);
      expect(prompt).toContain('CATEGORY: Trend Following');
    });

    it('includes default risk level when no customization', () => {
      const prompt = buildCatalogPrompt(MOCK_STRATEGY);
      expect(prompt).toContain('RISK LEVEL: MEDIUM');
    });

    it('includes all 5 pipeline stages', () => {
      const prompt = buildCatalogPrompt(MOCK_STRATEGY);
      expect(prompt).toContain('Stage 1 - Filter:');
      expect(prompt).toContain('Stage 2 - Signal:');
      expect(prompt).toContain('Stage 3 - Confirm:');
      expect(prompt).toContain('Stage 4 - Size:');
      expect(prompt).toContain('Stage 5 - Exit:');
    });

    it('includes pipeline conditions', () => {
      const prompt = buildCatalogPrompt(MOCK_STRATEGY);
      expect(prompt).toContain('ADX > 25');
      expect(prompt).toContain('Fast MA crosses above Slow MA');
    });

    it('includes indicators with name, role, and formula', () => {
      const prompt = buildCatalogPrompt(MOCK_STRATEGY);
      expect(prompt).toContain('SMA(20) (primary): sum(close,20)/20');
      expect(prompt).toContain('ATR(14) (risk)');
    });

    it('includes entry, exit, and risk rules', () => {
      const prompt = buildCatalogPrompt(MOCK_STRATEGY);
      expect(prompt).toContain('ENTRY RULES:');
      expect(prompt).toContain('EXIT RULES:');
      expect(prompt).toContain('RISK MANAGEMENT:');
      expect(prompt).toContain('Trailing stop hit');
      expect(prompt).toContain('1% max risk per trade');
    });

    it('includes suitability section', () => {
      const prompt = buildCatalogPrompt(MOCK_STRATEGY);
      expect(prompt).toContain('SUITABILITY:');
      expect(prompt).toContain('Works in: Strong trends; Bull markets');
      expect(prompt).toContain('Fails in: Choppy / range-bound markets');
    });

    it('includes StratForge ABI v2 instructions', () => {
      const prompt = buildCatalogPrompt(MOCK_STRATEGY);
      expect(prompt).toContain('QNX_STRATEGY_FACTORY_EXPORT');
      expect(prompt).toContain('stratforge::Strategy');
      expect(prompt).toContain('onBar()');
    });

    it('does not include USER CUSTOMIZATION when none provided', () => {
      const prompt = buildCatalogPrompt(MOCK_STRATEGY);
      expect(prompt).not.toContain('USER CUSTOMIZATION:');
    });

    it('overrides risk level from customization', () => {
      const prompt = buildCatalogPrompt(MOCK_STRATEGY, { riskLevel: 'LOW' });
      expect(prompt).toContain('RISK LEVEL: LOW');
      expect(prompt).not.toContain('RISK LEVEL: MEDIUM');
    });

    it('overrides timeframe from customization', () => {
      const prompt = buildCatalogPrompt(MOCK_STRATEGY, { timeframe: '5m' });
      expect(prompt).toContain('TIMEFRAMES: 5m');
      expect(prompt).not.toContain('TIMEFRAMES: 1h, 4h, Daily');
    });

    it('includes user preference when provided', () => {
      const prompt = buildCatalogPrompt(MOCK_STRATEGY, { preference: 'Focus on Forex pairs only' });
      expect(prompt).toContain('USER CUSTOMIZATION:');
      expect(prompt).toContain('Focus on Forex pairs only');
    });

    it('handles all customization fields together', () => {
      const prompt = buildCatalogPrompt(MOCK_STRATEGY, {
        riskLevel: 'HIGH',
        timeframe: '15m',
        preference: 'Aggressive entries',
      });
      expect(prompt).toContain('RISK LEVEL: HIGH');
      expect(prompt).toContain('TIMEFRAMES: 15m');
      expect(prompt).toContain('USER CUSTOMIZATION:');
      expect(prompt).toContain('Aggressive entries');
    });
  });
});
