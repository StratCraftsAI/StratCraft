/**
 * Surface-wide mutation-result contract (TICKET_1280 P2).
 *
 * The MCP tool surface historically returned mutation outcomes as bare counters
 * (`{ added, skipped, errors }`). A counter is an *aggregate over erased
 * causality*: `skipped: 1` cannot say *why* a signal was skipped (its input id
 * was already a chip vs. it resolved to a chip that was already present), nor
 * *which* id it resolved to. Handed to an LLM, the erased part is reconstructed
 * by narrative -- the TICKET_1280 21-call flail and its unverifiable "already
 * exists" claim.
 *
 * This module is the single source of truth for the shape every mutating tool
 * returns. Counters are a *projection* of `results[]`, never independent state.
 * The information present at the branch point (which resolution fired) reaches
 * the caller verbatim, satisfying TICKET_858 (no erased causality) and
 * TICKET_857 (actionable, distinct outcomes) at the tool-contract layer.
 *
 * Two runtimes share this contract (as with the signal-discovery query
 * builders): the standalone MCP server and the Electron main process. This
 * module is pure TS with no runtime deps so both can import it.
 */

/**
 * One outcome per input the caller sent to a mutating tool. The `outcome` is a
 * closed enum per tool (see the tool's own union type); `resolvedVia` /
 * `resolvedId` expose the resolution path so the caller can *verify its own
 * claim* against a paired read tool by string equality (TICKET_1280 P3).
 */
export interface MutationOutcome<TInput = string, TOutcome extends string = string> {
  /** The id/value the caller sent, verbatim. */
  input: TInput;
  /** Closed enum per tool, e.g. 'added' | 'already_present_input_id' | ... */
  outcome: TOutcome;
  /** How the input resolved to a canonical id, when a resolution step ran. */
  resolvedVia?: 'input_id' | 'definition_fingerprint' | 'persisted_id';
  /** Canonical id the input resolved to (namespace-named, TICKET_1280 P1). */
  resolvedId?: string;
  /** Human/actionable detail (TICKET_857 style). */
  detail?: string;
}

/**
 * A mutating tool's full result. `results[]` is the source of truth (one entry
 * per input); the summary counters are DERIVED from it and kept only for
 * back-compat with existing callers.
 */
export interface MutationResult<TInput = string, TOutcome extends string = string> {
  /** One outcome per input, order-preserved against the caller's input array. */
  results: MutationOutcome<TInput, TOutcome>[];
  /** DERIVED from results[] -- never set independently. */
  added: number;
  /** DERIVED from results[] -- never set independently. */
  skipped: number;
  /** DERIVED from results[] -- per-input actionable error details. */
  errors: string[];
  /** Post-state the caller needs to verify its own claim (P3). Optional per tool. */
  totalSignals?: number;
}

/**
 * Derive the back-compat counters from `results[]`. This is the ONLY way a
 * MutationResult's counters are produced -- callers must not assemble counters
 * by hand, so `skipped` can never disagree with the per-id outcomes. A test at
 * the contract layer (registration-shape) enforces that mutating tools route
 * their return through this helper.
 *
 * @param results     per-input outcomes
 * @param addedWhen   the outcome value(s) that count as "added"
 */
export function deriveMutationCounters<TInput, TOutcome extends string>(
  results: MutationOutcome<TInput, TOutcome>[],
  addedWhen: TOutcome | TOutcome[],
): { added: number; skipped: number; errors: string[] } {
  const addedSet = new Set<TOutcome>(Array.isArray(addedWhen) ? addedWhen : [addedWhen]);
  let added = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const r of results) {
    if (addedSet.has(r.outcome)) {
      added++;
    } else if (isErrorOutcome(r.outcome)) {
      // An error outcome contributes to errors[]; it is neither added nor a
      // benign skip. Classification is by outcome NAME alone -- a `not_found`
      // with an empty detail is still an error (TICKET_1280 review Minor): the
      // "error outcome -> error bucket" invariant must not depend on a
      // non-empty detail string, or a detail-less failure silently reads as a
      // benign skip.
      errors.push(r.detail || r.outcome);
    } else {
      skipped++;
    }
  }
  return { added, skipped, errors };
}

/**
 * An outcome is an *error* (goes to errors[], not skipped) when it names a
 * failure the caller must act on rather than a benign no-op. The convention:
 * outcomes prefixed `not_found` / `_not_` (e.g. 'definition_not_persisted') are
 * errors; `added` / `already_present_*` are not.
 */
function isErrorOutcome(outcome: string): boolean {
  return outcome.startsWith('not_found') || outcome.includes('_not_');
}

/**
 * TICKET_1280 P3 (read-your-writes): project the canonical `persistedSignalId`
 * onto every Alpha Factory chip. A chip's `id` field holds the persisted
 * `nona_signal.id` (as a string); this exposes it under the same
 * namespace-named field the add tool's outcomes reference (`resolvedId`), so a
 * membership check ("input 26530 is chip X") is a field-name-identical string
 * equality against the read tool's output -- never a cross-namespace guess.
 *
 * Chips persisted before this projection existed gain the field on read without
 * a migration (the id is already present, only differently named). This helper
 * is shared so BOTH read paths -- the standalone MCP direct-SQL fallback and the
 * Electron `loadAlphaFactoryConfigOp` (the live guide-chat path) -- project
 * identically; a divergence there is exactly the AC3 runtime blocker this
 * elevation to a shared helper closes.
 */
export function projectChipPersistedIds(
  chips: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return chips.map(c => (
    c.persistedSignalId !== undefined
      ? c
      : { ...c, persistedSignalId: Number(c.id) }
  ));
}
