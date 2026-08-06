/**
 * useCheckpoint Hooks Unit Tests
 *
 * TICKET_634: Comprehensive Test Coverage
 * Tests type contracts for checkpoint management hooks.
 */

import { describe, it, expect } from 'vitest';
import type {
  CheckpointInfo,
  IntermediateResults,
  DataValidationStatus,
  CheckpointSummary,
  UseCheckpointResult,
} from '../useCheckpoint';

// =============================================================================
// Type Shape Validation
// =============================================================================

describe('useCheckpoint types', () => {
  describe('CheckpointInfo', () => {
    it('should accept valid checkpoint info', () => {
      const info: CheckpointInfo = {
        taskId: 'task-123',
        barIndex: 500,
        totalBars: 1000,
        createdAt: '2026-04-01T12:00:00Z',
        progressPercent: 50,
        dataValidation: 'valid',
      };
      expect(info.taskId).toBe('task-123');
      expect(info.progressPercent).toBe(50);
      expect(info.dataValidation).toBe('valid');
    });

    it('should accept intermediate results', () => {
      const info: CheckpointInfo = {
        taskId: 'task-456',
        barIndex: 750,
        totalBars: 1000,
        createdAt: '2026-04-01T12:00:00Z',
        progressPercent: 75,
        dataValidation: 'valid',
        intermediateResults: {
          metrics: {
            totalPnl: 1500.5,
            totalReturn: 15.05,
            sharpeRatio: 1.85,
            maxDrawdown: -5.2,
            winRate: 0.62,
            totalTrades: 50,
            winningTrades: 31,
            losingTrades: 19,
          },
          trades: [
            {
              entryTime: 1704067200,
              exitTime: 1704153600,
              symbol: 'AAPL',
              side: 'long',
              entryPrice: 150.0,
              exitPrice: 155.0,
              quantity: 10,
              pnl: 50.0,
            },
          ],
          equityCurve: [
            { timestamp: 1704067200, equity: 10000, drawdown: 0 },
            { timestamp: 1704153600, equity: 10500, drawdown: 0 },
          ],
          openPositions: [
            { symbol: 'BTC', size: 0.5, price: 45000 },
          ],
        },
      };
      expect(info.intermediateResults?.metrics?.totalPnl).toBe(1500.5);
      expect(info.intermediateResults?.trades).toHaveLength(1);
    });
  });

  describe('DataValidationStatus', () => {
    it('should accept all valid statuses', () => {
      const statuses: DataValidationStatus[] = ['valid', 'file_missing', 'hash_mismatch', 'pending'];
      expect(statuses).toHaveLength(4);
    });
  });

  describe('CheckpointSummary', () => {
    it('should have required fields', () => {
      const summary: CheckpointSummary = {
        task_id: 'task-789',
        bar_index: 100,
        created_at: '2026-04-01',
      };
      expect(summary.task_id).toBe('task-789');
      expect(summary.bar_index).toBe(100);
    });
  });

  describe('IntermediateResults', () => {
    it('should accept empty results (all optional)', () => {
      const results: IntermediateResults = {};
      expect(results.metrics).toBeUndefined();
      expect(results.trades).toBeUndefined();
    });

    it('should accept partial metrics', () => {
      const results: IntermediateResults = {
        metrics: {
          totalPnl: 500,
          sharpeRatio: 1.2,
        },
      };
      expect(results.metrics?.totalPnl).toBe(500);
      expect(results.metrics?.winRate).toBeUndefined();
    });
  });

  describe('UseCheckpointResult', () => {
    it('should define expected hook return shape', () => {
      const result: UseCheckpointResult = {
        hasCheckpoint: false,
        checkpointInfo: null,
        isLoading: false,
        error: null,
        refresh: async () => {},
        deleteCheckpoint: async () => {},
      };
      expect(result.hasCheckpoint).toBe(false);
      expect(result.checkpointInfo).toBeNull();
    });
  });
});
