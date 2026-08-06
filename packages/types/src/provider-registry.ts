/**
 * TICKET_077_28_R1: Tier-0 provider-shape registry.
 *
 * Promoted from the plugin-layer `tool-sweep/universes.ts` (Tier 1 business
 * plugin) per TICKET_077_28 Status log entry (d) on 2026-06-11. The pieces
 * that describe the provider universe -- which providers exist, which carry
 * a subset dimension, what their default symbol lists are, what yfinance
 * intraday history limits look like -- are NOT sweep-specific. They are the
 * Tier 0 truth that every business plugin consumes:
 *
 *   - quant-lab-nexus (sweep training)            -- existing consumer
 *   - 927_1 trading-side market picker            -- future consumer
 *   - 927 execution surface (live, broker, IBKR)  -- future consumer
 *   - any future portfolio / paper-trading plugin -- future consumer
 *
 * Per PLUGIN_TICKET_009 / PLUGIN_TICKET_021, Tier 1 plugins cannot import
 * sideways from one another. Leaving this registry inside quant-lab-nexus
 * would force every other consumer to either reimplement it or import
 * sideways across business plugins -- both forbidden by the tier model.
 *
 * Sweep-only residue (PooledNormalisationStance, the TICKET_923 interval-
 * refresh contract, the yfinance-intraday history-window warning copy)
 * stays in quant-lab-nexus.
 *
 * Provider shape:
 *   - Shape A (single-market): subset === null, e.g. alpaca, ccxt, dukascopy.
 *   - Shape B (multi-subset):  subset !== null, e.g. yfinance (index
 *     universe), future ibkr (asset class). `isMultiAssetProvider` is the
 *     shape discriminator.
 *
 * @see TICKET_077_28
 * @see TICKET_077_28_R1 (this lift)
 * @see TICKET_927_2_2   (DataProviderId Tier-0 promotion -- prerequisite)
 */

import type { DataProviderId } from './data-provider-id';
import {
  PROVIDER_YFINANCE, PROVIDER_CCXT, PROVIDER_ALPACA, PROVIDER_DUKASCOPY,
  PROVIDER_CLICKHOUSE, PROVIDER_BAOSTOCK, PROVIDER_AKSHARE, PROVIDER_TUSHARE,
  PROVIDER_DATABENTO,
} from './data-provider-id';
import { MARKET_ASSET_CLASS, isMarketId, isDynamicMarketId, assetClassOf } from './market-id';
import type { AssetClass, MarketId, AnyMarketId } from './market-id';
import { INTERVAL_1m, INTERVAL_5m, INTERVAL_15m, INTERVAL_30m } from './interval-constants';

// ---------------------------------------------------------------------------
// Symbol arrays. Reference data, naturally Tier 0. Re-used by sweep-side
// CURATED_UNIVERSES (which stays in quant-lab-nexus).
// ---------------------------------------------------------------------------

/**
 * TICKET_880_5_11: S&P 500 top-65 candidate pool (~2026-05 snapshot).
 * 50 core + 15 backup (next tier by market cap). The orchestrator's
 * quality filter slices to targetSize=50 at runtime; the 15 backup
 * symbols absorb IEX sparsity, short-history IPOs, and download failures.
 */
export const SP500_TOP65: readonly string[] = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'GOOG', 'BRK.B', 'LLY', 'AVGO',
  'TSLA', 'JPM', 'WMT', 'V', 'XOM', 'UNH', 'MA', 'JNJ', 'PG', 'COST',
  'ORCL', 'HD', 'BAC', 'ABBV', 'NFLX', 'CVX', 'KO', 'CRM', 'TMUS', 'AMD',
  'MRK', 'PEP', 'ADBE', 'TMO', 'LIN', 'CSCO', 'WFC', 'ACN', 'MCD', 'ABT',
  'DIS', 'IBM', 'GE', 'AXP', 'NOW', 'PM', 'CAT', 'ISRG', 'INTU', 'QCOM',
  'TXN', 'VZ', 'GS', 'DHR', 'BKNG', 'NEE', 'RTX', 'SPGI', 'T', 'AMGN',
  'PFE', 'UBER', 'LOW', 'HON', 'UNP',
];

/**
 * TICKET_196_7_5_2_3_1: full S&P 500 constituent basket (~2026-05 snapshot).
 * 500 names -- wide cross-section for factor-scale rank-IC.
 */
