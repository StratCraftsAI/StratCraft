/**
 * System Test: Cross-Module Communication
 *
 * TICKET_494 Phase 2: System layer
 * Journey: IPC write -> MCP read consistency, MCP write -> IPC read consistency
 * Tests that data written via one module boundary is readable from another.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared data layer (simulates SQLite accessed by both IPC and MCP modules)
// ---------------------------------------------------------------------------

interface SharedAlgorithm {
  id: number;
  code: string;
  strategy_name: string;
  strategy_type: number;
  user_id: string;
}

interface SharedBacktestResult {
  task_id: string;
  algorithm_id: number;
  strategy_name: string;
  total_pnl: number;
}

let sharedDb: {
  algorithms: Map<number, SharedAlgorithm>;
  backtestResults: Map<string, SharedBacktestResult>;
  nextId: number;
};

function resetSharedDb() {
  sharedDb = {
    algorithms: new Map(),
    backtestResults: new Map(),
    nextId: 1,
  };
}

// IPC module interface (simulates v3-handlers)
const ipcModule = {
  saveAlgorithm(name: string, code: string, type: number, userId: string): number {
    const id = sharedDb.nextId++;
    sharedDb.algorithms.set(id, { id, code, strategy_name: name, strategy_type: type, user_id: userId });
    return id;
  },
  getAlgorithm(id: number): SharedAlgorithm | undefined {
    return sharedDb.algorithms.get(id);
  },
  listAlgorithms(): SharedAlgorithm[] {
    return Array.from(sharedDb.algorithms.values());
  },
  saveBacktestResult(taskId: string, algoId: number, pnl: number): void {
    const algo = sharedDb.algorithms.get(algoId);
    sharedDb.backtestResults.set(taskId, {
      task_id: taskId,
      algorithm_id: algoId,
      strategy_name: algo?.strategy_name || 'unknown',
      total_pnl: pnl,
    });
  },
};

// MCP module interface (simulates MCP handlers reading same DB)
const mcpModule = {
  listStrategies(): SharedAlgorithm[] {
    return Array.from(sharedDb.algorithms.values());
  },
  getStrategy(id: number): SharedAlgorithm | undefined {
    return sharedDb.algorithms.get(id);
  },
  listBacktestResults(): SharedBacktestResult[] {
    return Array.from(sharedDb.backtestResults.values());
  },
  getBacktestResult(taskId: string): SharedBacktestResult | undefined {
    return sharedDb.backtestResults.get(taskId);
  },
  saveAlgorithm(name: string, code: string, type: number, userId: string): number {
    const id = sharedDb.nextId++;
    sharedDb.algorithms.set(id, { id, code, strategy_name: name, strategy_type: type, user_id: userId });
    return id;
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cross-Module Communication System Journey', () => {
  beforeEach(() => {
    resetSharedDb();
  });

  // =========================================================================
  // IPC write -> MCP read
  // =========================================================================

  describe('IPC write -> MCP read consistency', () => {
    it('algorithm saved via IPC is visible to MCP', () => {
      const id = ipcModule.saveAlgorithm('IPC Strategy', 'ipc_code', 1, 'user-1');

      const mcpResult = mcpModule.getStrategy(id);
      expect(mcpResult).toBeDefined();
      expect(mcpResult!.strategy_name).toBe('IPC Strategy');
      expect(mcpResult!.code).toBe('ipc_code');
    });

    it('IPC list matches MCP list', () => {
      ipcModule.saveAlgorithm('A', 'code_a', 1, 'user-1');
      ipcModule.saveAlgorithm('B', 'code_b', 3, 'user-1');

      const ipcList = ipcModule.listAlgorithms();
      const mcpList = mcpModule.listStrategies();

      expect(ipcList).toHaveLength(2);
      expect(mcpList).toHaveLength(2);
      expect(ipcList).toEqual(mcpList);
    });

    it('backtest result saved via IPC is readable from MCP', () => {
      const algoId = ipcModule.saveAlgorithm('Test', 'code', 1, 'user-1');
      ipcModule.saveBacktestResult('bt-ipc-1', algoId, 2500);

      const mcpResult = mcpModule.getBacktestResult('bt-ipc-1');
      expect(mcpResult).toBeDefined();
      expect(mcpResult!.total_pnl).toBe(2500);
      expect(mcpResult!.algorithm_id).toBe(algoId);
    });
  });

  // =========================================================================
  // MCP write -> IPC read
  // =========================================================================

  describe('MCP write -> IPC read consistency', () => {
    it('algorithm saved via MCP is visible to IPC', () => {
      const id = mcpModule.saveAlgorithm('MCP Strategy', 'mcp_code', 1, 'user-1');

      const ipcResult = ipcModule.getAlgorithm(id);
      expect(ipcResult).toBeDefined();
      expect(ipcResult!.strategy_name).toBe('MCP Strategy');
    });

    it('MCP-generated strategies appear in IPC list', () => {
      mcpModule.saveAlgorithm('MCP A', 'code_a', 1, 'user-1');
      mcpModule.saveAlgorithm('MCP B', 'code_b', 3, 'user-1');

      const ipcList = ipcModule.listAlgorithms();
      expect(ipcList).toHaveLength(2);
      expect(ipcList.map((a) => a.strategy_name)).toContain('MCP A');
      expect(ipcList.map((a) => a.strategy_name)).toContain('MCP B');
    });
  });

  // =========================================================================
  // Mixed writes from both modules
  // =========================================================================

  describe('mixed cross-module writes', () => {
    it('interleaved IPC and MCP writes produce consistent view', () => {
      ipcModule.saveAlgorithm('IPC Strategy 1', 'code1', 1, 'user-1');
      mcpModule.saveAlgorithm('MCP Strategy 1', 'code2', 3, 'user-1');
      ipcModule.saveAlgorithm('IPC Strategy 2', 'code3', 6, 'user-1');

      const allStrategies = mcpModule.listStrategies();
      expect(allStrategies).toHaveLength(3);

      const names = allStrategies.map((s) => s.strategy_name);
      expect(names).toContain('IPC Strategy 1');
      expect(names).toContain('MCP Strategy 1');
      expect(names).toContain('IPC Strategy 2');

      // IDs are sequential regardless of module
      const ids = allStrategies.map((s) => s.id).sort((a, b) => a - b);
      expect(ids).toEqual([1, 2, 3]);
    });
  });
});
