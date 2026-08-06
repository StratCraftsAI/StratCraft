/**
 * Tests for per-page form state stores
 *
 * TICKET_1208 P6 Layer B: Verifies form state preservation across
 * component unmount/remount for each generator page.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useRegimeDetectorStore } from '../useRegimeDetectorStore';
import { useEntrySignalStore } from '../useEntrySignalStore';
import { useKronosPredictorStore } from '../useKronosPredictorStore';
import { useKronosIndicatorEntryStore } from '../useKronosIndicatorEntryStore';
import { useKronosAIEntryStore } from '../useKronosAIEntryStore';
import { useMarketObserverStore } from '../useMarketObserverStore';
import { useTraderAIEntryStore } from '../useTraderAIEntryStore';
import { useAILiberoStore } from '../useAILiberoStore';
import { useIndicatorExitStore } from '../useIndicatorExitStore';
import { useStrategyCatalogStore } from '../useStrategyCatalogStore';

describe('RegimeDetector form store', () => {
  beforeEach(() => {
    useRegimeDetectorStore.setState({
      strategies: [],
      selectedRegime: 'trend',
      bespokeData: { name: '', notes: '' },
      indicatorBlocks: [],
      signalMode: 'auto-reverse',
    });
  });

  it('preserves regime selection', () => {
    useRegimeDetectorStore.getState().setSelectedRegime('range');
    expect(useRegimeDetectorStore.getState().selectedRegime).toBe('range');
  });

  it('preserves indicator blocks', () => {
    const block = { indicatorSlug: 'rsi', paramValues: { period: 14 } } as any;
    useRegimeDetectorStore.getState().setIndicatorBlocks([block]);
    expect(useRegimeDetectorStore.getState().indicatorBlocks).toHaveLength(1);
    expect(useRegimeDetectorStore.getState().indicatorBlocks[0].indicatorSlug).toBe('rsi');
  });

  it('setStrategies with updater function', () => {
    useRegimeDetectorStore.getState().setStrategies([
      { id: '1', expression: 'rsi > 70' },
    ]);
    useRegimeDetectorStore.getState().setStrategies((prev) => [
      ...prev,
      { id: '2', expression: 'macd > 0' },
    ]);
    expect(useRegimeDetectorStore.getState().strategies).toHaveLength(2);
  });
});

describe('EntrySignal form store', () => {
  beforeEach(() => {
    useEntrySignalStore.setState({
      strategies: [],
      selectedRegime: 'trend',
      bespokeData: { name: '', notes: '' },
      indicatorBlocks: [],
      signalMode: 'auto-reverse',
    });
  });

  it('preserves signal mode', () => {
    useEntrySignalStore.getState().setSignalMode('manual');
    expect(useEntrySignalStore.getState().signalMode).toBe('manual');
  });

  it('preserves bespoke data', () => {
    useEntrySignalStore.getState().setBespokeData({ name: 'custom', notes: 'notes' });
    const data = useEntrySignalStore.getState().bespokeData;
    expect(data.name).toBe('custom');
    expect(data.notes).toBe('notes');
  });
});

describe('KronosPredictor form store', () => {
  beforeEach(() => {
    useKronosPredictorStore.setState({
      selectedModel: 'kronos-small',
      lookback: 400,
      predLen: 120,
      temperature: 1.0,
      topP: 0.9,
      topK: 0,
      sampleCount: 1,
      signalFilter: { confidence: { enabled: true, value: 60 }, expectedReturn: { enabled: true, value: 2 }, direction: { enabled: false, mode: 'both' }, magnitude: { enabled: false, value: 1 }, consistency: { enabled: true, value: 70 }, combinationLogic: 'AND' },
      timeRangeMode: 'latest',
      customTime: '',
      activePreset: 'standard',
    });
  });

  it('preserves model selection and parameters', () => {
    useKronosPredictorStore.getState().setSelectedModel('kronos-large');
    useKronosPredictorStore.getState().setLookback(800);
    useKronosPredictorStore.getState().setTemperature(0.7);

    const state = useKronosPredictorStore.getState();
    expect(state.selectedModel).toBe('kronos-large');
    expect(state.lookback).toBe(800);
    expect(state.temperature).toBe(0.7);
  });
});

describe('KronosIndicatorEntry form store', () => {
  it('preserves strategies and indicator blocks', () => {
    useKronosIndicatorEntryStore.getState().setStrategies([
      { id: '1', expression: 'test' },
    ]);
    useKronosIndicatorEntryStore.getState().setIndicatorBlocks([
      { indicatorSlug: 'macd' } as any,
    ]);

    expect(useKronosIndicatorEntryStore.getState().strategies).toHaveLength(1);
    expect(useKronosIndicatorEntryStore.getState().indicatorBlocks).toHaveLength(1);
  });
});

describe('KronosAIEntry form store', () => {
  it('preserves prompt and preset mode', () => {
    useKronosAIEntryStore.getState().setPrompt('Generate a momentum strategy');
    useKronosAIEntryStore.getState().setPresetMode('warrior');

    expect(useKronosAIEntryStore.getState().prompt).toBe('Generate a momentum strategy');
    expect(useKronosAIEntryStore.getState().presetMode).toBe('warrior');
  });
});

describe('MarketObserver form store', () => {
  it('preserves indicator blocks with updater', () => {
    useMarketObserverStore.getState().setIndicatorBlocks([
      { indicatorSlug: 'bb' } as any,
    ]);
    useMarketObserverStore.getState().setIndicatorBlocks((prev) => [
      ...prev,
      { indicatorSlug: 'sma' } as any,
    ]);

    expect(useMarketObserverStore.getState().indicatorBlocks).toHaveLength(2);
  });
});

describe('TraderAIEntry form store', () => {
  it('preserves prompt and bespoke config', () => {
    useTraderAIEntryStore.getState().setPrompt('My trading prompt');
    useTraderAIEntryStore.getState().setBespokeConfig({ riskLevel: 0.5 } as any);

    expect(useTraderAIEntryStore.getState().prompt).toBe('My trading prompt');
    expect(useTraderAIEntryStore.getState().bespokeConfig).toEqual({ riskLevel: 0.5 });
  });
});

describe('AILibero form store', () => {
  it('preserves prediction config', () => {
    useAILiberoStore.getState().setPredictionConfig({ horizon: 24 } as any);

    expect(useAILiberoStore.getState().predictionConfig).toEqual({ horizon: 24 });
  });
});

describe('IndicatorExit form store', () => {
  it('preserves rules with updater', () => {
    useIndicatorExitStore.getState().setRules([
      { type: 'trailing_stop', params: {} } as any,
    ]);
    useIndicatorExitStore.getState().setRules((prev) => [
      ...prev,
      { type: 'circuit_breaker', params: {} } as any,
    ]);

    expect(useIndicatorExitStore.getState().rules).toHaveLength(2);
  });

  it('preserves hard safety max loss', () => {
    useIndicatorExitStore.getState().setHardSafetyMaxLoss(5.0);
    expect(useIndicatorExitStore.getState().hardSafetyMaxLoss).toBe(5.0);
  });
});

describe('StrategyCatalog form store', () => {
  it('preserves category and search', () => {
    useStrategyCatalogStore.getState().setSelectedCategory('mean-reversion');
    useStrategyCatalogStore.getState().setSearchQuery('momentum');
    useStrategyCatalogStore.getState().setSelectedStrategyId('strat-123');

    const state = useStrategyCatalogStore.getState();
    expect(state.selectedCategory).toBe('mean-reversion');
    expect(state.searchQuery).toBe('momentum');
    expect(state.selectedStrategyId).toBe('strat-123');
  });
});

describe('Cross-store isolation', () => {
  it('RegimeDetector and EntrySignal stores are independent', () => {
    useRegimeDetectorStore.getState().setSelectedRegime('bespoke');
    useEntrySignalStore.getState().setSelectedRegime('range');

    expect(useRegimeDetectorStore.getState().selectedRegime).toBe('bespoke');
    expect(useEntrySignalStore.getState().selectedRegime).toBe('range');
  });

  it('KronosAIEntry and TraderAIEntry stores are independent', () => {
    useKronosAIEntryStore.getState().setPrompt('Kronos prompt');
    useTraderAIEntryStore.getState().setPrompt('Trader prompt');

    expect(useKronosAIEntryStore.getState().prompt).toBe('Kronos prompt');
    expect(useTraderAIEntryStore.getState().prompt).toBe('Trader prompt');
  });
});
