/**
 * TICKET_968 Layer 0 -- canonical registry for cross-timeframe alignment
 * forward-fill skip reasons.
 *
 * Single source of truth shared by:
 *   - C++ producer (plugins/quant-lab-nexus/src/alignment_skip_reasons.hpp
 *     mirrors only the stable string IDs; description / cause / remediation
 *     live ONLY here so there is no human-copy drift across language
 *     boundaries).
 *   - TS reader (apps/desktop/src/main/ipc/v3-handlers.ts).
 *   - TS classifier (apps/desktop/src/main/ipc/empty-fusion-classifier.ts).
 *   - UI panel (plugins/quant-lab-nexus/ui/.../ResultSection.tsx).
 *
 * Convention modelled on TICKET_822 (canonical signal output schema),
 * TICKET_849 (cv-sizing-contract single source of truth) and
 * TICKET_179 (no magic numbers / unified constants).
 *
 * Stable-ID rule: once a reason is shipped, its `id` (string) and
 * `numericId` (int) MUST NEVER be renamed or renumbered -- they cross the
 * C++<->TS boundary on the wire. Adding new reasons is fine; deleting is
 * a breaking change.
 */

/** Stable string IDs of every alignment forward-fill skip reason. */
export type AlignmentSkipReason =
  | 'bar_before_first_signal'
  | 'close_is_nan'
  | 'close_is_inf'
  | 'close_is_zero'
  | 'next_close_non_finite';

/** Per-reason metadata. */
export interface AlignmentSkipReasonEntry {
  /** Stable string ID -- on the wire C++<->TS. Never rename. */
  readonly id: AlignmentSkipReason;
  /** Stable numeric ID -- never renumber. Reserved for future binary
   *  protocols + dashboards that want to group by integer key. */
  readonly numericId: number;
  /** Short human description, shown in UI matrix header. */
  readonly description: string;
  /** Typical upstream cause -- one sentence, shown in UI tooltip. */
  readonly typicalCause: string;
  /** Remediation hint -- referenced by classifier and UI; authored once
   *  here so the classifier does not embed user-facing copy. */
  readonly remediation: string;
  /** Related ticket(s) -- traceability back to the design history. */
  readonly relatedTickets: readonly string[];
}

/** Canonical registry. Every reason MUST have an entry here. */
export const ALIGNMENT_SKIP_REASONS: Readonly<
  Record<AlignmentSkipReason, AlignmentSkipReasonEntry>
> = {
  bar_before_first_signal: {
    id: 'bar_before_first_signal',
    numericId: 1,
    description: 'Execution bar falls before the first observed signal pair.',
    typicalCause:
      'Signal coverage window and execution-bar coverage window are disjoint '
      + '(e.g. yfinance 60-day intraday clamp + longer signal-coverage manifest).',
    remediation:
      'Switch to a longer-history data provider (e.g. Alpaca for US-equity '
      + 'intraday per TICKET_955), or narrow the backtest window to the '
      + 'overlap of signal and execution-bar coverage. The Layer 5 preflight '
      + 'gate (TICKET_968) catches the disjoint case before alignment runs.',
    relatedTickets: ['TICKET_955', 'TICKET_962', 'TICKET_964'],
  },
  close_is_nan: {
    id: 'close_is_nan',
    numericId: 2,
    description: 'Execution-bar close price is NaN.',
    typicalCause:
      'Provider data gap or upstream parser regression filling NaN into the '
      + 'parquet cache.',
    remediation:
      'Re-run Tool Sweep to refresh the parquet cache for the affected '
      + 'symbol(s). If persistent across providers, file a provider ticket.',
    relatedTickets: ['TICKET_959'],
  },
  close_is_inf: {
    id: 'close_is_inf',
    numericId: 3,
    description: 'Execution-bar close price is +/-Infinity.',
    typicalCause:
      'Provider bug or arithmetic overflow in upstream transform.',
    remediation:
      'Re-run Tool Sweep to refresh the cache. If persistent, file a '
      + 'provider ticket; the affected symbol should be excluded from the '
      + 'universe until fixed.',
    relatedTickets: ['TICKET_959'],
  },
  close_is_zero: {
    id: 'close_is_zero',
    numericId: 4,
    description: 'Execution-bar close price is exactly 0.0.',
    typicalCause:
      'Corporate action, trading halt, or pre/post-market bar lacking '
      + 'real prints.',
    remediation:
      'Exclude the affected symbol(s) for the dropped windows, or narrow '
      + 'the backtest to skip the halt/corporate-action window.',
    relatedTickets: ['TICKET_959'],
  },
  next_close_non_finite: {
    id: 'next_close_non_finite',
    numericId: 5,
    description: 'Next execution-bar close (used to compute r_next) is non-finite.',
    typicalCause:
      'Same upstream causes as close_is_nan / close_is_inf, just landing '
      + 'on the right side of the (current, next) bar pair.',
    remediation:
      'Re-run Tool Sweep to refresh the cache. The bar walk requires a '
      + 'finite next close to compute r_next; without it the pair cannot '
      + 'enter the fused cross-section.',
    relatedTickets: ['TICKET_959'],
  },
} as const;

