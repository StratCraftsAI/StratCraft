/**
 * CFTC Commitments of Traders (COT) Fund Flow Data Provider
 *
 * TICKET_568_5_1_b: First concrete fund_flow IAlternativeDataProvider. Pulls
 * positioning data from two CFTC report families via the Socrata JSON API
 * on `publicreporting.cftc.gov`:
 *
 *   - Disaggregated (DCOT) Futures-Only: dataset `72hh-3qpy`. Physical
 *     commodity markets only (agri / energy / metals). Categories:
 *     Producer/Merchant/Processor/User, Swap Dealers, Managed Money,
 *     Other Reportables.
 *   - Traders in Financial Futures (TFF) Futures-Only: dataset `gpe5-46if`.
 *     Financial-futures markets (equity index, Treasury, FX). Categories:
 *     Dealer/Intermediary, Asset Manager/Institutional, Leveraged Funds,
 *     Other Reportables.
 *
 * Both report families are required for full systematic coverage; shipping
 * only DCOT silently excludes equity-index / rates / FX positioning. The
 * legacy COT report is deliberately skipped (3-category schema produces
 * highly-correlated duplicate factors).
 *
 * Vintage: CFTC publishes occasional corrections but Socrata only exposes
 * the latest revised value -- no "as-first-reported" archive. Hence
 * `vintage_supported = false`; the persistence guard refuses backtest
 * registration, which is the honest behavior.
 *
 * knowledge_time contract: deterministic Friday 15:30 America/New_York with
 * roll-forward to the next US federal business day. The HTTP `Last-Modified`
 * header is captured only as audit evidence; per Socrata SODA docs that
 * header is non-essential and may be dropped, so the PIT contract cannot
 * depend on it.
 *
 * Auth: anonymous-readable up to the public Socrata rate limit. An optional
 * Socrata App Token (BYOK `cftc-cot.appToken`) raises the ceiling; absent
 * token, the provider still works.
 *
 * @see docs/design/TICKET_568_5_1_b_SIGNAL_DISCOVERY_LAYER3_FUND_FLOW_PROVIDER.md
 */

import type {
  AlternativeDataRequest,
  AlternativeFactorRow,
} from '../../../../shared/types/signal-discovery';
import type { IAlternativeDataProvider } from './types';
import { DATA_API_BASE_CFTC } from '@StratCraft/types';
import { getSecureCredentialService } from '../../secure-credential-service';
import { appLog } from '../../../utils/logger';
import { nextUsBusinessDay } from '../../../../shared/utils/us-federal-holidays';

// =============================================================================
// Constants
// =============================================================================

/**
 * BYOK plugin namespace. Mirrors fred-provider.ts -- alt-data BYOK secrets
 * live under the back-test plugin namespace, even when first wired through
 * Signal Discovery.
 */
const PLUGIN_ID = 'com.stratcraft.back-test-nexus';
const APP_TOKEN_SECRET = 'cftc-cot.appToken';

const SOCRATA_BASE_URL = DATA_API_BASE_CFTC;

/** Dataset IDs locked in TICKET_568_5_1_b Scope decision 3. */
export const DATASETS = {
  dcot: '72hh-3qpy',
  tff: 'gpe5-46if',
} as const;

export type CotReportFamily = keyof typeof DATASETS;

/**
 * Earliest report_date present on both DCOT and TFF Futures-Only datasets.
 * Caller may pass any `start_time`; provider clamps silently to this value
 * (Scope decision 5).
 */
const DATASET_EARLIEST_DATE = '2006-06-13';

/**
 * Socrata page cap. `$limit=50000` covers the full DCOT history (~1000
 * markets x ~1000 weeks ~= 1M cells, but per-market queries stay well below).
 */
const SOCRATA_PAGE_LIMIT = 50_000;

/** HTTP request timeout. Socrata responds in well under 5 s in practice. */
const SOCRATA_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Live polling cadence floor. CFTC publishes weekly on Friday 15:30 ET; the
 * release window is narrow but we accept any cadence >= 60 s to mirror
 * fred-provider.ts. Outside the Fri 15:00-18:00 ET window the loop sleeps
 * until the next window boundary.
 */
const MIN_POLL_INTERVAL_MS = 60_000;

/** Release time of day in America/New_York (15:30 ET). */
const RELEASE_HOUR_ET = 15;
const RELEASE_MIN_ET = 30;

