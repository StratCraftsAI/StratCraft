/**
 * TICKET_1364 D1/D2: shared HistData forex acquisition contract.
 *
 * Every surface (Electron IPC, Service API, MCP) serializes the same
 * request, plan, progress, and result shapes defined here. No surface
 * may construct download commands, normalize timestamps, infer package
 * identity, or register files -- those decisions belong to the shared
 * acquisition operation that consumes these types.
 */

import type {
  ConfirmedWorkloadPlan,
  WorkloadPrelaunchReview,
} from './workload-prelaunch';
import { WORKLOAD_PRELAUNCH_ERROR_CODES } from './workload-prelaunch';

// ---------------------------------------------------------------------------
// Specification identity
// ---------------------------------------------------------------------------

export const HISTDATA_ACQUISITION_SPECIFICATION_ID =
  'quantnexus.histdata-forex-acquisition' as const;
export const HISTDATA_ACQUISITION_SPECIFICATION_VERSION = '1.0.0' as const;

// ---------------------------------------------------------------------------
// Source timeframe ↔ canonical interval mapping (D4)
// ---------------------------------------------------------------------------

export const HISTDATA_SOURCE_TIMEFRAMES = ['M1', 'tick'] as const;
export type HistDataSourceTimeframe = (typeof HISTDATA_SOURCE_TIMEFRAMES)[number];

export const HISTDATA_CANONICAL_INTERVAL_MAP: Readonly<
  Record<HistDataSourceTimeframe, string>
> = {
  M1: '1m',
  tick: 'tick',
};

// ---------------------------------------------------------------------------
// Supported pairs -- 60 active, 6 discontinued excluded (TICKET_901)
// ---------------------------------------------------------------------------

export const HISTDATA_DISCONTINUED_PAIRS = [
  'AUXAUD', 'ETXEUR', 'FRXEUR', 'GRXEUR', 'BCOUSD', 'WTIUSD',
] as const;

export const HISTDATA_ACTIVE_PAIRS = [
  // G10 Crosses (28)
  'EURUSD', 'USDJPY', 'GBPUSD', 'USDCHF', 'USDCAD',
  'AUDUSD', 'NZDUSD',
  'EURJPY', 'EURGBP', 'EURCHF', 'EURAUD', 'EURNZD', 'EURCAD',
  'GBPJPY', 'GBPCHF', 'GBPAUD', 'GBPNZD', 'GBPCAD',
  'AUDJPY', 'AUDNZD', 'AUDCAD', 'AUDCHF',
  'NZDJPY', 'NZDCAD', 'NZDCHF',
  'CADJPY', 'CADCHF', 'CHFJPY',
  // Scandinavian/Exotic (14)
  'USDSEK', 'USDNOK', 'EURSEK', 'EURNOK',
  'USDMXN', 'USDTRY', 'USDZAR',
  'EURDKK', 'USDDKK', 'EURCZK', 'USDCZK',
  'EURHUF', 'EURPLN', 'EURTRY',
  // Asian/Other (6)
  'SGDJPY', 'USDHKD', 'USDSGD', 'ZARJPY', 'USDPLN', 'GBPNOK',
  // Precious Metals (6)
  'XAUUSD', 'XAGUSD', 'XAUAUD', 'XAUCHF', 'XAUEUR', 'XAUGBP',
  // Index CFDs (6) -- active data, including UDXUSD which has DJIA
  // foreign-instrument block cleaned by TICKET_1126_1 cleaner.py
  'SPXUSD', 'NSXUSD', 'JPXJPY', 'UKXGBP', 'HKXHKD', 'UDXUSD',
] as const;

export type HistDataActivePair = (typeof HISTDATA_ACTIVE_PAIRS)[number];

