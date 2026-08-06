/**
 * Data Source Types
 *
 * PLUGIN_TICKET_018: Shared data source types for Tier 0 foundation plugin.
 * Consumed by both back-test-nexus and quant-lab-nexus.
 */

import type { BarInterval } from '@StratCraft/types';

export type DataSourceRegion = 'us-global' | 'crypto' | 'cn-ashare' | 'imported';

export interface DataSourceOption {
  id: string;
  name: string;
  /** TICKET_588: 'not-configured' for missing credentials (amber dot) */
  status: 'connected' | 'disconnected' | 'error' | 'checking' | 'not-configured';
  requiresAuth: boolean;
  /** TICKET_332: Connection probe latency in milliseconds */
  latencyMs?: number;
  /** TICKET_305: Provider-supported intervals in UI notation */
  intervals?: string[];
  /** TICKET_305: Max lookback per interval (e.g. { '1m': '7d' }) */
  maxLookback?: Record<string, string>;
  /**
   * TICKET_308_1a (Phase 7): which kind of data source this entry is.
   *  - 'provider' (default/absent): a live IDataProvider -- its symbol typeahead
   *    pulls from the remote provider via `data:searchSymbols`.
   *  - 'imported': a BYOD imported package (TICKET_308). It is NOT a registered
   *    provider, so its symbol axis MUST read the on-disk cache inventory
   *    (`data:listSegments` filtered by provider = package name) instead --
   *    calling `searchSymbols`/`getSymbolDateRange` would throw, because the
   *    provider chain has no entry for the package id (provider-manager throws
   *    on an unknown id). This is the renderer-side discriminator for the
   *    symbol-axis fork.
   */
  kind?: 'provider' | 'imported';
  /** TICKET_904_4: Region group for dropdown grouping */
  region?: DataSourceRegion;
}

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange?: string;
  type?: string;
  /** Data availability start time from backend */
  startTime?: string;
  /** Data availability end time from backend */
  endTime?: string;
}

/**
 * TICKET_641_10: Symbol search response with truncation metadata.
 */
export interface SymbolSearchResponse {
  results: SymbolSearchResult[];
  totalCount: number;
  truncated: boolean;
}

export type TimeframeOption = BarInterval;