/**
 * Maximum tolerated skew between Socrata `Last-Modified` header and the
 * calculated knowledge_time before we emit a warn audit line.
 */
const LAST_MODIFIED_SKEW_WARN_MS = 60 * 60 * 1000; // 1 h

/**
 * Field suffix vocabulary. Matches the Source-naming contract in
 * TICKET_568_5_1_b Hard Contract: alt_fund_flow_<family>_<market>_<category>_<field>.
 */
export type CotField = 'long' | 'short' | 'net' | 'net_change' | 'pct_of_oi';
const COT_FIELDS: readonly CotField[] = ['long', 'short', 'net', 'net_change', 'pct_of_oi'];

/**
 * Disaggregated (DCOT) trader categories. Each category has a long/short
 * pair in the Socrata schema (`<cat>_positions_long_all` /
 * `<cat>_positions_short_all`) plus a change-in-positions field
 * (`change_in_<cat>_long_all` etc.). The provider derives net + net_change +
 * pct_of_oi from those primitives so callers don't need to know the
 * underlying column names.
 */
interface CategorySchema {
  /** Stable code used in factor_name; lowercase, underscore-separated. */
  code: string;
  /** Socrata long-positions column. */
  longCol: string;
  /** Socrata short-positions column. */
  shortCol: string;
  /** Socrata change-in-long column (for net_change derivation). */
  changeLongCol: string;
  /** Socrata change-in-short column. */
  changeShortCol: string;
  /** Socrata long pct-of-OI column. */
  pctLongCol: string;
  /** Socrata short pct-of-OI column. */
  pctShortCol: string;
}

const DCOT_CATEGORIES: readonly CategorySchema[] = [
  {
    code: 'producer_merchant',
    longCol: 'prod_merc_positions_long_all',
    shortCol: 'prod_merc_positions_short',
    changeLongCol: 'change_in_prod_merc_long',
    changeShortCol: 'change_in_prod_merc_short',
    pctLongCol: 'pct_of_oi_prod_merc_long',
    pctShortCol: 'pct_of_oi_prod_merc_short',
  },
  {
    code: 'swap_dealer',
    longCol: 'swap_positions_long_all',
    shortCol: 'swap__positions_short_all',
    changeLongCol: 'change_in_swap_long_all',
    changeShortCol: 'change_in_swap_short_all',
    pctLongCol: 'pct_of_oi_swap_long',
    pctShortCol: 'pct_of_oi_swap_short',
  },
  {
    code: 'managed_money',
    longCol: 'm_money_positions_long_all',
    shortCol: 'm_money_positions_short',
    changeLongCol: 'change_in_m_money_long_all',
    changeShortCol: 'change_in_m_money_short',
    pctLongCol: 'pct_of_oi_m_money_long',
    pctShortCol: 'pct_of_oi_m_money_short',
  },
  {
    code: 'other_reportable',
    longCol: 'other_rept_positions_long',
    shortCol: 'other_rept_positions_short',
    changeLongCol: 'change_in_other_rept_long',
    changeShortCol: 'change_in_other_rept_short',
    pctLongCol: 'pct_of_oi_other_rept_long',
    pctShortCol: 'pct_of_oi_other_rept_short',
  },
];

const TFF_CATEGORIES: readonly CategorySchema[] = [
  {
    code: 'dealer',
    longCol: 'dealer_positions_long_all',
    shortCol: 'dealer_positions_short_all',
    changeLongCol: 'change_in_dealer_long_all',
    changeShortCol: 'change_in_dealer_short_all',
    pctLongCol: 'pct_of_oi_dealer_long_all',
    pctShortCol: 'pct_of_oi_dealer_short_all',
  },
  {
    code: 'asset_manager',
    longCol: 'asset_mgr_positions_long',
    shortCol: 'asset_mgr_positions_short',
    changeLongCol: 'change_in_asset_mgr_long',
    changeShortCol: 'change_in_asset_mgr_short',
    pctLongCol: 'pct_of_oi_asset_mgr_long',
    pctShortCol: 'pct_of_oi_asset_mgr_short',
  },
  {
    code: 'leveraged_funds',
    longCol: 'lev_money_positions_long',
    shortCol: 'lev_money_positions_short',
    changeLongCol: 'change_in_lev_money_long',
    changeShortCol: 'change_in_lev_money_short',
    pctLongCol: 'pct_of_oi_lev_money_long',
    pctShortCol: 'pct_of_oi_lev_money_short',
  },
  {
    code: 'other_reportable',
    longCol: 'other_rept_positions_long',
    shortCol: 'other_rept_positions_short',
    changeLongCol: 'change_in_other_rept_long',
    changeShortCol: 'change_in_other_rept_short',
    pctLongCol: 'pct_of_oi_other_rept_long',
    pctShortCol: 'pct_of_oi_other_rept_short',
  },
];

