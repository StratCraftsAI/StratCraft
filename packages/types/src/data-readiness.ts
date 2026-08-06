/**
 * TICKET_927_2_1 -- Data readiness tier-0 types.
 *
 * Pure type declarations (+ one closed enum) for the data readiness
 * axis of the cross-market trading layer (TICKET_927_2). Every
 * downstream gate component (927_2_2 / 927_2_3 / 927_2_4 / 927_2_5 /
 * 927_2_6) imports the names declared here; no consumer redeclares
 * any of them (TICKET_854 / TICKET_860).
 *
 * No runtime code, no I/O, no service module. The single `enum
 * ReadinessStatus` is the only non-pure-type construct -- justified
 * by parent TICKET_927_2 section 3 RC#1's closed status set.
 *
 * See docs/design/TICKET_927_2_1_DATA_READINESS_TYPES.md.
 */

import type { AnyMarketId } from './market-id'; // TICKET_927_1_1
import type { BarInterval } from './index';
import type { Currency } from './currency'; // TICKET_927_1_4_F
// DataProviderId is tier-0 once TICKET_927_2_2 promotes the union
// from the plugin layer (see TICKET_802). Imported by name here;
// per TICKET_854 / TICKET_860 the single source of truth is the
// single source of truth -- this file does NOT redefine the union.
// If 927_2_2 lands after this ticket, this import is a forward
// reference 927_2_2 satisfies on its merge (TICKET_927_2_1 spec section 5).
import type { DataProviderId } from './data-provider-id';

// ---------------------------------------------------------------------
// Branded scalars + alias scalars
// ---------------------------------------------------------------------

/**
 * TICKET_927_2_1: a symbol string in the canonical form the
 * resolving provider hands out (e.g. 'AAPL', 'EURUSD=X',
 * 'BTC/USDT:USDT'). Alias only -- no branding yet; that lands
 * when TICKET_927_1_1's InstrumentRegistry gains a SymbolId
 * branded form.
 */
export type SymbolId = string;

/**
 * TICKET_927_2_1: ISO 8601 timestamp in UTC. Alias only; runtime
 * validation belongs to whatever boundary parses it (handler /
 * IPC). See parent TICKET_927_2 section 3 RC#1.
 */
export type IsoTimestamp = string;

/**
 * TICKET_927_2_1: opaque per-run identity (string-branded). The
 * gate in 927_2_4 mints this from the handler request id. Parent
 * TICKET_927_2 section 5 Q4.
 */
export type RunId = string & { readonly __brand: 'RunId' };

/**
 * TICKET_927_2_1: TICKET_842 `data_snapshot_id`, branded.
 *
 * Computed by the gate (927_2_4) as the hash of (manifest
 * entries + per-parquet-file fingerprints + per-provider ingest
 * log ids) per TICKET_842 lines 57-91 and parent TICKET_927_2
 * section 5 Q5. THIS ticket only DECLARES the type; THIS ticket
 * does NOT compute it.
 */
export type SnapshotId = string & { readonly __brand: 'SnapshotId' };

/**
 * TICKET_927_2_1: half-open window `[startUtc, endUtc)`. Closed
 * convention is forbidden because the calendar-ratio-aware pull
 * windows from TICKET_919 / TICKET_919_2 / CLAUDE.md
 * "NO FULL-HISTORY READ" rule assume half-open. Parent
 * TICKET_927_2 section 3 RC#1.
 */
export interface TimeWindow {
  /** Inclusive lower bound (UTC). */
  readonly startUtc: IsoTimestamp;
  /** Exclusive upper bound (UTC). */
  readonly endUtc: IsoTimestamp;
}

// ---------------------------------------------------------------------
// DataManifest -- the run's per-market data needs, normalised.
// Pure data; no I/O; constructed by the handler (927_2_5).
// ---------------------------------------------------------------------

/**
 * TICKET_927_1_4_F: discriminator for manifest entries. OHLCV is the
 * per-symbol tradable bar data; fx_rate is a cross-rate series used by
 * the heterogeneous-currency aggregator.
 */
export type DataManifestEntryKind = 'ohlcv' | 'fx_rate';

/**
 * TICKET_927_2_1: a single cell of the request -- one (market,
 * symbol, interval, window) tuple. Per parent TICKET_927_2
 * section 3 RC#1 the manifest entry is the typed precondition
 * the gate evaluates against the parquet cache.
 */
