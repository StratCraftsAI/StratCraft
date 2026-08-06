/**
 * TICKET_969 Layer 2 -- canonical registry for provider-availability
 * remediation when a signal training window exceeds the execution
 * provider's declared `maxLookback` for the chosen execution interval.
 *
 * Single source of truth shared by:
 *   - TS pre-run gate (apps/desktop/src/main/ipc/v3-handlers.ts
 *     `alpha-factory:run-universe`).
 *   - Renderer UI banner
 *     (plugins/quant-lab-nexus/ui/.../ResultSection.tsx).
 *
 * Convention modelled on TICKET_968 Layer 0 (alignment-skip-reasons),
 * TICKET_822 (canonical signal output schema), and TICKET_179 (no magic
 * numbers / unified constants).
 *
 * Stable-ID rule: once a remediation option is shipped, its `id` MUST
 * NEVER be renamed -- it crosses the main<->renderer IPC boundary and
 * is also used as a locale key prefix. Adding new options is fine;
 * deleting / renaming is a breaking change.
 *
 * Authoring rule: `headline` and `details` here are reference English
 * copy for engineering review and for renderer fallback when a locale
 * is missing. The renderer always prefers the locale-resolved string
 * over these (TICKET_677 dynamic locale injection); these strings are
 * NOT shown directly to non-English users.
 */

/** Stable code emitted by the pre-run gate. Mirrors TICKET_968's
 *  `signal_execution_coverage_window_mismatch` classification but
 *  fires BEFORE bar fetch (vs Layer 5 preflight which fires AFTER). */
export type ProviderLookbackGateCode = 'SIGNAL_WINDOW_EXCEEDS_PROVIDER_LOOKBACK';

/** Stable IDs of every remediation option. */
export type ProviderLookbackRemediationOptionId =
  | 'switch_provider'
  | 'narrow_signal_window'
  | 'coarsen_execution_interval';

/** Per-option metadata for the remediation card. */
export interface ProviderLookbackRemediationOption {
  /** Stable string ID -- on the wire main<->renderer, also locale key prefix. */
  readonly id: ProviderLookbackRemediationOptionId;
  /** One-line summary (reference English copy). */
  readonly headline: string;
  /** Multi-line guidance (reference English copy). References sibling
   *  tickets so a future operator can trace the decision history. */
  readonly details: string;
  /** Optional prerequisite (e.g. 'Alpaca API key' for switch_provider). */
  readonly requires?: string;
  /** Related ticket(s) -- traceability back to the design history. */
  readonly relatedTickets: readonly string[];
}

/** Structured remediation card returned by the pre-run gate. */
export interface ProviderLookbackRemediation {
  readonly code: ProviderLookbackGateCode;
  readonly options: readonly ProviderLookbackRemediationOption[];
}

/** Per-signal coverage entry carried in the gate diagnostic so the
 *  operator can immediately see which signal pushes the union out. */
export interface ProviderLookbackPerSignalRange {
  readonly signalId: string;
  readonly startMs: number;
  readonly endMs: number;
}

/** Reason literal for an entry in `droppedSignalsIfRelaxed`. Identifies
 *  whether the signal was removed because its start pushed the fusion
 *  intersection's left edge forward, or its end pulled the right edge back. */
export type ProviderLookbackRelaxationReason =
  | 'collapses_intersection_start'
  | 'collapses_intersection_end';

/** Entry in `droppedSignalsIfRelaxed`: a signal greedy-relaxation removed
 *  in order to find a viable subset that passes the gate. */
export interface ProviderLookbackDroppedSignal {
  readonly signalId: string;
  readonly reason: ProviderLookbackRelaxationReason;
  readonly droppedStartMs: number;
  readonly droppedEndMs: number;
}

/** TICKET_970_6 -- which failure mode produced this diagnostic.
 *
 *  - `CATALOG_ONLY`: zero signals survived Layer 1 catalog L2; no
 *    fusion geometry was computed. The fusion-geometry block on the
 *    diagnostic is `null`. The renderer must NOT render the
 *    fusion-overlap sentence; it should render `catalogRefusals`
 *    per-signal instead.
 *  - `CATALOG_AND_FUSION`: at least one signal was catalog-refused
 *    AND the surviving subset's fusion intersection is still too
 *    narrow. Both the catalog refusal list and the fusion geometry
 *    are populated.
 *  - `FUSION_ONLY`: every selected signal cleared catalog L2 but the
 *    fusion intersection of the full set is below the overlap floor.
 *    `catalogRefusals` is empty; fusion geometry is populated. */
export type ProviderLookbackRefusalCategory =
  | 'CATALOG_ONLY'
  | 'CATALOG_AND_FUSION'
  | 'FUSION_ONLY';