const FAMILY_CATEGORIES: Record<CotReportFamily, readonly CategorySchema[]> = {
  dcot: DCOT_CATEGORIES,
  tff: TFF_CATEGORIES,
};

// =============================================================================
// Socrata response shape
// =============================================================================

/**
 * One row in a Socrata DCOT or TFF response. All numeric columns arrive as
 * JSON strings (Socrata convention); we coerce at parse time. The full
 * schema has ~100 columns; we declare only the keys this provider reads,
 * plus an index signature for the rest.
 */
interface SocrataCotRow {
  market_and_exchange_names: string;
  report_date_as_yyyy_mm_dd: string; // ISO date
  open_interest_all: string;
  [column: string]: string | undefined;
}

// =============================================================================
// factor_name parsing
// =============================================================================

/**
 * factor_name vocabulary -- callers pass the trailing portion of the
 * source-name convention without the `alt_fund_flow_` prefix:
 *
 *   <family>_<market_slug>_<category>_<field>
 *
 *   family       = 'dcot' | 'tff'
 *   market_slug  = lowercase, underscore-separated, e.g. 'wti_crude' for
 *                  'CRUDE OIL, LIGHT SWEET - NEW YORK MERCANTILE EXCHANGE'
 *   category     = one of the codes in DCOT_CATEGORIES / TFF_CATEGORIES
 *   field        = 'long' | 'short' | 'net' | 'net_change' | 'pct_of_oi'
 *
 * The market_slug -> Socrata `market_and_exchange_names` mapping lives in
 * MARKET_SLUG_TO_NAME below. Unknown markets raise an explicit error
 * (NO_SILENT_FAILURES rule).
 */
interface ParsedFactor {
  family: CotReportFamily;
  marketSlug: string;
  category: CategorySchema;
  field: CotField;
}

/**
 * Slug -> Socrata `market_and_exchange_names` exact match. Kept minimal in
 * the initial cut; extending the catalog is additive. The few markets here
 * cover the dominant systematic use cases (oil, gold, S&P 500, 10y).
 * Unknown slugs fail loud per the contract.
 */
const MARKET_SLUG_TO_NAME: Record<string, string> = {
  // DCOT (physical commodities)
  wti_crude: 'CRUDE OIL, LIGHT SWEET - NEW YORK MERCANTILE EXCHANGE',
  natural_gas: 'NATURAL GAS - NEW YORK MERCANTILE EXCHANGE',
  gold: 'GOLD - COMMODITY EXCHANGE INC.',
  silver: 'SILVER - COMMODITY EXCHANGE INC.',
  copper: 'COPPER- #1 - COMMODITY EXCHANGE INC.',
  corn: 'CORN - CHICAGO BOARD OF TRADE',
  soybeans: 'SOYBEANS - CHICAGO BOARD OF TRADE',
  wheat: 'WHEAT-SRW - CHICAGO BOARD OF TRADE',
  // TFF (financial futures)
  sp500: 'E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE',
  nasdaq100: 'NASDAQ-100 Consolidated - CHICAGO MERCANTILE EXCHANGE',
  russell2000: 'RUSSELL 2000 Consolidated - CHICAGO MERCANTILE EXCHANGE',
  ust_10y: '10-YEAR U.S. TREASURY NOTES - CHICAGO BOARD OF TRADE',
  ust_30y: 'U.S. TREASURY BONDS - CHICAGO BOARD OF TRADE',
  ust_2y: '2-YEAR U.S. TREASURY NOTES - CHICAGO BOARD OF TRADE',
  eur_fx: 'EURO FX - CHICAGO MERCANTILE EXCHANGE',
  jpy_fx: 'JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE',
  gbp_fx: 'BRITISH POUND - CHICAGO MERCANTILE EXCHANGE',
  dxy: 'USD INDEX - ICE FUTURES U.S.',
};

