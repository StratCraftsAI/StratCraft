/**
 * @StratCraft/sdk-core - Core SDK for StratCraft plugin development
 */

import type { PluginManifest, OHLCV } from '@StratCraft/types';

// Re-export types
export * from '@StratCraft/types';

// ============================================================================
// Plugin Base Class
// ============================================================================

export abstract class NexusPlugin {
  abstract readonly manifest: PluginManifest;

  abstract initialize(): Promise<void>;
  abstract destroy(): Promise<void>;
}

// ============================================================================
// Data Provider Plugin
// ============================================================================

export abstract class DataProviderPlugin extends NexusPlugin {
  abstract readonly supportedSymbols: string[];

  abstract getOHLCV(
    symbol: string,
    startDate: Date,
    endDate: Date,
    interval: string
  ): Promise<OHLCV[]>;

  abstract getLatestPrice(symbol: string): Promise<number | null>;
}

// ============================================================================
// Indicator Plugin
// ============================================================================

export interface IndicatorInput {
  data: OHLCV[];
  params: Record<string, number>;
}

export interface IndicatorOutput {
  values: number[];
  signals?: ('buy' | 'sell' | null)[];
}

export abstract class IndicatorPlugin extends NexusPlugin {
  abstract readonly defaultParams: Record<string, number>;

  abstract calculate(input: IndicatorInput): IndicatorOutput;
}

// ============================================================================
// Signal Plugin
// ============================================================================

export type SignalType = 'buy' | 'sell' | 'hold';

export interface Signal {
  symbol: string;
  type: SignalType;
  strength: number; // 0-1
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export abstract class SignalPlugin extends NexusPlugin {
  abstract generate(data: OHLCV[]): Promise<Signal[]>;
}

// ============================================================================
// Risk Plugin
// ============================================================================

export interface Position {
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
}

export interface RiskMetrics {
  portfolioRisk: number;
  positionRisks: Map<string, number>;
  suggestions: string[];
}

export abstract class RiskPlugin extends NexusPlugin {
  abstract evaluate(positions: Position[]): RiskMetrics;
}

// ============================================================================
// Plugin Context
// ============================================================================

export interface PluginContext {
  readonly dataDir: string;
  readonly configDir: string;

  log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void;
  getConfig<T>(key: string): T | undefined;
  setConfig<T>(key: string, value: T): void;
}

// ============================================================================
// Plugin Registration
// ============================================================================

export function definePlugin<T extends NexusPlugin>(
  PluginClass: new (context: PluginContext) => T
): (context: PluginContext) => T {
  return (context: PluginContext) => new PluginClass(context);
}
