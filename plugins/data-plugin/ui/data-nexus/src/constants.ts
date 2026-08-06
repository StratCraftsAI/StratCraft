/**
 * Data Plugin Constants
 *
 * PLUGIN_TICKET_018: Shared constants for data source configuration.
 * TICKET_1023_3: Provider ID constants. Canonical source:
 *   packages/types/src/data-provider-id.ts (PROVIDER_* exports).
 */

import {
  PROVIDER_YFINANCE, PROVIDER_DUKASCOPY, PROVIDER_ALPACA,
  PROVIDER_CCXT, PROVIDER_AKSHARE, PROVIDER_TUSHARE, PROVIDER_BAOSTOCK,
} from '@StratCraft/types';
import type { DataSourceRegion } from './types/data-source';

/** @see PROVIDER_YFINANCE in packages/types/src/data-provider-id.ts */
export const DEFAULT_DATA_SOURCE = PROVIDER_YFINANCE;

/** Provider -> region mapping. Keys use PROVIDER_* constants from
 *  packages/types/src/data-provider-id.ts. */
export const PROVIDER_REGION_MAP: Readonly<Record<string, DataSourceRegion>> = {
  [PROVIDER_YFINANCE]: 'us-global',
  [PROVIDER_DUKASCOPY]: 'us-global',
  [PROVIDER_ALPACA]: 'us-global',
  [PROVIDER_CCXT]: 'crypto',
  [PROVIDER_AKSHARE]: 'cn-ashare',
  [PROVIDER_TUSHARE]: 'cn-ashare',
  [PROVIDER_BAOSTOCK]: 'cn-ashare',
};

export const REGION_DISPLAY_ORDER: readonly DataSourceRegion[] = [
  'us-global',
  'crypto',
  'cn-ashare',
  'imported',
];

export const REGION_LABEL_KEYS: Readonly<Record<DataSourceRegion, string>> = {
  'us-global': 'dataSource.region.usGlobal',
  'crypto': 'dataSource.region.crypto',
  'cn-ashare': 'dataSource.region.cnAShare',
  'imported': 'dataSource.region.myData',
};