/** All reason IDs as a frozen array, for iteration. */
export const ALIGNMENT_SKIP_REASON_IDS: ReadonlyArray<AlignmentSkipReason> =
  Object.freeze([
    'bar_before_first_signal',
    'close_is_nan',
    'close_is_inf',
    'close_is_zero',
    'next_close_non_finite',
  ] as const);

/** Runtime type guard. */
export function isAlignmentSkipReason(
  value: unknown,
): value is AlignmentSkipReason {
  return typeof value === 'string'
    && (ALIGNMENT_SKIP_REASON_IDS as readonly string[]).includes(value);
}

/**
 * Per-(symbol, reason) skip-stat entry as it crosses the C++<->TS boundary.
 * Shape MUST match what sigma_plugin.cpp:424-446 emits.
 *
 * v2 (TICKET_968): the field is per-(symbol, reason). The pre-v2 attempt to
 * aggregate per-reason on the C++ side loses locality (Principle 2:
 * coverage matrix, not coverage scalar). C++ already emits per-symbol;
 * TS preserves it verbatim.
 */
export interface AlignmentSkipStat {
  /** Symbol the dropped bars belong to. */
  readonly symbol: string;
  /** Stable reason ID from the registry. */
  readonly reason: AlignmentSkipReason;
  /** Number of bars dropped for this (symbol, reason) combination. */
  readonly count: number;
  /** Unix-seconds timestamp of the first dropped bar in this bucket. */
  readonly firstTs: number;
  /** Unix-seconds timestamp of the last dropped bar in this bucket. */
  readonly lastTs: number;
}

// ============================================================================
// Layer 3 -- dominance threshold and Layer 5 -- preflight overlap constant
// ============================================================================
//
// Both constants live here (not in the classifier or v3-handlers) so the
// "no magic numbers" rule (TICKET_179) is satisfied and the values are
// reviewable in one place. Picked deliberately:
//
//   * DOMINANCE_THRESHOLD = 0.80 -- a single reason responsible for >=80%
//     of dropped pairs is "the cause"; below this we surface the mixed
//     case as an explicit branch (Principle 5: mixed-case is a first-class
//     branch, not a fallthrough).
//
//   * MIN_OVERLAP_BARS = 2 -- the forward-fill bar walk requires bars.size()
//     >= 2 (multi_timeframe_replay.cpp:96) because r_next needs both the
//     current and the next bar. An overlap of 0 or 1 bar is mathematically
//     guaranteed to produce zero output pairs regardless of signal density;
//     gate it before paying the alignment cost.

/** Layer 3 -- one reason owning >= this fraction of droppedPairs wins. */
export const ALIGNMENT_SKIP_REASON_DOMINANCE_THRESHOLD = 0.80;

/** Layer 5 -- minimum overlap (in common-interval bars) required between
 *  signal coverage and execution-bar coverage before alignment is allowed
 *  to run. Below this, fail-fast with SIGNAL_EXECUTION_COVERAGE_DISJOINT. */
export const ALIGNMENT_MIN_OVERLAP_BARS = 2;