/** TICKET_970_6 -- per-signal catalog refusal lifted onto the wire-format
 *  diagnostic so the renderer can show the catalog's `reason` text
 *  verbatim per signal, instead of re-parsing the aggregated error
 *  message. Mirrors `Layer1CatalogRefusal` but trimmed to the three
 *  fields the renderer needs (no `L2Result` payload on the wire). */
export interface ProviderLookbackCatalogRefusalRow {
  readonly signalId: string;
  /** Catalog L2 bottleneck enum, e.g. `L3_PAIR_STREAM_NO_PERSISTENCE`,
   *  `L0_PROVIDER_LOOKBACK`, `L1_INVENTORY_TOO_LATE`,
   *  `SIGNAL_TRAINING_WINDOW_TOO_EARLY`. Stringly-typed on the wire so
   *  the renderer does not have to track the union literal. */
  readonly bottleneck: string;
  /** Catalog's human-readable reason, suitable for direct display. */
  readonly reason: string;
}

/** Diagnostic payload emitted alongside the gate refusal.
 *
 *  TICKET_969 2026-06-14 follow-up: the predicate is the **fusion-effective
 *  intersection** of every selected signal's coverage window with the
 *  provider window, NOT the union -- because
 *  `signal_fusion_plugin.cpp:178-193` hard-throws unless every input
 *  series has bit-identical timestamps. The intersection is therefore
 *  the only time axis on which fusion can run. The old union fields
 *  (`signalUnionStartMs` / `signalUnionEndMs` / `gapMs` / `gapDays`)
 *  are deleted -- they encoded the defective model.
 *
 *  TICKET_970_6: the fusion-geometry block is now nullable. When every
 *  selected signal is refused at Layer 1 catalog (no surviving subset
 *  to compute fusion over), the four fields
 *  `fusionIntersectionStartMs / fusionIntersectionEndMs /
 *  fusionOverlapBars / constrainingSignal` are written as `null`
 *  together, and `refusalCategory === 'CATALOG_ONLY'`. The renderer
 *  branches on `refusalCategory` (or equivalently the `null` check)
 *  to choose between the fusion-overlap sentence and the per-signal
 *  catalog refusal list. The previous wire-format zero-stuffed those
 *  fields with `0` so the renderer painted `1970-01-01 00:00:00` --
 *  see TICKET_970_6 for the repro. */
export interface ProviderLookbackGateDiagnostic {
  /** Data provider id (e.g. 'yfinance'). */
  readonly provider: string;
  /** Common execution interval ('5m' / '15m' / '30m' / '1h' ...). */
  readonly executionInterval: string;
  /** Provider's declared maxLookback spec for the interval (e.g. '60d'). */
  readonly maxLookbackSpec: string;
  /** Parsed maxLookback in milliseconds. */
  readonly maxLookbackMs: number;
  /** `now - maxLookbackMs` -- the earliest timestamp the provider serves. */
  readonly providerWindowStartMs: number;
  /** Convenience: `maxLookbackMs` floored to whole calendar days. */
  readonly maxLookbackDays: number;
  /** TICKET_970_6 -- which failure mode produced this diagnostic.
   *  Drives the renderer's branch between the fusion-overlap sentence
   *  (FUSION_ONLY / CATALOG_AND_FUSION) and the per-signal catalog
   *  refusal list (CATALOG_ONLY / CATALOG_AND_FUSION). */
  readonly refusalCategory: ProviderLookbackRefusalCategory;
  /** TICKET_970_6 -- per-signal catalog refusal verdicts, with the
   *  catalog's reason text suitable for direct display. Empty when
   *  `refusalCategory === 'FUSION_ONLY'` (every signal cleared
   *  catalog L2 but the fusion intersection still failed). */
  readonly catalogRefusals: readonly ProviderLookbackCatalogRefusalRow[];
  /** The fusion-effective overlap window. Computed as
   *    fusionStartMs = max(providerWindowStartMs, max(perSignalStartMs))
   *    fusionEndMs   = min(now,                   min(perSignalEndMs))
   *  This is the time axis the C++ signal_fusion plugin will actually
   *  see, per its strict-aligned inner-join contract
   *  (signal_fusion_plugin.cpp:178-193).
   *
   *  TICKET_970_6: `null` when zero signals survived catalog L2 (no
   *  fusion to compute over). The four fusion-geometry fields move
   *  to `null` together -- the handler MUST NOT set some but not
   *  others. */
  readonly fusionIntersectionStartMs: number | null;
  readonly fusionIntersectionEndMs: number | null;
  /** Floor of `max(0, fusionIntersectionEndMs - fusionIntersectionStartMs) /
   *  (commonIntervalSec * 1000)`. The gate trips when this is below
   *  `requiredOverlapBars`. `null` when `refusalCategory === 'CATALOG_ONLY'`. */
  readonly fusionOverlapBars: number | null;
  /** Mirror of `ALIGNMENT_MIN_OVERLAP_BARS` (currently 2). Carried in the
   *  diagnostic so the UI can format the message without re-importing
   *  the constant from `@StratCraft/types`. Always populated -- it is
   *  the policy floor, not a measurement, so it does not become null
   *  when fusion was not computed. */
  readonly requiredOverlapBars: number;
  /** The single signal whose start pushes `fusionIntersectionStartMs`
   *  forward, AND the single signal whose end pulls
   *  `fusionIntersectionEndMs` back. May be the SAME signal id on both
   *  sides (e.g. a one-bar signal).
   *
   *  TICKET_970_6: `null` when `refusalCategory === 'CATALOG_ONLY'`.
   *  Moves to `null` together with the three fusion-geometry numbers
   *  above -- there is no constraining signal when no fusion was
   *  computed. */
  readonly constrainingSignal: {
    readonly startSide: { readonly signalId: string; readonly startMs: number };
    readonly endSide: { readonly signalId: string; readonly endMs: number };
  } | null;
  /** Populated when greedy relaxation found a viable subset of signals
   *  that would pass the gate. Empty array means relaxation did not
   *  help (intersection collapses irrespective of which single signal
   *  is removed -- typically because >= 2 signals are pairwise
   *  disjoint). The renderer uses this to offer a "Run with N
   *  signals" confirm dialog (G2 / C15). Always an array (possibly
   *  empty); not nullable -- relaxation never ran on a CATALOG_ONLY
   *  refusal because there were no survivors to relax over, so the
   *  array is empty in that case. */
  readonly droppedSignalsIfRelaxed: readonly ProviderLookbackDroppedSignal[];
  /** Per-signal coverage breakdown, so the operator can see which
   *  signal forces the intersection edges. Empty array on CATALOG_ONLY
   *  refusal. */
  readonly perSignalRanges: readonly ProviderLookbackPerSignalRange[];
}