export interface ManifestEntry {
  /** TICKET_927_1_4_F: entry kind. Defaults to 'ohlcv' for
   *  backward-compat with existing manifest builders. */
  readonly kind: DataManifestEntryKind;
  /** Which market this cell belongs to (TICKET_927_1_1). */
  readonly market: AnyMarketId;
  /**
   * The provider-qualified symbol (caller resolved via the
   * InstrumentRegistry from 927_1_1).
   */
  readonly symbol: SymbolId;
  /**
   * The bar interval (TICKET_292; reuses the union exported
   * from `packages/types/src/index.ts`).
   */
  readonly interval: BarInterval;
  /**
   * Half-open window pinned by the run. Per CLAUDE.md
   * "NO FULL-HISTORY READ" / TICKET_919_2: the manifest IS the
   * window; the gate dispatches with this window pushed down,
   * never full-file then slice.
   */
  readonly window: TimeWindow;
}

/**
 * TICKET_927_2_1: parent TICKET_927_2 section 3 RC#1. The full
 * per-run set of `ManifestEntry`, sorted + deduplicated at
 * construction. The gate evaluates this against the parquet
 * cache; the same manifest re-evaluated after ingest must
 * produce a green report or the run fails (TICKET_858).
 */
export interface DataManifest {
  /** Per-run identity; minted by the gate from the handler request id. */
  readonly runId: RunId;
  /**
   * Sorted by (market, symbol, interval, startUtc) ascending;
   * no duplicates. The constructor / builder in 927_2_4
   * enforces.
   */
  readonly entries: ReadonlyArray<ManifestEntry>;
}

// ---------------------------------------------------------------------
// DataReadinessReport -- the gate's classification of a manifest.
// ---------------------------------------------------------------------

/**
 * TICKET_927_2_1: closed enum for entry classification. Closed
 * because parent TICKET_927_2 section 3 RC#1 / TICKET_858
 * forbid "best-effort" partial reads -- there are exactly three
 * terminal states. No 'pending' value: pending is the absence
 * of a report, not a status.
 */
export enum ReadinessStatus {
  /**
   * Parquet cache covers the window for this (market, symbol,
   * interval) at full bar count. Trunk / replay may read
   * directly.
   */
  READY = 'ready',
  /**
   * A provider claims this market AND interval AND symbol AND
   * can fetch the missing window. The gate will dispatch
   * ingest.
   */
  NEEDS_INGEST = 'needs_ingest',
  /**
   * No registered `IDataProvider` covers (market, symbol,
   * interval). Run fails fast (TICKET_857); `reason` is
   * REQUIRED. Per TICKET_858 the reason must reach the UI
   * verbatim.
   */
  UNSUPPORTED = 'unsupported',
}

/**
 * TICKET_927_2_1: one classified manifest entry. Extends
 * `ManifestEntry` with the gate's verdict + the provider it
 * bound to (or would bind to). Parent TICKET_927_2 section 3
 * RC#1.
 */
export interface ReadinessEntry extends ManifestEntry {
  /** The gate's verdict for this cell. */
  readonly status: ReadinessStatus;
  /**
   * The provider that already serves this entry
   * (`status=READY`) or that the gate will dispatch to
   * (`status=NEEDS_INGEST`). Absent when
   * `status=UNSUPPORTED`.
   */
  readonly providerId?: DataProviderId;
  /**
   * Required IFF `status=UNSUPPORTED`. Human-readable, surfaced
   * verbatim by the readiness panel (927_2_6) per TICKET_858.
   * Empty string is forbidden -- if you have no reason, you
   * have no UNSUPPORTED classification.
   */
  readonly reason?: string;
}

/**
 * TICKET_927_2_1: parent TICKET_927_2 section 3 RC#1 / RC#5.
 * The gate's verdict on a manifest at a point in time. The same
 * manifest can produce a needs-ingest report, then (after
 * ingest) a fully-ready report; `snapshotId` is set only on the
 * LATTER.
 */
export interface DataReadinessReport {
  /** Per-run identity; mirrors the source `DataManifest.runId`. */
  readonly runId: RunId;
  /**
   * Present once every entry is `READY` and the gate has
   * computed the snapshot hash per TICKET_842. Absent on
   * intermediate reports (needs-ingest dispatches are still
   * pending). Parent TICKET_927_2 section 5 Q5.
   */
  readonly snapshotId?: SnapshotId;
  /** Sorted identically to the source manifest; same length. */
  readonly entries: ReadonlyArray<ReadinessEntry>;
  /**
   * Summary counts -- redundant with `entries` but consumed by
   * the UI panel (927_2_6) without iterating. Parent
   * TICKET_927_2 section 3 RC#1.
   */
  readonly summary: {
    /** Count of entries with `status=READY`. */
    readonly ready: number;
    /** Count of entries with `status=NEEDS_INGEST`. */
    readonly needsIngest: number;
    /** Count of entries with `status=UNSUPPORTED`. */
    readonly unsupported: number;
  };
}

// ---------------------------------------------------------------------
// ReadyDataset -- the frozen, snapshot-pinned substrate view the
// trunk / replay reads through. Parent TICKET_927_2 section 3 RC#3
// (Zipline BundleData pattern).
// ---------------------------------------------------------------------