function parseFactorName(factorName: string): ParsedFactor {
  // Greedy match on family prefix, then split remainder by last two
  // underscore boundaries to extract field + category, leaving the
  // market_slug as the middle.
  let family: CotReportFamily | null = null;
  let rest = '';
  if (factorName.startsWith('dcot_')) {
    family = 'dcot';
    rest = factorName.slice('dcot_'.length);
  } else if (factorName.startsWith('tff_')) {
    family = 'tff';
    rest = factorName.slice('tff_'.length);
  } else {
    throw new Error(
      `[CftcCotProvider] factor_name must start with 'dcot_' or 'tff_'; got '${factorName}'`,
    );
  }

  // field suffix -- longest match wins so 'net_change' is preferred over
  // 'change'. Order from longest to shortest.
  const fieldOrder: CotField[] = ['net_change', 'pct_of_oi', 'net', 'long', 'short'];
  const field = fieldOrder.find((f) => rest.endsWith(`_${f}`));
  if (!field) {
    throw new Error(
      `[CftcCotProvider] factor_name '${factorName}' missing field suffix; ` +
        `expected one of: ${COT_FIELDS.join(', ')}`,
    );
  }
  const beforeField = rest.slice(0, rest.length - field.length - 1);

  const categories = FAMILY_CATEGORIES[family];
  // Longest category code first so 'other_reportable' isn't shadowed.
  const sorted = [...categories].sort((a, b) => b.code.length - a.code.length);
  const category = sorted.find((c) => beforeField.endsWith(`_${c.code}`));
  if (!category) {
    throw new Error(
      `[CftcCotProvider] factor_name '${factorName}' missing recognized category; ` +
        `expected one of: ${categories.map((c) => c.code).join(', ')}`,
    );
  }
  const marketSlug = beforeField.slice(0, beforeField.length - category.code.length - 1);
  if (!marketSlug) {
    throw new Error(
      `[CftcCotProvider] factor_name '${factorName}' missing market_slug between family and category`,
    );
  }
  if (!(marketSlug in MARKET_SLUG_TO_NAME)) {
    throw new Error(
      `[CftcCotProvider] unknown market_slug '${marketSlug}'. ` +
        `Known slugs: ${Object.keys(MARKET_SLUG_TO_NAME).join(', ')}. ` +
        `Add the mapping to MARKET_SLUG_TO_NAME in cftc-cot-provider.ts to extend coverage.`,
    );
  }
  return { family, marketSlug, category, field };
}

// =============================================================================
// Injection seams for tests
// =============================================================================

export type CftcFetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface CftcCotProviderOptions {
  /** Override fetch for tests; defaults to global fetch. */
  fetchFn?: CftcFetchFn;
  /** Override request timeout (ms). */
  requestTimeoutMs?: number;
  /** Override Socrata App Token resolver; defaults to SecureCredentialService. */
  appTokenResolver?: () => Promise<string | null>;
}

// =============================================================================
// CftcCotProvider
// =============================================================================

export class CftcCotProvider implements IAlternativeDataProvider {
  readonly id = 'cftc-cot';
  readonly name = 'CFTC Commitments of Traders';
  readonly source = 'fund_flow' as const;
  readonly vintage_supported = false;
  readonly live_streaming_supported = true;

  private readonly fetchFn: CftcFetchFn;
  private readonly requestTimeoutMs: number;
  private readonly appTokenResolver: () => Promise<string | null>;

  constructor(opts: CftcCotProviderOptions = {}) {
    this.fetchFn = opts.fetchFn ?? ((url, init) => fetch(url, init));
    this.requestTimeoutMs = opts.requestTimeoutMs ?? SOCRATA_REQUEST_TIMEOUT_MS;
    this.appTokenResolver = opts.appTokenResolver ?? defaultAppTokenResolver;
  }