export const SP500_500: readonly string[] = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'GOOG', 'BRK.B', 'LLY', 'AVGO',
  'TSLA', 'JPM', 'WMT', 'V', 'XOM', 'UNH', 'MA', 'JNJ', 'PG', 'COST',
  'ORCL', 'HD', 'BAC', 'ABBV', 'NFLX', 'CVX', 'KO', 'CRM', 'TMUS', 'AMD',
  'MRK', 'PEP', 'ADBE', 'TMO', 'LIN', 'CSCO', 'WFC', 'ACN', 'MCD', 'ABT',
  'DIS', 'IBM', 'GE', 'AXP', 'NOW', 'PM', 'CAT', 'ISRG', 'INTU', 'QCOM',
  'TXN', 'VZ', 'GS', 'DHR', 'BKNG', 'NEE', 'RTX', 'SPGI', 'T', 'AMGN',
  'PFE', 'UBER', 'LOW', 'HON', 'UNP', 'PGR', 'AMAT', 'BLK', 'SYK', 'ETN',
  'BSX', 'COP', 'C', 'TJX', 'VRTX', 'ADP', 'MS', 'GILD', 'SCHW', 'BX',
  'MU', 'LMT', 'MDT', 'FI', 'PLD', 'REGN', 'CB', 'ANET', 'MMC', 'DE',
  'ADI', 'BMY', 'PANW', 'SBUX', 'KLA', 'MO', 'SO', 'ELV', 'ICE', 'CME',
  'DUK', 'SHW', 'WM', 'TT', 'CI', 'INTC', 'EQIX', 'PH', 'MCK', 'AON',
  'PNC', 'CDNS', 'USB', 'CL', 'ITW', 'SNPS', 'MSI', 'CMG', 'APH', 'GD',
  'ZTS', 'NOC', 'EMR', 'FCX', 'TDG', 'MDLZ', 'COF', 'WELL', 'CVS', 'MAR',
  'ORLY', 'CRWD', 'HCA', 'BDX', 'CTAS', 'ECL', 'AJG', 'TGT', 'CARR', 'ABNB',
  'NXPI', 'APD', 'ROP', 'RSG', 'GM', 'FDX', 'PCAR', 'SLB', 'NSC', 'DLR',
  'CHTR', 'OXY', 'AFL', 'MET', 'TFC', 'AMP', 'TRV', 'PSA', 'SPG', 'AIG',
  'KMB', 'GEV', 'CPRT', 'O', 'PAYX', 'AZO', 'MNST', 'NEM', 'BK', 'ROST',
  'AEP', 'D', 'CMI', 'KMI', 'FIS', 'COR', 'PSX', 'KVUE', 'MPC', 'FTNT',
  'ALL', 'HLT', 'TEL', 'OKE', 'GWW', 'DHI', 'WMB', 'F', 'JCI', 'SRE',
  'CCI', 'IDXX', 'MSCI', 'AME', 'CSX', 'PRU', 'KR', 'VLO', 'IQV', 'HWM',
  'PCG', 'A', 'GIS', 'PWR', 'CTVA', 'YUM', 'VRSK', 'OTIS', 'DAL', 'EW',
  'KDP', 'EXC', 'GEHC', 'ACGL', 'CBRE', 'LHX', 'EA', 'FAST', 'STZ', 'IR',
  'HES', 'XEL', 'RCL', 'LEN', 'NUE', 'ROK', 'PEG', 'CTSH', 'ODFL', 'IT',
  'VICI', 'MLM', 'CCL', 'KHC', 'DD', 'DXCM', 'EXR', 'GRMN', 'EFX', 'WAB',
  'VMC', 'TRGP', 'ED', 'CAH', 'HIG', 'KEYS', 'EIX', 'DG', 'AVB', 'WEC',
  'MCHP', 'GLW', 'ANSS', 'MTB', 'EBAY', 'TTWO', 'CSGP', 'XYL', 'WTW', 'FANG',
  'BRO', 'STT', 'NDAQ', 'RMD', 'FITB', 'DOW', 'GPN', 'ON', 'EQR', 'TSCO',
  'CHD', 'PPG', 'DOV', 'DFS', 'AWK', 'TROW', 'SYY', 'HPQ', 'BR', 'RJF',
  'ADM', 'NVR', 'VLTO', 'PHM', 'IRM', 'HBAN', 'HUBB', 'CDW', 'DTE', 'PPL',
  'TYL', 'BIIB', 'WST', 'CNP', 'WDC', 'FE', 'EL', 'STE', 'ROL', 'NTAP',
  'ZBH', 'WY', 'AEE', 'RF', 'MTD', 'ES', 'IFF', 'WAT', 'PTC', 'VRSN',
  'STX', 'TDY', 'K', 'CINF', 'BLDR', 'CFG', 'INVH', 'CMS', 'LYB', 'NRG',
  'SBAC', 'ULTA', 'LH', 'CBOE', 'COO', 'EXPE', 'PFG', 'ATO', 'ZBRA', 'BBY',
  'OMC', 'MAA', 'CLX', 'LDOS', 'DRI', 'PKG', 'HOLX', 'MKC', 'WRB', 'BALL',
  'TXT', 'DGX', 'EQT', 'AVY', 'SWKS', 'GPC', 'FDS', 'NTRS', 'ARE', 'J',
  'LUV', 'AKAM', 'JBHT', 'WBD', 'L', 'EXPD', 'ESS', 'TER', 'KEY', 'BG',
  'IP', 'MAS', 'CE', 'VTR', 'DPZ', 'POOL', 'JBL', 'GEN', 'PODD', 'SNA',
  'TPL', 'AMCR', 'KIM', 'HST', 'SWK', 'EG', 'IEX', 'TRMB', 'NDSN', 'DOC',
  'CAG', 'UDR', 'LNT', 'JKHY', 'BAX', 'EVRG', 'VTRS', 'INCY', 'RVTY', 'CF',
  'AES', 'CPT', 'SJM', 'NI', 'BEN', 'PNR', 'REG', 'ALB', 'ALLE', 'FFIV',
  'TAP', 'MOH', 'UHS', 'STLD', 'HRL', 'KMX', 'EPAM', 'PNW', 'WYNN', 'JNPR',
  'AIZ', 'LKQ', 'DVA', 'EMN', 'CHRW', 'FOXA', 'FOX', 'TFX', 'GL', 'APTV',
  'MGM', 'PAYC', 'HSIC', 'CPB', 'AOS', 'MKTX', 'NWSA', 'NWS', 'BWA', 'WBA',
  'CRL', 'TECH', 'HAS', 'RL', 'MTCH', 'CZR', 'MOS', 'IPG', 'BXP', 'HII',
  'PARA', 'FRT', 'NCLH', 'GNRC', 'DAY', 'CTLT', 'APA', 'MHK', 'ENPH', 'SOLV',
  'BBWI', 'IVZ', 'LW', 'CNC', 'ALGN', 'DECK', 'SMCI', 'KKR', 'GDDY', 'PLTR',
  'DELL', 'VST', 'ERIE', 'AXON', 'TPR', 'COIN', 'SW', 'WSM', 'LII',
  'CPAY', 'FSLR', 'DLTR', 'BF.B', 'WTRG', 'TKO',
  'CSL', 'AAL', 'UAL', 'LVS', 'BKR', 'OKTA',
];