/**
 * TICKET_927_2_1: per-market slice of the ready substrate. The
 * trunk for bucket M reads ONLY through
 * `readyDataset.perMarket.get(M)`; it cannot reach a provider,
 * cannot call `ensureData`, cannot read a parquet outside the
 * listed coverage windows. Parent TICKET_927_2 section 3 RC#3.
 */
export interface MarketReadyView {
  /** Which market this slice represents (TICKET_927_1_1). */
  readonly market: AnyMarketId;
  /** The bar interval for every symbol listed in `coverage`. */
  readonly interval: BarInterval;
  /**
   * Per-symbol coverage. `rowCount` lets the trunk
   * sanity-check the window-pushdown read it just did
   * (TICKET_919_2 audit trail).
   */
  readonly coverage: ReadonlyArray<{
    /** The provider-qualified symbol. */
    readonly symbol: SymbolId;
    /** Half-open window the parquet covers for this symbol. */
    readonly window: TimeWindow;
    /** Bar count under `window`; trunk-side sanity-check input. */
    readonly rowCount: number;
  }>;
}

/**
 * TICKET_927_2_1: parent TICKET_927_2 section 3 RC#3 + RC#5.
 * The single token the gate hands to fusion / replay. Carries
 * the snapshot id so the run result can record byte-for-byte
 * provenance per TICKET_842.
 */
/**
 * TICKET_927_1_4_F: key for the FX rate map in ReadyDataset. Canonical
 * direction: `from` < `to` lexicographically (e.g. 'CNY' -> 'USD', never
 * 'USD' -> 'CNY'). The provider reads the inverse when needed.
 */
export interface FxPairKey {
  readonly from: Currency;
  readonly to: Currency;
}

/**
 * TICKET_927_1_4_F: per-FX-pair ready view. Analogous to MarketReadyView
 * but for FX rate series.
 */
export interface FxRateReadyView {
  readonly pair: FxPairKey;
  readonly interval: BarInterval;
  readonly window: TimeWindow;
  readonly rowCount: number;
}

export interface ReadyDataset {
  /**
   * TICKET_842 `data_snapshot_id` for the underlying substrate.
   * Always set (a `ReadyDataset` only exists once the report is
   * fully green; parent TICKET_927_2 section 5 Q5).
   */
  readonly snapshotId: SnapshotId;
  /**
   * Per-market slices. Trunks consume by `MarketId`; absence of
   * a key for a market the run requested is an invariant
   * violation the gate must catch (TICKET_857).
   */
  readonly perMarket: ReadonlyMap<AnyMarketId, MarketReadyView>;
  /**
   * TICKET_927_1_4_F: FX rate series ready views. Keyed by
   * `"FROM/TO"` canonical string (from < to lexicographically).
   * Empty for homogeneous-currency runs.
   */
  readonly fxRates: ReadonlyMap<string, FxRateReadyView>;
}

// ---------------------------------------------------------------------
// StagingProgressMsg -- discriminated union streamed from the gate
// (927_2_4) to the renderer (927_2_6) via the event-subscription
// IPC channel `data-readiness:progress`. Per TICKET_206 the handler
// emits these and the renderer subscribes via `onProgress(runId, cb)`.
// Parent TICKET_927_2 section 4; consumer TICKET_927_2_6 section 4.
// ---------------------------------------------------------------------

export type StagingProgressMsg =
  | { readonly kind: 'entry_started';   readonly runId: RunId; readonly entry: ReadinessEntry }
  | { readonly kind: 'entry_completed'; readonly runId: RunId; readonly entry: ReadinessEntry }
  | { readonly kind: 'entry_failed';    readonly runId: RunId; readonly entry: ReadinessEntry; readonly providerId?: DataProviderId; readonly reason: string }
  | { readonly kind: 'terminal';        readonly runId: RunId; readonly report: DataReadinessReport };

// ---------------------------------------------------------------------
// DataReadinessError -- structured error the gate throws when the
// manifest cannot be fully satisfied. The handler MUST NOT flatten
// this to a string; the IPC boundary preserves the report so the
// renderer can display the per-market breakdown (927_2_6).
// Parent TICKET_927_2 section 5; consumer TICKET_927_2_5 section 5.
// ---------------------------------------------------------------------

export class DataReadinessError extends Error {
  readonly kind: 'DATA_NOT_READY' | 'INGEST_FAILED';
  readonly report: DataReadinessReport;

  constructor(
    kind: 'DATA_NOT_READY' | 'INGEST_FAILED',
    report: DataReadinessReport,
    message?: string,
  ) {
    super(
      message ??
        `DataReadinessError(${kind}): ${report.summary.unsupported} unsupported, ` +
        `${report.summary.needsIngest} needs_ingest out of ${report.entries.length} entries`,
    );
    this.name = 'DataReadinessError';
    this.kind = kind;
    this.report = report;
  }
}