  async fetchFactorData(params: AlternativeDataRequest): Promise<AlternativeFactorRow[]> {
    if (params.category !== 'fund_flow') {
      throw new Error(
        `[CftcCotProvider] fetchFactorData: category must be 'fund_flow' (got '${params.category}')`,
      );
    }
    if (!params.factor_name) {
      throw new Error(
        `[CftcCotProvider] fetchFactorData: factor_name required (see vocabulary in cftc-cot-provider.ts)`,
      );
    }

    const parsed = parseFactorName(params.factor_name);
    const datasetId = DATASETS[parsed.family];
    const marketName = MARKET_SLUG_TO_NAME[parsed.marketSlug];

    // Clamp start_time to dataset earliest_date silently (Scope decision 5).
    const requestedStart = toDateOnly(params.start_time);
    const clampedStart =
      requestedStart < DATASET_EARLIEST_DATE ? DATASET_EARLIEST_DATE : requestedStart;
    if (clampedStart !== requestedStart) {
      appLog.info(
        `[CftcCotProvider] start_time '${requestedStart}' clamped to dataset earliest '${DATASET_EARLIEST_DATE}' for ${parsed.family}`,
      );
    }
    const endDate = toDateOnly(params.end_time);

    const appToken = await this.appTokenResolver();
    const url = buildSocrataUrl({
      datasetId,
      marketName,
      startDate: clampedStart,
      endDate,
    });

    const resp = await this.fetchWithTimeout(url, appToken);
    if (!resp.ok) {
      throw new Error(
        `[CftcCotProvider] Socrata HTTP ${resp.status} for ${parsed.family} ` +
          `'${parsed.marketSlug}' (${marketName}): ${resp.statusText}`,
      );
    }
    const body = (await resp.json()) as unknown;
    if (!Array.isArray(body)) {
      throw new Error(
        `[CftcCotProvider] Socrata returned non-array payload for ${parsed.family} '${parsed.marketSlug}'`,
      );
    }

    const lastModified = resp.headers.get('Last-Modified');
    return this.mapRows(body as SocrataCotRow[], parsed, lastModified);
  }