/**
 * TICKET_880_5_11: top crypto by 30-day spot volume, CCXT-native pairs.
 * yfinance variants (`BTC-USD`) are intentionally NOT registered (TICKET_802).
 */
export const CRYPTO_TOP40_CCXT: readonly string[] = [
  'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT',
  'DOGE/USDT', 'ADA/USDT', 'TRX/USDT', 'AVAX/USDT', 'LINK/USDT',
  'DOT/USDT', 'MATIC/USDT', 'LTC/USDT', 'BCH/USDT', 'UNI/USDT',
  'ATOM/USDT', 'XLM/USDT', 'NEAR/USDT', 'APT/USDT', 'ICP/USDT',
  'FIL/USDT', 'ARB/USDT', 'OP/USDT', 'INJ/USDT', 'AAVE/USDT',
  'MKR/USDT', 'IMX/USDT', 'GRT/USDT', 'SAND/USDT', 'AXS/USDT',
  'RUNE/USDT', 'SUI/USDT', 'SEI/USDT', 'TIA/USDT', 'JUP/USDT',
  'WIF/USDT', 'PENDLE/USDT', 'STX/USDT', 'FET/USDT', 'RNDR/USDT',
];

/** G10 majors in yfinance format (with `=X` suffix). */
export const G10_FX_YFINANCE: readonly string[] = [
  'EURUSD=X', 'USDJPY=X', 'GBPUSD=X', 'USDCHF=X', 'USDCAD=X',
  'AUDUSD=X', 'NZDUSD=X', 'USDSEK=X', 'USDNOK=X',
];

/** G10 majors in Dukascopy's native format (no `=X` suffix). */
export const G10_FX_DUKASCOPY: readonly string[] = [
  'EURUSD', 'USDJPY', 'GBPUSD', 'USDCHF', 'USDCAD',
  'AUDUSD', 'NZDUSD', 'USDSEK', 'USDNOK',
];

/** 11 SPDR sector ETFs -- canonical sector-rotation universe. */
export const US_SECTOR_ETFS: readonly string[] = [
  'XLC', 'XLY', 'XLP', 'XLE', 'XLF',
  'XLV', 'XLI', 'XLB', 'XLRE', 'XLK', 'XLU',
];

/**
 * TICKET_958: Databento local-parquet US-50 research universe.
 *
 * Snapshot of the local equities-hist parquet directory `{symbol}/1m.parquet`
 * directory contents on 2026-06-14 -- the exact 50-symbol universe
 * `train_sweep_local.py::_discover_symbols()` enumerates and the universe
 * TICKET_939_2's `sweep_20260613T102316Z/summary.json` was trained on.
 *
 * This is a research-only constant. The Databento provider itself is gated
 * at registration time by `STRATCRAFT_RESEARCH_MODE=1` in
 * provider-manager.ts; the symbol list is harmless in a packaged build
 * because the provider is never registered, so no consumer ever resolves
 * the `databento_us50_1m` universe in that build.
 *
 * Order matches the TICKET_939_2 sweep manifest so a re-run produces the
 * same per-symbol fold geometry (alphabetical, which is also
 * `os.listdir()` output on the ingestion server's filesystem).
 */
export const DATABENTO_US50: readonly string[] = [
  'AAPL', 'ABBV', 'ABT',  'ACN',  'ADBE',
  'AMD',  'AMGN', 'AMZN', 'AVGO', 'BAC',
  'BRK.B','CMCSA','COST', 'CRM',  'CSCO',
  'CVX',  'DHR',  'GE',   'GOOGL','HD',
  'IBM',  'INTU', 'ISRG', 'JNJ',  'JPM',
  'KO',   'LIN',  'LLY',  'MA',   'MCD',
  'META', 'MRK',  'MSFT', 'NEE',  'NFLX',
  'NVDA', 'PEP',  'PG',   'PM',   'QCOM',
  'RTX',  'TMO',  'TSLA', 'TXN',  'UNH',
  'V',    'VZ',   'WFC',  'WMT',  'XOM',
];

// ---------------------------------------------------------------------------
// Data Source Slot model
// (was TICKET_196_7_5_2_3_3_3 D1 in tool-sweep/universes.ts)
// ---------------------------------------------------------------------------

export interface DataSourceSlot {
  provider: DataProviderId;
  subset: string | null;
  symbols: string[];
  // TICKET_923: the prior `availableIntervals` field was removed. DB is the
  // single source of truth via `useImportedPackageIntervals`; no store field
  // may speak for the DB without a refresh path.

