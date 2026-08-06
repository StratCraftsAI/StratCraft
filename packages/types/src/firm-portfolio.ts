/**
 * TICKET_927_4_1 -- Firm portfolio aggregator contract.
 *
 * Three tier-0 types make "firm view of N per-market books" a first-class
 * object instead of an implied `Map<MarketId, X>` re-declared at every
 * consumer (handler response shape, persistence layer, risk overlay, order
 * generator). Field drift between those layers becomes structurally
 * impossible once they all consume the same typed object.
 *
 *   PortfolioBookSet         -- the full collection of per-market books from
 *                               one multi-market backtest run.
 *   FirmPortfolio            -- the firm-level view: book set + firm equity
 *                               curve + firm metrics + covered instruments.
 *   FirmPortfolioAggregator  -- the ONLY producer of those two, called once
 *                               by the universe handler after the per-bucket
 *                               replay loop completes.
 *
 * TICKET_927 section 0.1 invariant ENFORCED here: `FirmPortfolio` exposes
 * `coveredInstruments()` (the UNION of per-book covered instruments) and
 * deliberately has NO `tradableUniverse` field. Re-introducing a global
 * tradable-universe gate at any downstream layer is therefore a structural
 * type error, not a silent drift.
 *
 * Identity-FX v1: all books must share `baseCcy`; the aggregator refuses
 * heterogeneous-currency runs (TICKET_857 fail-fast) until TICKET_927_1_4_F
 * registers the heterogeneous-FX implementation against the same interface.
 */

import type { MarketId } from './market-id';
import type { PortfolioBookResult } from './portfolio-book';
import type { Currency } from './currency';

/**
 * TICKET_927_4_1: the full collection of per-market books from one
 * multi-market backtest run. The output of `replayPortfolio` per bucket
 * x N buckets, NOT the firm-level view.
 *
 * Invariants:
 *  - Keys are exactly the MarketIds the run was requested with. A bucket
 *    whose ingest failed -> the WHOLE run fails per TICKET_927_2 RC#4;
 *    a partial BookSet is never observable.
 *  - `books` is never empty; the aggregator refuses a zero-bucket input
 *    (TICKET_857).
 *  - Each entry's `book.perSymbolContribution[]` only references
 *    instruments whose MarketId equals the map key (per-bucket invariant
 *    from TICKET_927_1 RC#3).
 */
export interface PortfolioBookSet {
  readonly books: ReadonlyMap<MarketId, PortfolioBookResult>;

  /** Convenience: the set of MarketIds covered. Equal to
   *  `new Set(books.keys())` -- exposed as a method so consumers do not
   *  re-derive. */
  marketIds(): ReadonlySet<MarketId>;
}

/**
 * TICKET_927_4_1: the firm-level view of the run.
 *
 * section 0.1 invariant enforced HERE: `coveredInstruments()` is the UNION
 * of per-book covered instrument sets. There is NO firm-level
 * `tradableUniverse` field. Any consumer that wants "which instruments did
 * the firm touch" reads `coveredInstruments()`.
 */
export interface FirmPortfolio {
  readonly bookSet: PortfolioBookSet;

  /** Firm-level equity curve, in `baseCcy`, produced by the FX-converted
   *  sum of per-book curves on the timestamp-unioned grid. Identity-FX v1
   *  requires all books' base currency to equal `baseCcy` (refuse otherwise
   *  per TICKET_927_1 section 5 Q5). Heterogeneous v2 lands with
   *  TICKET_927_1_4_F. */
  readonly equityCurve: ReadonlyArray<{ ts: number; equity: number }>;
  /** ISO 4217. Identity-FX v1: all books are in this currency. */
  readonly baseCcy: Currency;

  /** Firm-level metrics. Sourced from `equityCurve`, NOT re-derived from any
   *  per-book metric (a per-book metric is a per-book observation; the firm
   *  metric is computed once on the firm curve). */
  readonly sharpe: number;
  readonly maxDrawdown: number;
  readonly finalEquity: number;

  /** Union of per-book covered instruments. TICKET_927 section 0.1 invariant
   *  -- never a global universe field. */
  coveredInstruments(): ReadonlySet<string>;

  /** Per-book lookup. Reads through to `bookSet.books.get(m)`. */
  bookForMarket(market: MarketId): PortfolioBookResult | undefined;
}

/**
 * TICKET_927_4_1: pluggable FX provider. v1 = identity provider (refuses
 * any rate request that is not a same-currency identity). v2 = real
 * heterogeneous-currency conversion, registered by TICKET_927_1_4_F.
 *
 * Lives on this interface (and not `PortfolioBookResult`) because FX
 * conversion is a firm-level concern: each per-market book is computed in
 * its own quote currency; the firm view is the only layer that knows what
 * the firm-level base currency is.
 */
export interface FxRateProvider {
  /** Spot rate `fromCcy -> toCcy` at `ts` (nanoseconds since epoch). Returns
   *  1 when `fromCcy === toCcy`. Implementations MUST throw on an
   *  unsupported currency pair; the identity provider throws on any
   *  non-identity request. */
  rate(fromCcy: Currency, toCcy: Currency, ts: number): number;
}

/**
 * TICKET_927_4_1: the aggregator function. The ONLY producer of
 * `FirmPortfolio` + `PortfolioBookSet`. Called once by the universe handler
 * after the per-bucket replay loop completes.
 *
 * Implementations live in
 * `apps/desktop/src/main/services/signal-discovery/firm-portfolio-aggregator.ts`.
 * v1 = identity-FX (refuses heterogeneous currency); v2 = heterogeneous-FX
 * via TICKET_927_1_4_F, plugged in against this same interface so no call
 * site changes.
 */
