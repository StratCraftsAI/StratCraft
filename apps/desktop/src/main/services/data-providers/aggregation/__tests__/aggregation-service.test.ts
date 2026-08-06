import { beforeEach, describe, expect, it, vi } from 'vitest';

const runOhlcvDataPlane = vi.hoisted(() => vi.fn());
vi.mock('../../../ohlcv-data-plane-client', () => ({ runOhlcvDataPlane }));

import { getAggregationService } from '../aggregation-service';
import type { IDataProvider } from '../../types';

const provider = {
  id: 'test',
  name: 'Test',
  capabilities: {
    baseInterval: '1m',
    assetTypes: ['crypto'],
  },
} as unknown as IDataProvider;

describe('AggregationService C++ boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runOhlcvDataPlane.mockResolvedValue({ decisionId: 'cpp-aggregate' });
  });

  it('detects aggregate mode and resolves provider session policy', () => {
    const service = getAggregationService();
    expect(service.isAggregateMode(provider)).toBe(true);
    expect(service.resolveAnchorForProvider(provider)).toBe('utc');
    expect(service.isAggregateMode({
      ...provider,
      capabilities: { assetTypes: ['crypto'] },
    } as unknown as IDataProvider)).toBe(false);
  });

  it('passes the exact window and canonical output to C++', async () => {
    const service = getAggregationService();
    await service.aggregateToCanonicalFile({
      inputPath: '/base.parquet',
      outputPath: '/aggregate.parquet',
      symbol: 'BTCUSD',
      targetInterval: '5m',
      startMs: 1_000,
      endMs: 9_999,
      provider,
    });
    expect(runOhlcvDataPlane).toHaveBeenCalledWith({
      operation: 'aggregate',
      inputs: [{
        path: '/base.parquet',
        projection: { fixedSymbol: 'BTCUSD', timestampUnit: 'ms' },
      }],
      window: { startMs: 1_000, endMs: 9_999 },
      outputPath: '/aggregate.parquet',
      targetIntervalMs: 300_000,
      sessionAnchors: [{ effectiveStartMs: 1_000, anchorMs: 0 }],
      keepPartialBucket: true,
      qualityAction: 'reject_artifact',
    }, undefined);
  });

  it('fails before launch for an unsupported interval', async () => {
    await expect(getAggregationService().aggregateToCanonicalFile({
      inputPath: '/base.parquet',
      outputPath: '/aggregate.parquet',
      symbol: 'BTCUSD',
      targetInterval: 'invalid',
      startMs: 1_000,
      endMs: 9_999,
      provider,
    })).rejects.toThrow('Unsupported aggregation target interval');
    expect(runOhlcvDataPlane).not.toHaveBeenCalled();
  });

  it('emits one RTH anchor per intersecting UTC day and forwards cancellation', async () => {
    const controller = new AbortController();
    const startMs = Date.parse('2026-03-07T20:00:00.000Z');
    const endMs = Date.parse('2026-03-09T01:00:00.000Z');
    const equityProvider = {
      ...provider,
      capabilities: {
        baseInterval: '1m',
        assetTypes: ['stock'],
      },
    } as unknown as IDataProvider;
    await getAggregationService().aggregateToCanonicalFile({
      inputPath: '/base.parquet',
      outputPath: '/aggregate.parquet',
      symbol: 'AAPL',
      targetInterval: '1d',
      startMs,
      endMs,
      provider: equityProvider,
      abortSignal: controller.signal,
    });
    const [request, signal] = runOhlcvDataPlane.mock.calls[0];
    expect(signal).toBe(controller.signal);
    expect(request.sessionAnchors).toHaveLength(3);
    expect(request.sessionAnchors.map(
      (entry: { effectiveStartMs: number }) => entry.effectiveStartMs,
    )).toEqual([
      startMs,
      Date.parse('2026-03-08T00:00:00.000Z'),
      Date.parse('2026-03-09T00:00:00.000Z'),
    ]);
    expect(request.sessionAnchors.every(
      (entry: { anchorMs: number }) => Number.isSafeInteger(entry.anchorMs),
    )).toBe(true);
  });

  it('propagates C++ aggregation failures without fallback', async () => {
    runOhlcvDataPlane.mockRejectedValue(new Error('QNX_OHLCV_CANCELLED'));
    await expect(getAggregationService().aggregateToCanonicalFile({
      inputPath: '/base.parquet',
      outputPath: '/aggregate.parquet',
      symbol: 'BTCUSD',
      targetInterval: '5m',
      startMs: 1_000,
      endMs: 9_999,
      provider,
    })).rejects.toThrow('QNX_OHLCV_CANCELLED');
  });
});