  // TICKET_077_29 Phase 2: optional Layer-3 slice intent. `null` / absent =
  // use the full universe (legacy behaviour, unchanged). Non-null applies
  // a top-N cut to whatever (provider, subset) resolved to. `getSymbolsForSlot`
  // reads this field; the data layer owns the as-of / survivorship-free
  // resolution policy (TICKET_292).
  slice?: UniverseSliceSpec | null;
}

// ---------------------------------------------------------------------------
// TICKET_077_29: Universe slice (Layer 3) spec
//
// Lifted to Tier 0 alongside DataSourceSlot so trading-side callers
// (927_1 market picker) can carry the same intent shape without reaching
// into the strategy-builder-nexus plugin. The UI primitive itself stays
// in strategy-builder-nexus/components/ui/UniverseSliceSelector.tsx -- this
// is the type-level shape only.
// ---------------------------------------------------------------------------

/** Caller's domain ranking metric id. Opaque string at this tier. */
export type RankingMetricId = string;

export interface UniverseSliceSpec {
  topN: number;
  rankingMetric: RankingMetricId;
}

// ---------------------------------------------------------------------------
// yfinance subset registry
// (was TICKET_196_7_5_2_3_3_3 D4)
// ---------------------------------------------------------------------------

export interface YfinanceSubset {
  id: string;
  labelKey: string;
  symbols: readonly string[];
}

export const YFINANCE_SUBSETS: readonly YfinanceSubset[] = [
  { id: 'yf_us_equity',   labelKey: 'toolSweep.dataSourcePicker.subset.yf_us_equity',   symbols: SP500_TOP65 },
  { id: 'yf_g10_fx',      labelKey: 'toolSweep.dataSourcePicker.subset.yf_g10_fx',      symbols: G10_FX_YFINANCE },
  { id: 'yf_sector_etfs', labelKey: 'toolSweep.dataSourcePicker.subset.yf_sector_etfs', symbols: US_SECTOR_ETFS },
  { id: 'yf_sp500_full',  labelKey: 'toolSweep.dataSourcePicker.subset.yf_sp500_full',  symbols: SP500_500 },
];

// ---------------------------------------------------------------------------
// Provider group registry for the picker dropdown
// (was TICKET_196_7_5_2_3_3_3 D3)
// ---------------------------------------------------------------------------

export type ProviderGroup = 'us_global' | 'crypto' | 'cn_a_share' | 'research' | 'my_data';

export interface ProviderGroupEntry {
  group: ProviderGroup;
  groupLabelKey: string;
  providers: readonly {
    id: DataProviderId;
    labelKey: string;
    byok: boolean;
    /**
     * TICKET_958_5 follow-up: a provider gated at registration time by
     * `STRATCRAFT_RESEARCH_MODE=1` (provider-manager.ts:360). Catalog
     * always lists it so the type-level truth stays complete; consumers
     * pass `includeResearch: true` to `flattenProviderCatalog` only when
     * the runtime confirms the env var is set. `undefined` is treated
     * as `false`. Packaged releases never set the flag, so the consumer
     * never opts in -- mirroring the runtime gate at the picker layer.
     */
    researchOnly?: boolean;
  }[];
}

export const PROVIDER_GROUPS: readonly ProviderGroupEntry[] = [
  {
    group: 'us_global',
    groupLabelKey: 'toolSweep.dataSourcePicker.group.usGlobal',
    providers: [
      { id: PROVIDER_YFINANCE,  labelKey: 'toolSweep.dataSourcePicker.provider.yfinance',  byok: false },
      { id: PROVIDER_DUKASCOPY, labelKey: 'toolSweep.dataSourcePicker.provider.dukascopy', byok: false },
      { id: PROVIDER_ALPACA,    labelKey: 'toolSweep.dataSourcePicker.provider.alpaca',    byok: true },
    ],
  },
  {
    group: 'crypto',
    groupLabelKey: 'toolSweep.dataSourcePicker.group.crypto',
    providers: [
      { id: PROVIDER_CCXT, labelKey: 'toolSweep.dataSourcePicker.provider.ccxt', byok: false },
    ],
  },
  {
    group: 'cn_a_share',
    groupLabelKey: 'toolSweep.dataSourcePicker.group.cnAShare',
    providers: [
      { id: PROVIDER_AKSHARE,  labelKey: 'toolSweep.dataSourcePicker.provider.akshare',  byok: false },
      { id: PROVIDER_TUSHARE,  labelKey: 'toolSweep.dataSourcePicker.provider.tushare',  byok: true },
      { id: PROVIDER_BAOSTOCK, labelKey: 'toolSweep.dataSourcePicker.provider.baostock', byok: false },
    ],
  },
  // TICKET_958_5 follow-up: research-only providers. Listed in Tier-0
  // catalog so the type story stays complete; visibility at the UI layer
  // is gated through `flattenProviderCatalog({ includeResearch: true })`
  // which a consumer only sets after confirming runtime research mode
  // via the IPC `app:research-mode` channel. Packaged releases never opt
  // in, mirroring the provider-manager.ts registration gate.
  {
    group: 'research',
    groupLabelKey: 'toolSweep.dataSourcePicker.group.research',
    providers: [
      { id: PROVIDER_DATABENTO, labelKey: 'toolSweep.dataSourcePicker.provider.databento', byok: false, researchOnly: true },
    ],
  },
];

