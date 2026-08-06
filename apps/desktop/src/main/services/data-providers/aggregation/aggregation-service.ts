/**
 * Electron control plane for mandatory C++ OHLCV aggregation.
 */

import { MS_PER_DAY, MS_PER_SECOND } from '../../../../shared/constants/timing';
import { intervalToMs } from '../../../../shared/constants/intervals';
import {
  runOhlcvDataPlane,
  type OhlcvDecisionMetadata,
} from '../../ohlcv-data-plane-client';
import type { IDataProvider } from '../types';
import {
  resolveSessionAnchor,
  rthSessionOpenEpochSeconds,
  type SessionAnchor,
} from './session-anchor';

class AggregationService {
  isAggregateMode(provider: IDataProvider): boolean {
    return provider.capabilities.baseInterval !== undefined;
  }

  resolveAnchorForProvider(provider: IDataProvider): SessionAnchor {
    return resolveSessionAnchor(provider.capabilities.assetTypes);
  }

  private sessionAnchors(
    policy: SessionAnchor,
    startMs: number,
    endMs: number,
  ): Array<{ effectiveStartMs: number; anchorMs: number }> {
    if (policy === 'utc') {
      return [{ effectiveStartMs: startMs, anchorMs: 0 }];
    }
    const anchors: Array<{ effectiveStartMs: number; anchorMs: number }> = [];
    const firstDay = Math.floor(startMs / MS_PER_DAY) * MS_PER_DAY;
    for (let dayMs = firstDay; dayMs <= endMs; dayMs += MS_PER_DAY) {
      anchors.push({
        effectiveStartMs: Math.max(startMs, dayMs),
        anchorMs:
          rthSessionOpenEpochSeconds(dayMs / MS_PER_SECOND) * MS_PER_SECOND,
      });
    }
    return anchors;
  }

  async aggregateToCanonicalFile(args: {
    inputPath: string;
    outputPath: string;
    symbol: string;
    targetInterval: string;
    startMs: number;
    endMs: number;
    provider: IDataProvider;
    abortSignal?: AbortSignal;
  }): Promise<OhlcvDecisionMetadata> {
    const targetIntervalMs = intervalToMs(args.targetInterval);
    if (targetIntervalMs === null || targetIntervalMs <= 0) {
      throw new Error(`Unsupported aggregation target interval: ${args.targetInterval}`);
    }
    const policy = this.resolveAnchorForProvider(args.provider);
    return runOhlcvDataPlane({
      operation: 'aggregate',
      inputs: [{
        path: args.inputPath,
        projection: { fixedSymbol: args.symbol, timestampUnit: 'ms' },
      }],
      window: { startMs: args.startMs, endMs: args.endMs },
      outputPath: args.outputPath,
      targetIntervalMs,
      sessionAnchors: this.sessionAnchors(policy, args.startMs, args.endMs),
      keepPartialBucket: true,
      qualityAction: 'reject_artifact',
    }, args.abortSignal);
  }
}

let instance: AggregationService | null = null;

export function getAggregationService(): AggregationService {
  if (!instance) instance = new AggregationService();
  return instance;
}