export interface FirmPortfolioAggregator {
  aggregate(
    perBucket: ReadonlyMap<MarketId, PortfolioBookResult>,
    baseCcy: Currency,
    fx: FxRateProvider,
    /** Per-bucket quote currency (ISO 4217). Identity-FX v1 requires every
     *  entry to equal `baseCcy`; non-matching entries cause a fail-fast
     *  refusal via `fx.rate(bookCcy, baseCcy, ts)` (the identity provider
     *  throws for any non-identity request). Defaults to `baseCcy` for every
     *  market the caller does not enumerate (the common single-market and
     *  homogeneous multi-market case). */
    bookCcys?: ReadonlyMap<MarketId, Currency>,
    /** TICKET_1142: frequency-aware Sharpe annualisation factor for the firm
     *  curve. Defaults to sqrt(252) when omitted (daily equity). */
    sharpeAnnFactor?: number,
  ): FirmPortfolio;
}

/**
 * TICKET_927_4_1: the identity-FX provider used by v1. Returns 1 only for
 * `fromCcy === toCcy`; throws explicitly otherwise so a heterogeneous-ccy
 * run loud-fails at the FX boundary (TICKET_857, TICKET_858) instead of
 * silently summing currencies. Re-exported through `index.ts` so callers
 * (the universe handler, tests) wire a single canonical instance rather
 * than each declaring their own.
 */
export const identityFxRateProvider: FxRateProvider = {
  rate(fromCcy: Currency, toCcy: Currency, _ts: number): number {
    if (fromCcy === toCcy) return 1;
    throw new Error(
      `TICKET_927_4_1: identity FX provider refuses non-identity rate ` +
      `${fromCcy} -> ${toCcy}. Use the historical FX provider ` +
      `(TICKET_927_1_4_F) for heterogeneous-currency aggregation.`,
    );
  },
};

// ============================================================================
// TICKET_951 -- IPC wire DTOs.
//
// `FirmPortfolio` and `PortfolioBookSet` deliberately expose METHODS
// (`marketIds()`, `coveredInstruments()`, `bookForMarket()`) so in-process
// consumers do not re-derive set/map views. Methods are perfectly fine for
// callers that stay in the main process (persistence, risk overlay, order
// generator).
//
// The Alpha Factory `alpha-factory:run-universe` IPC handler, however, ships
// the firm view back to the renderer. Electron IPC uses the HTML Structured
// Clone algorithm, which CANNOT clone function values -- any function in the
// object graph fails the whole transfer with `Error: An object could not be
// cloned`. The producer types (above) are therefore not directly transferable.
//
// The DTOs below are the canonical wire shape for that boundary: pure data,
// methods pre-evaluated, `Map` flattened to a record, `Set` flattened to an
// array. `toFirmPortfolioDTO` is the ONLY conversion (TICKET_854 DRY) -- new
// fields land here so the wire shape and the producer shape evolve together.
//
// Renderer code consumes `FirmPortfolioDTO`, not `FirmPortfolio`.
// ============================================================================

/** TICKET_951: wire shape of `PortfolioBookSet`. Methods pre-evaluated,
 *  `ReadonlyMap` flattened to a `Record<MarketId, PortfolioBookResult>` so the
 *  whole graph is structured-clone safe. */
export interface PortfolioBookSetDTO {
  readonly books: Readonly<Record<MarketId, PortfolioBookResult>>;
  readonly marketIds: ReadonlyArray<MarketId>;
}

/** TICKET_951: wire shape of `FirmPortfolio`. Pure data; safe to ship through
 *  Electron IPC `ipcRenderer.invoke`. */
export interface FirmPortfolioDTO {
  readonly bookSet: PortfolioBookSetDTO;
  readonly equityCurve: ReadonlyArray<{ ts: number; equity: number }>;
  readonly baseCcy: Currency;
  readonly sharpe: number;
  readonly maxDrawdown: number;
  readonly finalEquity: number;
  /** Pre-evaluated union of per-book covered instruments. Mirrors
   *  `FirmPortfolio.coveredInstruments()` at call time. */
  readonly coveredInstruments: ReadonlyArray<string>;
}

/** TICKET_951: convert an in-process `FirmPortfolio` to its wire DTO. The
 *  single conversion point -- any new field on `FirmPortfolio` MUST be
 *  propagated here (and to `FirmPortfolioDTO`) in the same change set,
 *  otherwise the renderer silently loses it.
 *
 *  `Map` -> record via `Object.fromEntries`. `Set` -> array via spread.
 *  Methods are invoked once and their results materialised. Nothing in the
 *  returned object holds a function reference -- verified at runtime by the
 *  `structuredClone(toFirmPortfolioDTO(...))` regression test in
 *  `firm-portfolio-aggregator.test.ts`. */
export function toFirmPortfolioDTO(firm: FirmPortfolio): FirmPortfolioDTO {
  return {
    bookSet: {
      books: Object.fromEntries(firm.bookSet.books) as
        Record<MarketId, PortfolioBookResult>,
      marketIds: [...firm.bookSet.marketIds()],
    },
    equityCurve: firm.equityCurve,
    baseCcy: firm.baseCcy,
    sharpe: firm.sharpe,
    maxDrawdown: firm.maxDrawdown,
    finalEquity: firm.finalEquity,
    coveredInstruments: [...firm.coveredInstruments()],
  };
}