// ---------------------------------------------------------------------------
// TICKET_932_1: dynamic provider options -- pure data layer.
//
// Single shared helper for the three PROVIDER_GROUPS consumers
// (SweepDataSourcePicker, SignalSourcePicker market row, SignalExplorer
// provider facet). i18n label resolution stays in each consumer (one
// `t(option.labelKey)` call); the React hook wrapper is deferred to
// TICKET_932.
// ---------------------------------------------------------------------------

/** Flattened catalog entry. Same shape as the leaf in
 *  `PROVIDER_GROUPS[*].providers[*]`, plus the parent-group fields so a
 *  consumer that wants grouping (077/028) does not have to re-derive
 *  them, and a consumer that does not (930, 931) can ignore them. */
export interface ProviderOption {
  id: DataProviderId;
  labelKey: string;
  byok: boolean;
  group: ProviderGroup;
  groupLabelKey: string;
  /** Mirrors `ProviderGroupEntry.providers[].researchOnly`. Surfaced on
   *  the flattened option so consumers (e.g. a Trading-side picker that
   *  must never list research-only providers regardless of mode) can
   *  filter on it without re-walking the grouped catalog. */
  researchOnly?: boolean;
}

/** Options for `flattenProviderCatalog`. */
export interface FlattenOptions {
  /** Extra groups to append AFTER the static `PROVIDER_GROUPS` entries.
   *  TICKET_932_2: BYOD imported packages enter through this channel. */
  extraGroups?: readonly ProviderGroupEntry[];
  /** When `true`, include providers with `researchOnly: true`. Default
   *  `false`. Consumers should only pass `true` after confirming the
   *  runtime research-mode flag (IPC `app:research-mode`) is set --
   *  packaged release renderers never opt in. */
  includeResearch?: boolean;
}

/** Flattens the Tier-0 catalog in declaration order. Pure -- callable
 *  outside React. Consumers that need a different sort order (930 wants
 *  catalog order; 931 wants by localised label; 077/028 wants grouped)
 *  sort the returned array after `t(option.labelKey)` resolution -- the
 *  helper does NOT sort, on purpose (catalog order is the only order
 *  knowable without i18n).
 *
 *  TICKET_932_2: the optional `extraGroups` parameter (default `[]`) is
 *  appended AFTER the static `PROVIDER_GROUPS` entries, in declaration
 *  order. The synthetic `my_data` group built by
 *  `buildImportedPackageGroup()` for BYOD imported packages is the
 *  intended caller; any consumer that has runtime-discovered providers
 *  (DB rows, marketplace entries) may inject them through the same
 *  parameter. Tier-0 stays free of `window.electronAPI` -- the IPC
 *  subscription lives in the renderer-side `useProviderOptions` hook
 *  (TICKET_932_2 Decision 1).
 *
 *  TICKET_958_5 follow-up: legacy callers passing a bare
 *  `ProviderGroupEntry[]` keep working (the function accepts an array
 *  for backward compatibility). New callers pass `FlattenOptions` to
 *  opt into research-only providers. `includeResearch: false` (the
 *  default) is the packaged-release contract. */
export function flattenProviderCatalog(
  extraGroupsOrOptions: readonly ProviderGroupEntry[] | FlattenOptions = [],
): readonly ProviderOption[] {
  const isArrayForm = Array.isArray(extraGroupsOrOptions);
  const extraGroups: readonly ProviderGroupEntry[] = isArrayForm
    ? (extraGroupsOrOptions as readonly ProviderGroupEntry[])
    : ((extraGroupsOrOptions as FlattenOptions).extraGroups ?? []);
  const includeResearch = !isArrayForm
    && (extraGroupsOrOptions as FlattenOptions).includeResearch === true;

  const out: ProviderOption[] = [];
  for (const group of PROVIDER_GROUPS) {
    for (const provider of group.providers) {
      if (provider.researchOnly === true && !includeResearch) continue;
      out.push({
        id: provider.id,
        labelKey: provider.labelKey,
        byok: provider.byok,
        group: group.group,
        groupLabelKey: group.groupLabelKey,
        ...(provider.researchOnly === true ? { researchOnly: true } : {}),
      });
    }
  }
  for (const group of extraGroups) {
    for (const provider of group.providers) {
      if (provider.researchOnly === true && !includeResearch) continue;
      out.push({
        id: provider.id,
        labelKey: provider.labelKey,
        byok: provider.byok,
        group: group.group,
        groupLabelKey: group.groupLabelKey,
        ...(provider.researchOnly === true ? { researchOnly: true } : {}),
      });
    }
  }
  return out;
}

/** O(catalog) lookup by id. Returns `null` for ids not present in the
 *  catalog (TICKET_858: callers MUST treat this as "unknown -- visible
 *  under the unfiltered view, never silently dropped"; the helper does
 *  not throw). `null` input also returns `null` so legacy rows with
 *  `definitionProvider: null` flow through the same code path.
 *
 *  TICKET_932_2: `extraGroups` mirrors the `flattenProviderCatalog`
 *  signature so a BYOD package id resolves to its synthetic `my_data`
 *  entry instead of returning `null` (which would mis-label the chip's
 *  provider as "unknown" in any consumer that uses this helper to
 *  build a known-id Set). */