  /**
   * Start a live polling loop for one (factor_name, optional symbol) pair.
   * CFTC publishes Friday 15:30 ET; outside the Fri 15:00-18:00 ET window
   * the next-poll computation skips ahead instead of busy-looping at the
   * floor. Deduplication keyed on `(dataset_id, report_date)` so hourly
   * polls inside the release window do not double-emit a row.
   */
  startLiveStream(
    params: AlternativeDataRequest,
    onRow: (row: AlternativeFactorRow) => void,
    onError: (err: Error) => void,
    pollIntervalMs: number = MIN_POLL_INTERVAL_MS * 60, // default 60 min
  ): () => void {
    if (pollIntervalMs < MIN_POLL_INTERVAL_MS) {
      throw new Error(
        `[CftcCotProvider] startLiveStream: pollIntervalMs must be >= ${MIN_POLL_INTERVAL_MS} ` +
          `(CFTC publishes weekly; sub-minute polling is wasteful)`,
      );
    }

    const seen = new Set<string>(); // (datasetId, report_date) dedupe
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = (): void => {
      if (cancelled) return;
      const sleepMs = computeNextPollDelay(new Date(), pollIntervalMs);
      timer = setTimeout(() => void tick(), sleepMs);
    };

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const rows = await this.fetchFactorData(params);
        const parsed = parseFactorName(params.factor_name);
        const datasetId = DATASETS[parsed.family];
        for (const row of rows) {
          const key = `${datasetId}|${row.event_time}`;
          if (seen.has(key)) continue;
          seen.add(key);
          onRow(row);
        }
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        scheduleNext();
      }
    };

    // Fire once immediately so the consumer gets a baseline snapshot.
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async fetchWithTimeout(url: string, appToken: string | null): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (appToken) headers['X-App-Token'] = appToken;
    try {
      return await this.fetchFn(url, { signal: controller.signal, headers });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Map Socrata rows to AlternativeFactorRow values for the parsed factor.
   * Emits ONE row per Socrata report_date (one numeric value extracted per
   * row by family/category/field). Sorted ASC by event_time.
   *
   * Audit-only side effect: if `Last-Modified` is more than
   * LAST_MODIFIED_SKEW_WARN_MS off the computed knowledge_time of the most
   * recent row, emit a `warn` line. knowledge_time itself is NOT mutated.
   */
  private mapRows(
    rows: SocrataCotRow[],
    parsed: ParsedFactor,
    lastModified: string | null,
  ): AlternativeFactorRow[] {
    const out: AlternativeFactorRow[] = [];
    for (const row of rows) {
      const reportDate = row.report_date_as_yyyy_mm_dd;
      if (!reportDate) continue;
      const value = extractFieldValue(row, parsed);
      if (value === null || !Number.isFinite(value)) continue;

      const eventTimeIso = composeEventTimeIso(reportDate);
      const knowledgeTimeIso = computeKnowledgeTimeIso(reportDate);

      out.push({
        category: 'fund_flow',
        // factor_name carries the consumer-facing source name (with
        // `alt_fund_flow_` prefix) so downstream isAltDataSignalSource()
        // matches and the persistence-guard refusal message identifies
        // the exact slug the user requested.
        factor_name: buildAltFactorName(parsed),
        symbol: undefined,
        event_time: eventTimeIso,
        knowledge_time: knowledgeTimeIso,
        value,
        // vintage_id intentionally omitted -- vintage_supported = false.
        source_provider: this.id,
      });
    }
    out.sort((a, b) =>
      a.event_time < b.event_time ? -1 : a.event_time > b.event_time ? 1 : 0,
    );

    if (lastModified && out.length > 0) {
      auditLastModifiedSkew(lastModified, out[out.length - 1].knowledge_time);
    }
    return out;
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Compose the consumer-facing factor_name (with `alt_fund_flow_` prefix)
 * from a parsed factor. Matches the `isAltDataSignalSource()` pattern in
 * shared/constants/strategy-types.ts.
 */
function buildAltFactorName(parsed: ParsedFactor): string {
  return `alt_fund_flow_${parsed.family}_${parsed.marketSlug}_${parsed.category.code}_${parsed.field}`;
}

/**
 * Extract the numeric value for a single (category, field) cell from a
 * Socrata row. Returns null for missing / non-numeric cells. Net and
 * pct_of_oi are derived from primitives.
 */
function extractFieldValue(row: SocrataCotRow, parsed: ParsedFactor): number | null {
  const cat = parsed.category;
  switch (parsed.field) {
    case 'long':
      return toNum(row[cat.longCol]);
    case 'short':
      return toNum(row[cat.shortCol]);
    case 'net': {
      const l = toNum(row[cat.longCol]);
      const s = toNum(row[cat.shortCol]);
      return l === null || s === null ? null : l - s;
    }
    case 'net_change': {
      const dl = toNum(row[cat.changeLongCol]);
      const ds = toNum(row[cat.changeShortCol]);
      return dl === null || ds === null ? null : dl - ds;
    }
    case 'pct_of_oi': {
      const pl = toNum(row[cat.pctLongCol]);
      const ps = toNum(row[cat.pctShortCol]);
      return pl === null || ps === null ? null : pl - ps;
    }
  }
}

function toNum(raw: string | undefined): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build the Socrata SoQL query URL. Inclusive on both bounds; sorted ASC
 * by report_date; capped at SOCRATA_PAGE_LIMIT (50k rows is well above
 * any per-market history depth).
 */
export function buildSocrataUrl(args: {
  datasetId: string;
  marketName: string;
  startDate: string;
  endDate: string;
}): string {
  const where =
    `report_date_as_yyyy_mm_dd >= '${args.startDate}' AND ` +
    `report_date_as_yyyy_mm_dd <= '${args.endDate}' AND ` +
    `market_and_exchange_names = '${args.marketName.replace(/'/g, "''")}'`;
  const qs = new URLSearchParams({
    $where: where,
    $order: 'report_date_as_yyyy_mm_dd ASC',
    $limit: String(SOCRATA_PAGE_LIMIT),
  });
  return `${SOCRATA_BASE_URL}/${args.datasetId}.json?${qs.toString()}`;
}

/**
 * event_time = report_tuesday T 16:00 America/New_York.
 *
 * Socrata's `report_date_as_yyyy_mm_dd` IS the report Tuesday (CFTC
 * positions are "as of close of business Tuesday"). We emit it as a UTC
 * ISO string with the wall-clock equivalent of 16:00 ET. America/New_York
 * is UTC-5 (EST) or UTC-4 (EDT); we use a fixed offset of -05:00 for
 * audit clarity. The downstream consumer joins on knowledge_time <=
 * bar_time so the exact tz convention is not load-bearing -- consistency
 * across rows is.
 */
function composeEventTimeIso(reportDateYmd: string): string {
  return `${reportDateYmd}T16:00:00-05:00`;
}

/**
 * knowledge_time = release_friday T 15:30 America/New_York with
 * roll-forward to the next US business day when that Friday is a US
 * federal holiday.
 *
 * Algorithm:
 *   1. report_tuesday + 3 days = report_friday (the SAME-WEEK Friday,
 *      because reports are released the Friday following the Tuesday
 *      as-of date).
 *   2. If that Friday is a US federal holiday, advance to next business
 *      day via nextUsBusinessDay().
 *   3. Stamp 15:30 ET (-05:00 fixed offset; see composeEventTimeIso).
 */
function computeKnowledgeTimeIso(reportDateYmd: string): string {
  // Parse as UTC midnight to avoid host-tz date arithmetic surprises.
  const reportTuesday = new Date(`${reportDateYmd}T00:00:00Z`);
  const releaseFriday = new Date(reportTuesday.getTime());
  releaseFriday.setUTCDate(releaseFriday.getUTCDate() + 3);
  const rolled = nextUsBusinessDay(releaseFriday, { includeStart: true });
  const yyyy = rolled.getUTCFullYear();
  const mm = String(rolled.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(rolled.getUTCDate()).padStart(2, '0');
  const hh = String(RELEASE_HOUR_ET).padStart(2, '0');
  const mi = String(RELEASE_MIN_ET).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:00-05:00`;
}

/**
 * Audit Socrata `Last-Modified` header against the calculated knowledge_time
 * of the most recent emitted row. > 1 h skew -> warn line. Never mutates
 * knowledge_time per Scope decision 4.
 */
function auditLastModifiedSkew(lastModifiedHeader: string, knowledgeTimeIso: string): void {
  const headerMs = Date.parse(lastModifiedHeader);
  const ktMs = Date.parse(knowledgeTimeIso);
  if (!Number.isFinite(headerMs) || !Number.isFinite(ktMs)) return;
  const skewMs = Math.abs(headerMs - ktMs);
  appLog.debug(
    `[CftcCotProvider] Last-Modified='${lastModifiedHeader}' vs knowledge_time='${knowledgeTimeIso}' ` +
      `(skew=${Math.round(skewMs / 1000)}s)`,
  );
  if (skewMs > LAST_MODIFIED_SKEW_WARN_MS) {
    appLog.warn(
      `[CftcCotProvider] Last-Modified header (${lastModifiedHeader}) deviates from ` +
        `calculated knowledge_time (${knowledgeTimeIso}) by ${Math.round(skewMs / 60_000)} min; ` +
        `knowledge_time NOT mutated (PIT contract is calendar-based, not header-based)`,
    );
  }
}

/**
 * Compute next poll delay given the current time and the configured floor.
 * Inside Fri 15:00-18:00 ET (release window) -> floor cadence. Outside the
 * window -> sleep until the next window start.
 *
 * Note: we compute Friday-of-week using UTC day-of-week + a -5 h offset
 * approximation. The exact tz arithmetic is not load-bearing because the
 * window is 3 h wide and the floor is configurable; precision better than
 * an hour is wasted on a weekly-cadence feed.
 */
export function computeNextPollDelay(now: Date, floorMs: number): number {
  const nyOffsetHours = 5; // approx EST; DST shift not material at hour grain
  const nyNow = new Date(now.getTime() - nyOffsetHours * 60 * 60 * 1000);
  const dow = nyNow.getUTCDay(); // 0=Sun ... 5=Fri 6=Sat
  const hour = nyNow.getUTCHours();
  const inWindow = dow === 5 && hour >= 15 && hour < 18;
  if (inWindow) return floorMs;

  // Compute next Friday 15:00 ET.
  const target = new Date(nyNow.getTime());
  target.setUTCHours(15, 0, 0, 0);
  // Days to Friday from current dow. If today is Fri but past window -> +7.
  let daysAhead: number;
  if (dow < 5) daysAhead = 5 - dow;
  else if (dow === 5) daysAhead = hour < 15 ? 0 : 7;
  else daysAhead = 6; // Sat -> 6 days to next Fri
  target.setUTCDate(target.getUTCDate() + daysAhead);
  const deltaMs = target.getTime() - nyNow.getTime();
  return Math.max(floorMs, deltaMs);
}

function toDateOnly(iso: string): string {
  const idx = iso.indexOf('T');
  return idx === -1 ? iso : iso.slice(0, idx);
}

// =============================================================================
// Default App-Token resolver
// =============================================================================

async function defaultAppTokenResolver(): Promise<string | null> {
  try {
    const credService = getSecureCredentialService();
    const result = await credService.getSecret(PLUGIN_ID, APP_TOKEN_SECRET);
    return result.success && result.value ? result.value : null;
  } catch (err) {
    appLog.error('[CftcCotProvider] App-Token credential read failed:', err);
    return null;
  }
}