/**
 * Canonical registry. Every option MUST have an entry here. The order
 * is the recommended-presentation order in the UI banner (A -> B -> C
 * per TICKET_969 "three remediation paths" section).
 */
export const PROVIDER_LOOKBACK_REMEDIATION: ProviderLookbackRemediation = {
  code: 'SIGNAL_WINDOW_EXCEEDS_PROVIDER_LOOKBACK',
  options: [
    {
      id: 'switch_provider',
      headline:
        'Switch the execution provider to one with longer intraday history.',
      details:
        'yfinance hard-caps sub-1h intraday history to ~60 calendar days. '
        + 'For multi-month / multi-year backtests at 5m / 15m / 30m on US '
        + 'equities, switch to Alpaca (see TICKET_955) which serves '
        + 'multi-year history at those intervals. The signal window is '
        + 'preserved end-to-end; no IC sample-size loss.',
      requires: 'Alpaca API key (free tier sufficient for historical bars)',
      relatedTickets: ['TICKET_955'],
    },
    {
      id: 'narrow_signal_window',
      headline:
        'Re-train the signals over a window that fits the provider lookback.',
      details:
        'Re-window the signals so their persisted coverage starts no '
        + 'earlier than (now - maxLookback). Best for quick validation on '
        + 'the latest market regime when a long history is not '
        + 'statistically required. Trade-off: IC sample size shrinks '
        + 'proportionally to the window cut.',
      relatedTickets: ['TICKET_968'],
    },
    {
      id: 'coarsen_execution_interval',
      headline:
        'Coarsen the execution interval to 1h or higher (no clamp on yfinance).',
      details:
        'yfinance serves 1h bars for up to 730 calendar days (~2 years) '
        + 'and 1d / 1w with no limit. Switching the execution interval '
        + 'from 5m / 15m / 30m to 1h preserves the full signal window '
        + 'with zero provider onboarding. Trade-off: lower bar resolution '
        + 'degrades intra-hour slippage / fill-quality assumptions.',
      relatedTickets: ['TICKET_955'],
    },
  ],
} as const;

/** Convenience accessor -- returns the canonical option by id. */
export function getProviderLookbackRemediationOption(
  id: ProviderLookbackRemediationOptionId,
): ProviderLookbackRemediationOption {
  const opt = PROVIDER_LOOKBACK_REMEDIATION.options.find((o) => o.id === id);
  if (!opt) {
    throw new Error(
      `[provider-availability-remediation] unknown option id '${id}'; `
      + `expected one of: ${PROVIDER_LOOKBACK_REMEDIATION.options.map((o) => o.id).join(', ')}.`,
    );
  }
  return opt;
}