export function findProviderOption(
  id: string | null,
  extraGroups: readonly ProviderGroupEntry[] = [],
): ProviderOption | null {
  if (id === null) return null;
  for (const group of PROVIDER_GROUPS) {
    for (const provider of group.providers) {
      if (provider.id === id) {
        return {
          id: provider.id,
          labelKey: provider.labelKey,
          byok: provider.byok,
          group: group.group,
          groupLabelKey: group.groupLabelKey,
          ...(provider.researchOnly === true ? { researchOnly: true } : {}),
        };
      }
    }
  }
  for (const group of extraGroups) {
    for (const provider of group.providers) {
      if (provider.id === id) {
        return {
          id: provider.id,
          labelKey: provider.labelKey,
          byok: provider.byok,
          group: group.group,
          groupLabelKey: group.groupLabelKey,
          ...(provider.researchOnly === true ? { researchOnly: true } : {}),
        };
      }
    }
  }
  return null;
}

/** Single place that encodes the TICKET_858 "unknown id is visible
 *  under the unfiltered view" rule. Returns `true` when the chip should
 *  be visible given the current selection set.
 *
 *  Contract (matches 930 Section 4 decisions 7/9 and 931 Section 4 decisions 6/7):
 *    - selectedIds empty            -> always visible (the "All" case)
 *    - selectedIds non-empty,
 *      providerId in catalog
 *      and in selectedIds           -> visible
 *    - selectedIds non-empty,
 *      providerId in catalog
 *      and not in selectedIds       -> hidden
 *    - selectedIds non-empty,
 *      providerId null              -> hidden (legacy row, no attribution)
 *    - selectedIds non-empty,
 *      providerId not in catalog    -> hidden (unknown -- only visible
 *                                     when no specific provider is checked)
 *
 *  The "warn once per unknown id" behaviour (931 Section 4 decision 7) stays
 *  at the consumer -- this helper is pure and does not log. */
export function isProviderVisibleUnderSelection(
  providerId: string | null,
  selectedIds: ReadonlySet<string>,
): boolean {
  if (selectedIds.size === 0) return true;
  if (providerId === null) return false;
  return selectedIds.has(providerId);
}

/**
 * TICKET_932_2: build the synthetic `my_data` ProviderGroupEntry from a
 * BYOD imported-package list. Used by `useProviderOptions` to inject
 * runtime-discovered packages into `flattenProviderCatalog(extraGroups)`.
 *
 * Returns `null` when the list is empty -- consumers can spread the
 * result through `extraGroups: group ? [group] : []` without a stray
 * empty-group entry leaking into the flattened catalog.
 *
 * Shape mirrors the in-component splice that
 * `SweepDataSourcePicker.tsx:141-160` built pre-932_2 (Decision 3 of
 * TICKET_932_2): `id` = `labelKey` = the user's packageName, `byok:
 * false` (imported packages are local artefacts, not BYOK-API
 * providers), group label key reuses the existing
 * `toolSweep.dataSourcePicker.group.myData` locale entry.
 *
 * `DataProviderId` is a string union at the type level but the BYOD
 * packageName is a runtime-discovered string the union cannot enumerate.
 * The `as DataProviderId` cast is the documented widening point for
 * runtime-discovered providers and matches the existing pre-932_2
 * `pkg.packageName as DataProviderId` cast in
 * `SweepDataSourcePicker.tsx:154`.
 */
export function buildImportedPackageGroup(
  packages: readonly { packageName: string }[],
): ProviderGroupEntry | null {
  if (packages.length === 0) return null;
  return {
    group: 'my_data',
    groupLabelKey: 'toolSweep.dataSourcePicker.group.myData',
    providers: packages.map((pkg) => ({
      id: pkg.packageName as DataProviderId,
      labelKey: pkg.packageName,
      byok: false,
    })),
  };
}

/**
 * TICKET_077_28 Status log (a) (2026-06-11): "subset dimension is
 * provider-shape, not yfinance-shape." Today yfinance is the sole
 * inhabitant; ibkr (Status log (b)) will be the second when 927 execution
 * drives it in. Adding a multi-subset provider is a one-line change here
 * plus a new subset table next to YFINANCE_SUBSETS.
 *
 * If/when a second multi-subset provider is added, generalise to a
 * `MULTI_SUBSET_PROVIDERS: ReadonlySet<DataProviderId>` set so this stops
 * being a string-equality check. Tracked in TICKET_077_28 Status log (c).
 */
export function isMultiAssetProvider(providerId: DataProviderId): boolean {
  return providerId === PROVIDER_YFINANCE;
}

// ---------------------------------------------------------------------------
// TICKET_1012: provider asset-class map + compatibility check.
//
// Derived from the instrument-registry-static.ts buildProvidersByMarket()
// reverse map + MARKET_ASSET_CLASS. Static declaration -- mirrors the
// existing chain (provider -> MarketId -> AssetClass) so the UI filter
// can check "do two providers serve the same asset class?" without
// importing the full instrument registry or running marketOf().
// ---------------------------------------------------------------------------

export const PROVIDER_ASSET_CLASSES: Readonly<Partial<Record<DataProviderId, readonly AssetClass[]>>> = {
  [PROVIDER_YFINANCE]:           ['us_equity', 'forex', 'crypto'],
  [PROVIDER_ALPACA]:             ['us_equity'],
  [PROVIDER_CLICKHOUSE]:         ['us_equity'],
  [PROVIDER_DATABENTO]:          ['us_equity'],
  [PROVIDER_DUKASCOPY]:          ['forex'],
  [PROVIDER_CCXT]:               ['crypto'],
  [PROVIDER_BAOSTOCK]:           ['cn_a_share'],
  [PROVIDER_TUSHARE]:            ['cn_a_share'],
  [PROVIDER_AKSHARE]:            ['cn_a_share'],
};

