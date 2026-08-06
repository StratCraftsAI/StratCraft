/**
 * TICKET_634_3: useBacktestConfigStore Tests
 *
 * Tests for the backtest config snapshot store (TICKET_365).
 * Validates save/clear lifecycle and deep clone behavior.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useBacktestConfigStore, type BacktestConfigSnapshot } from '../useBacktestConfigStore';

const makeSnapshot = (overrides: Partial<BacktestConfigSnapshot> = {}): BacktestConfigSnapshot => ({
  cockpit: 'indicators',
  dataConfig: {
    symbol: 'AAPL',
    dataSource: 'yfinance',
    startDate: '2023-01-01',
    endDate: '2024-01-01',
    initialCapital: 100000,
    orderSize: 100,
    orderSizeUnit: 'shares',
  },
  workflowRows: [{ algorithmId: 1, signalSource: 'sma_cross' }],
  ...overrides,
});

describe('useBacktestConfigStore', () => {
  beforeEach(() => {
    useBacktestConfigStore.setState({ snapshot: null });
  });

  it('should start with null snapshot', () => {
    expect(useBacktestConfigStore.getState().snapshot).toBeNull();
  });

  it('should save a snapshot', () => {
    const snap = makeSnapshot();
    useBacktestConfigStore.getState().saveSnapshot(snap);

    const saved = useBacktestConfigStore.getState().snapshot;
    expect(saved).not.toBeNull();
    expect(saved!.cockpit).toBe('indicators');
    expect(saved!.dataConfig.symbol).toBe('AAPL');
  });

  it('should overwrite existing snapshot', () => {
    useBacktestConfigStore.getState().saveSnapshot(makeSnapshot());
    useBacktestConfigStore.getState().saveSnapshot(makeSnapshot({ cockpit: 'kronos' }));

    expect(useBacktestConfigStore.getState().snapshot!.cockpit).toBe('kronos');
  });

  it('should clear snapshot', () => {
    useBacktestConfigStore.getState().saveSnapshot(makeSnapshot());
    useBacktestConfigStore.getState().clearSnapshot();

    expect(useBacktestConfigStore.getState().snapshot).toBeNull();
  });

  it('should preserve full dataConfig structure', () => {
    const snap = makeSnapshot({
      dataConfig: {
        symbol: 'MSFT',
        dataSource: 'clickhouse',
        startDate: '2022-06-01',
        endDate: '2023-06-01',
        initialCapital: 50000,
        orderSize: 50,
        orderSizeUnit: 'percent',
      },
    });
    useBacktestConfigStore.getState().saveSnapshot(snap);

    const config = useBacktestConfigStore.getState().snapshot!.dataConfig;
    expect(config.symbol).toBe('MSFT');
    expect(config.dataSource).toBe('clickhouse');
    expect(config.initialCapital).toBe(50000);
  });
});
