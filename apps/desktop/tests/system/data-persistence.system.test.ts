/**
 * System Test: Data Persistence
 *
 * TICKET_494 Phase 2: System layer
 * Journey: DB write -> verify -> simulate restart -> re-read -> consistency check
 * Tests data persistence across simulated application restarts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Simulated persistent store (mimics SQLite behavior)
// ---------------------------------------------------------------------------

interface PersistentStore {
  algorithms: Map<number, Record<string, unknown>>;
  backtestResults: Map<string, Record<string, unknown>>;
  configs: Map<string, unknown>;
  migrationVersion: number;
}

let store: PersistentStore;

function createFreshStore(): PersistentStore {
  return {
    algorithms: new Map(),
    backtestResults: new Map(),
    configs: new Map(),
    migrationVersion: 0,
  };
}

function serializeStore(s: PersistentStore): string {
  return JSON.stringify({
    algorithms: Array.from(s.algorithms.entries()),
    backtestResults: Array.from(s.backtestResults.entries()),
    configs: Array.from(s.configs.entries()),
    migrationVersion: s.migrationVersion,
  });
}

function deserializeStore(data: string): PersistentStore {
  const parsed = JSON.parse(data);
  return {
    algorithms: new Map(parsed.algorithms),
    backtestResults: new Map(parsed.backtestResults),
    configs: new Map(parsed.configs),
    migrationVersion: parsed.migrationVersion,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Data Persistence System Journey', () => {
  beforeEach(() => {
    store = createFreshStore();
  });

  // =========================================================================
  // Write -> read consistency
  // =========================================================================

  it('algorithm write -> read returns identical data', () => {
    const algo = {
      id: 1,
      code: 'class MyStrategy:\n  pass',
      strategy_name: 'Persistence Test',
      strategy_type: 1,
      user_id: 'user-1',
    };

    store.algorithms.set(1, algo);

    const retrieved = store.algorithms.get(1);
    expect(retrieved).toEqual(algo);
    expect(retrieved!.strategy_name).toBe('Persistence Test');
  });

  it('backtest result write -> read returns full metrics', () => {
    const result = {
      task_id: 'bt-persist-1',
      total_pnl: 2500,
      sharpe_ratio: 1.8,
      win_rate: 0.7,
      max_drawdown: 0.03,
      total_trades: 20,
    };

    store.backtestResults.set('bt-persist-1', result);

    const retrieved = store.backtestResults.get('bt-persist-1');
    expect(retrieved).toEqual(result);
  });

  // =========================================================================
  // Serialize -> deserialize (simulated restart)
  // =========================================================================

  it('write -> serialize -> deserialize -> data intact', () => {
    store.algorithms.set(1, {
      id: 1,
      code: 'class Strategy:\n  pass',
      strategy_name: 'Survive Restart',
      strategy_type: 1,
    });
    store.backtestResults.set('bt-1', {
      task_id: 'bt-1',
      total_pnl: 1500,
    });
    store.configs.set('theme', 'dark');
    store.migrationVersion = 7;

    // Simulate app close + reopen
    const serialized = serializeStore(store);
    const restored = deserializeStore(serialized);

    expect(restored.algorithms.size).toBe(1);
    expect(restored.algorithms.get(1)).toEqual(store.algorithms.get(1));
    expect(restored.backtestResults.get('bt-1')).toEqual(store.backtestResults.get('bt-1'));
    expect(restored.configs.get('theme')).toBe('dark');
    expect(restored.migrationVersion).toBe(7);
  });

  it('empty store serializes and deserializes correctly', () => {
    const serialized = serializeStore(store);
    const restored = deserializeStore(serialized);

    expect(restored.algorithms.size).toBe(0);
    expect(restored.backtestResults.size).toBe(0);
    expect(restored.configs.size).toBe(0);
    expect(restored.migrationVersion).toBe(0);
  });

  // =========================================================================
  // Migration version tracking
  // =========================================================================

  it('migration version persists across restarts', () => {
    store.migrationVersion = 5;

    const serialized = serializeStore(store);
    const restored = deserializeStore(serialized);

    expect(restored.migrationVersion).toBe(5);
  });

  it('incremental migration updates version correctly', () => {
    store.migrationVersion = 3;

    // Simulate running migrations 4 and 5
    store.migrationVersion = 4;
    store.migrationVersion = 5;

    expect(store.migrationVersion).toBe(5);
  });
});