/**
 * TICKET_1095: resolve asset classes for any provider identifier.
 * DataProviderId -> static PROVIDER_ASSET_CLASSES lookup.
 * Imported package name -> dynamic `byod_{name}` MarketId -> assetClassOf().
 */
export function resolveProviderAssetClasses(provider: string): readonly AssetClass[] | undefined {
  const direct = PROVIDER_ASSET_CLASSES[provider as DataProviderId];
  if (direct) return direct;

  const dynamicMarket = `byod_${provider}`;
  if (isDynamicMarketId(dynamicMarket)) {
    try {
      const ac = assetClassOf(dynamicMarket as `byod_${string}`);
      return [ac];
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function isProviderAssetClassCompatible(
  signalProvider: string,
  activeProvider: string,
): boolean {
  if (signalProvider === activeProvider) return true;
  const signalAcs = resolveProviderAssetClasses(signalProvider);
  const activeAcs = resolveProviderAssetClasses(activeProvider);
  if (!signalAcs || !activeAcs) return false;
  return signalAcs.some((ac) => activeAcs.includes(ac));
}

export function isMarketScopeCompatibleWithProvider(
  marketScopeJson: string,
  activeProvider: string,
): boolean {
  const activeAcs = resolveProviderAssetClasses(activeProvider);
  if (!activeAcs) return false;
  let markets: unknown[];
  try { markets = JSON.parse(marketScopeJson); } catch { return false; }
  if (!Array.isArray(markets) || markets.length === 0) return false;
  for (const m of markets) {
    if (isMarketId(m)) {
      const ac: AssetClass = MARKET_ASSET_CLASS[m as MarketId];
      if (activeAcs.includes(ac)) return true;
    } else if (isDynamicMarketId(m)) {
      try {
        const ac = assetClassOf(m);
        if (activeAcs.includes(ac)) return true;
      } catch { /* unresolvable dynamic market -- skip */ }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// yfinance intraday history depth limits
// (was TICKET_196_7_5_2_3_3_3 D5)
// ---------------------------------------------------------------------------

export const YFINANCE_INTRADAY_LIMITS: Record<string, { days: number; i18nKey: string }> = {
  [INTERVAL_1m]:  { days: 7,  i18nKey: 'toolSweep.dataSourcePicker.yfinanceWarn.1m' },
  [INTERVAL_5m]:  { days: 60, i18nKey: 'toolSweep.dataSourcePicker.yfinanceWarn.5m' },
  [INTERVAL_15m]: { days: 60, i18nKey: 'toolSweep.dataSourcePicker.yfinanceWarn.15m30m' },
  [INTERVAL_30m]: { days: 60, i18nKey: 'toolSweep.dataSourcePicker.yfinanceWarn.15m30m' },
};

export function getYfinanceIntradayWarning(
  timeframes: readonly string[],
): { i18nKey: string; days: number } | null {
  let worst: { i18nKey: string; days: number } | null = null;
  for (const tf of timeframes) {
    const limit = YFINANCE_INTRADAY_LIMITS[tf];
    if (limit && (worst === null || limit.days < worst.days)) {
      worst = limit;
    }
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Default per-provider symbol map + slot resolver
// (was TICKET_196_7_5_2_3_3_3 Phase 2)
// ---------------------------------------------------------------------------

export const DEFAULT_PROVIDER_SYMBOLS: Partial<Record<DataProviderId, readonly string[]>> = {
  ccxt:      CRYPTO_TOP40_CCXT,
  dukascopy: G10_FX_DUKASCOPY,
  alpaca:    SP500_TOP65,
};

export function getSymbolsForSlot(slot: DataSourceSlot): string[] {
  const resolved = resolveBaseSymbols(slot);
  // TICKET_077_29 Phase 2: apply Layer-3 slice if present. The clip operates
  // on whatever (provider, subset) resolved to -- the data layer (TICKET_292)
  // owns the deeper "as-of / survivorship-free, ranked by metric" resolution,
  // and will replace this prefix-clip stub with a registry-driven ordering
  // when `IDataProvider.resolveUniverseAsOf` lands. Until then the clip keeps
  // the resolved-count UX honest (`top-50 of sp500` shows 50, not 500).
  const slice = slot.slice;
  if (slice && Number.isFinite(slice.topN) && slice.topN > 0 && slice.topN < resolved.length) {
    return resolved.slice(0, slice.topN);
  }
  return resolved;
}

function resolveBaseSymbols(slot: DataSourceSlot): string[] {
  if (slot.provider === PROVIDER_YFINANCE && slot.subset) {
    const entry = YFINANCE_SUBSETS.find(s => s.id === slot.subset);
    return entry ? [...entry.symbols] : [];
  }
  if (slot.symbols.length > 0) return slot.symbols;
  const fallback = DEFAULT_PROVIDER_SYMBOLS[slot.provider];
  return fallback ? [...fallback] : [];
}

// ---------------------------------------------------------------------------
// TICKET_077_29 Phase 2: caller-side slice config helpers.
//
// Pure Tier-0 registry lookups. The UI primitive (UniverseSliceSelector)
// remains opaque to provider identity per the ticket's "provider-shape-
// orthogonal" discipline; these helpers translate (provider, subset) into
// the inputs that `<ProviderRowList buildSliceConfig=...>` needs:
//
//   - `rankingMetricOptions` -- which metrics apply to this (provider, subset)
//   - `defaultSpec`          -- sensible default when user toggles ON
//   - `topNMax`              -- known universe size, or `Infinity` if unknown
//
// Sweep (Caller A) and 927_1 (Caller B) both read from here; the metric set
// is provider-shape, not caller-shape.
// ---------------------------------------------------------------------------

/** Minimal `SelectOption` shape mirrored from the UI tier. Defining the
 *  shape here avoids a Tier 0 -> Tier 1 import; the UI tier's
 *  `SelectOption<T>` is structurally identical for the fields we use. */
export interface RankingMetricOption {
  value: RankingMetricId;
  label: string;
}

interface RankingMetricsForKey {
  defaultMetric: RankingMetricId;
  defaultTopN: number;
  metrics: readonly RankingMetricOption[];
  /** Known universe size, or `Infinity` when not statically known. */
  knownSize: number;
}

/** Equity-style metrics (yfinance subsets, alpaca). */
const EQUITY_METRICS: readonly RankingMetricOption[] = [
  { value: 'market_cap',     label: 'Market cap' },
  { value: 'dollar_volume',  label: 'Dollar volume (30d)' },
  { value: 'liquidity_score', label: 'Liquidity score' },
];

/** Crypto-style metrics (ccxt). */
const CRYPTO_METRICS: readonly RankingMetricOption[] = [
  { value: 'volume_30d',     label: '30-day volume' },
  { value: 'dollar_volume',  label: 'Dollar volume (30d)' },
  { value: 'liquidity_score', label: 'Liquidity score' },
];

/** FX has no meaningful top-N ranking axis (G10 majors are the universe);
 *  empty array hides the selector via 077_29 hide-on-empty invariant. */
const FX_METRICS: readonly RankingMetricOption[] = [];

/** Sector ETFs: the universe IS the 11 SPDRs; no slicing axis. */
const SECTOR_ETF_METRICS: readonly RankingMetricOption[] = [];

function configFor(provider: DataProviderId, subset: string | null): RankingMetricsForKey {
  if (provider === PROVIDER_YFINANCE) {
    switch (subset) {
      case 'yf_us_equity':
        return { metrics: EQUITY_METRICS, defaultMetric: 'market_cap', defaultTopN: 50, knownSize: SP500_TOP65.length };
      case 'yf_sp500_full':
        return { metrics: EQUITY_METRICS, defaultMetric: 'market_cap', defaultTopN: 50, knownSize: SP500_500.length };
      case 'yf_g10_fx':
        return { metrics: FX_METRICS, defaultMetric: 'dollar_volume', defaultTopN: 5, knownSize: G10_FX_YFINANCE.length };
      case 'yf_sector_etfs':
        return { metrics: SECTOR_ETF_METRICS, defaultMetric: 'dollar_volume', defaultTopN: 11, knownSize: US_SECTOR_ETFS.length };
      default:
        return { metrics: EQUITY_METRICS, defaultMetric: 'market_cap', defaultTopN: 50, knownSize: Infinity };
    }
  }
  if (provider === PROVIDER_ALPACA) {
    return { metrics: EQUITY_METRICS, defaultMetric: 'dollar_volume', defaultTopN: 50, knownSize: SP500_TOP65.length };
  }
  if (provider === PROVIDER_CCXT) {
    return { metrics: CRYPTO_METRICS, defaultMetric: 'volume_30d', defaultTopN: 50, knownSize: CRYPTO_TOP40_CCXT.length };
  }
  if (provider === PROVIDER_DUKASCOPY) {
    return { metrics: FX_METRICS, defaultMetric: 'dollar_volume', defaultTopN: 5, knownSize: G10_FX_DUKASCOPY.length };
  }
  // akshare / tushare / baostock / imported packages: no static ranking-metric
  // registry yet. Returning empty metrics hides the selector entirely per
  // 077_29 Behaviour invariant #2.
  return { metrics: [], defaultMetric: 'dollar_volume', defaultTopN: 50, knownSize: Infinity };
}

/** Ranking metrics valid for the (provider, subset) pair. Empty array =
 *  this configuration does not support slicing; the row primitive hides
 *  the selector entirely (077_29 hide-on-empty invariant). */
export function getRankingMetricsFor(
  provider: DataProviderId,
  subset: string | null,
): readonly RankingMetricOption[] {
  return configFor(provider, subset).metrics;
}

/** Default `{ topN, rankingMetric }` used when the user toggles slice ON
 *  for the first time on this (provider, subset). */
export function getDefaultSliceFor(
  provider: DataProviderId,
  subset: string | null,
): UniverseSliceSpec {
  const cfg = configFor(provider, subset);
  return { topN: cfg.defaultTopN, rankingMetric: cfg.defaultMetric };
}

/** Statically known universe size for the (provider, subset) pair, or
 *  `Infinity` when the size is not statically known (e.g. ccxt where the
 *  exchange's pair list is fetched async, imported packages whose symbol
 *  set comes from the DuckDB catalog). The 077_29 primitive does NOT fetch
 *  the universe size to compute max -- this is caller-side. */
export function getKnownUniverseSize(
  provider: DataProviderId,
  subset: string | null,
): number {
  return configFor(provider, subset).knownSize;
}