export function isHistDataActivePair(value: unknown): value is HistDataActivePair {
  return typeof value === 'string'
    && (HISTDATA_ACTIVE_PAIRS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Existing-data policy
// ---------------------------------------------------------------------------

export const HISTDATA_EXISTING_DATA_POLICIES = ['resume', 'replace'] as const;
export type HistDataExistingDataPolicy =
  (typeof HISTDATA_EXISTING_DATA_POLICIES)[number];

// ---------------------------------------------------------------------------
// Provenance (D3)
// ---------------------------------------------------------------------------

export interface HistDataProvenance {
  readonly sourceName: 'histdata.com';
  readonly sourceUrl: string;
  readonly distributionName: 'histdata-supplementary';
  readonly sourceRevision: string;
  readonly acquisitionTimestampUtc: string;
  readonly pairs: readonly string[];
  readonly yearStart: number;
  readonly yearEnd: number;
  readonly sourceTimeframe: HistDataSourceTimeframe;
  readonly sourceTimezoneConvention: 'EST-no-DST';
  readonly cleanerVersion: string;
  readonly planFingerprint: string;
  readonly sourceTermsIdentity: string;
  readonly sourceTermsAcknowledged: boolean;
}

// ---------------------------------------------------------------------------
// Acquisition request (user-facing draft before plan review)
// ---------------------------------------------------------------------------

export interface HistDataAcquisitionDraft {
  readonly pairs?: readonly string[];
  readonly yearStart?: number;
  readonly yearEnd?: number;
  readonly sourceTimeframe?: HistDataSourceTimeframe;
  readonly existingDataPolicy?: HistDataExistingDataPolicy;
  readonly packageName?: string;
}

// ---------------------------------------------------------------------------
// Progress (D8)
// ---------------------------------------------------------------------------

export const HISTDATA_ACQUISITION_PHASES = [
  'planning',
  'awaiting-review',
  'awaiting-terms-acknowledgement',
  'downloading',
  'parsing',
  'normalizing',
  'validating',
  'staging',
  'publishing',
  'completed',
  'failed',
] as const;
export type HistDataAcquisitionPhase =
  (typeof HISTDATA_ACQUISITION_PHASES)[number];

export interface HistDataAcquisitionProgress {
  readonly phase: HistDataAcquisitionPhase;
  readonly pairIndex?: number;
  readonly pairTotal?: number;
  readonly currentPair?: string;
  readonly yearIndex?: number;
  readonly yearTotal?: number;
  readonly currentYear?: number;
  readonly bytesDownloaded?: number;
  readonly message?: string;
}

export type HistDataAcquisitionProgressCallback =
  (progress: HistDataAcquisitionProgress) => void;

// ---------------------------------------------------------------------------
// Failure (D8)
// ---------------------------------------------------------------------------

export const HISTDATA_ACQUISITION_ERROR_CODES = [
  ...WORKLOAD_PRELAUNCH_ERROR_CODES,
  'RESEARCH_ENVIRONMENT_NOT_READY',
  'HISTDATA_CAPABILITY_NOT_READY',
  'SOURCE_TERMS_NOT_ACKNOWLEDGED',
  'INVALID_PAIR',
  'INVALID_TIMEFRAME',
  'INVALID_YEAR_RANGE',
  'INSUFFICIENT_DISK_CAPACITY',
  'SOURCE_NETWORK_FAILURE',
  'SOURCE_CONTRACT_CHANGE',
  'ARCHIVE_CORRUPTION',
  'PARSE_FAILURE',
  'TIMESTAMP_NORMALIZATION_FAILURE',
  'DATA_QUALITY_REJECTION',
  'STAGING_FAILURE',
  'CATALOG_TRANSACTION_FAILURE',
  'PLAN_FINGERPRINT_MISMATCH',
  'ACTIVE_CONFLICTING_WORKLOAD',
] as const;
export type HistDataAcquisitionErrorCode =
  (typeof HISTDATA_ACQUISITION_ERROR_CODES)[number];

export interface HistDataAcquisitionError {
  readonly code: HistDataAcquisitionErrorCode;
  readonly message: string;
  readonly remediation: string;
  readonly pair?: string;
  readonly year?: number;
}

// ---------------------------------------------------------------------------
// Result (D1 + D6)
// ---------------------------------------------------------------------------

export interface HistDataAcquisitionPerPairResult {
  readonly pair: string;
  readonly canonicalInterval: string;
  readonly rowCount: number;
  readonly rejectedBarCount: number;
  readonly suspectBarCount: number;
  readonly firstTimestampUtc: number;
  readonly lastTimestampUtc: number;
  readonly parquetDigest: string;
  readonly filePath: string;
}

export interface HistDataAcquisitionResult {
  readonly ok: true;
  readonly packageName: string;
  readonly assetClass: 'forex';
  readonly dynamicMarketId: `byod_${string}`;
  readonly pairs: readonly HistDataAcquisitionPerPairResult[];
  readonly totalRows: number;
  readonly totalRejectedBars: number;
  readonly totalSuspectBars: number;
  readonly provenance: HistDataProvenance;
  readonly planFingerprint: string;
  readonly normalizedPlan: ConfirmedWorkloadPlan;
  readonly wallTimeMs: number;
}

export interface HistDataAcquisitionFailureResult {
  readonly ok: false;
  readonly error: HistDataAcquisitionError;
  readonly partialPairs?: readonly HistDataAcquisitionPerPairResult[];
}

export type HistDataAcquisitionOutcome =
  | HistDataAcquisitionResult
  | HistDataAcquisitionFailureResult;

// ---------------------------------------------------------------------------
// Control (cooperative cancellation)
// ---------------------------------------------------------------------------

export interface HistDataAcquisitionControl {
  readonly signal?: AbortSignal;
  readonly onProgress?: HistDataAcquisitionProgressCallback;
}
