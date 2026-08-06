/**
 * TICKET_927_2_2: closed, additive-only set of data-provider identifiers.
 *
 * Promoted from the plugin-layer string union that previously lived at
 * `plugins/quant-lab-nexus/ui/quant-lab-nexus/src/components/tool-sweep/universes.ts:75`
 * (per TICKET_802) to a tier-0 type every consumer imports from a single
 * source of truth (TICKET_854 / TICKET_860).
 *
 * TICKET_1095: `forex_duckdb_import` was removed -- imported packages use
 * free-text package names (not DataProviderId) resolved via
 * `DataCacheManager.getImportedPackage()`.
 *
 * Additive only: a new provider is a typed migration, never a free-form
 * string. Removing a value is a breaking change that touches every
 * persisted preference setting `data.providerPreference.<MarketId>`.
 */
export const DATA_PROVIDER_IDS = [
  'yfinance',
  'ccxt',
  'alpaca',
  'dukascopy',
  'clickhouse',
  'baostock',
  'akshare',
  'tushare',
  // TICKET_958: Databento local-parquet provider. Research-only -- registered
  // by provider-manager.ts only when STRATCRAFT_RESEARCH_MODE=1 so packaged
  // builds for end users never surface it.
  'databento',
  // TICKET_1023_8: Alpha Vantage market data provider.
  'alpha_vantage',
  // TICKET_1023_8: Polygon.io market data provider.
  'polygon',
] as const;

export type DataProviderId = typeof DATA_PROVIDER_IDS[number];

/**
 * TICKET_1023_3: Named constants for every provider id.
 * Use these instead of raw string literals to satisfy the
 * "NO MAGIC NUMBERS" rule (TICKET_179).
 *
 * Each constant is typed as the narrow literal so TypeScript
 * narrowing and exhaustiveness checks work unchanged.
 */
export const PROVIDER_YFINANCE:           DataProviderId = 'yfinance';
export const PROVIDER_CCXT:               DataProviderId = 'ccxt';
export const PROVIDER_ALPACA:             DataProviderId = 'alpaca';
export const PROVIDER_DUKASCOPY:          DataProviderId = 'dukascopy';
export const PROVIDER_CLICKHOUSE:         DataProviderId = 'clickhouse';
export const PROVIDER_BAOSTOCK:           DataProviderId = 'baostock';
export const PROVIDER_AKSHARE:            DataProviderId = 'akshare';
export const PROVIDER_TUSHARE:            DataProviderId = 'tushare';
export const PROVIDER_DATABENTO:          DataProviderId = 'databento';
export const PROVIDER_ALPHA_VANTAGE:     DataProviderId = 'alpha_vantage';
export const PROVIDER_POLYGON:           DataProviderId = 'polygon';

/**
 * Type guard for runtime validation at IPC / DB / JSON boundaries.
 * Returns true iff `value` is one of the strings in `DATA_PROVIDER_IDS`.
 */
export function isDataProviderId(value: unknown): value is DataProviderId {
  return typeof value === 'string'
    && (DATA_PROVIDER_IDS as readonly string[]).includes(value);
}
