/**
 * Model-list curation primitives (TICKET_1265_3_1).
 *
 * Two pure helpers shared by the Electron main process and the MCP standalone
 * server, so both ends produce byte-identical picker payloads:
 *
 * - `denoiseSortModels` (F5): the LAST link in the P5 degradation chain. When
 *   NO backend curation is available, it orders the raw discovery pile sanely.
 *   It never REMOVES an entry (P3 applies to the fallback too) -- dated-snapshot
 *   and modality-variant ids merely SINK below plain chat ids, and plain ids
 *   sort by id DESCENDING (newer versions first) instead of the fetchers'
 *   ascending alphabetical.
 * - `markRecommended` (F1 helper): given the curated id set for a provider,
 *   flag models whose id is curated. In Round 2 (curated-only display) the
 *   caller has already filtered the list to the curated intersection, so every
 *   entry gets the flag; the helper stays general (marks only curated ids) so
 *   the fallback paths that pass a mixed list remain correct.
 *
 * Round 2 (P1): when curation is available it is the DISPLAY SET (curated
 * INTERSECT discovered), not a ranking overlay. BYOK usability with zero
 * backend / zero login is preserved by the P5 degradation chain (discovery +
 * F5 de-noising), never by showing the raw pile alongside curation.
 */

import type { CuratedModel } from './resolve';

// =============================================================================
// F5: terminal-fallback de-noising sort
// =============================================================================

/**
 * Dated-snapshot id markers, e.g. `gpt-4o-2024-08-06` or `gpt-4-0613`.
 * A trailing `-YYYY-MM-DD` or `-NNNN` (4-digit) segment marks a pinned
 * snapshot that a user rarely wants over the rolling alias.
 */
const DATED_SNAPSHOT_RE = /-\d{4}-\d{2}-\d{2}$|-\d{4}$/;

/**
 * Modality-variant markers: non-chat or specialized builds that clutter a
 * chat-model picker (realtime/audio/transcribe/tts/search).
 */
const MODALITY_VARIANT_RE = /-realtime|-audio|-transcribe|-tts|-search/;

/** A model id is "noisy" when it is a dated snapshot or a modality variant. */
function isNoisyId(id: string): boolean {
  return DATED_SNAPSHOT_RE.test(id) || MODALITY_VARIANT_RE.test(id);
}

/**
 * F5: order a raw discovery pile deterministically WITHOUT removing anything.
 *
 * Ranking:
 *   1. Plain (non-noisy) ids first, noisy ids (dated snapshots / modality
 *      variants) sunk below.
 *   2. Within each group, sort by id DESCENDING so newer versions surface
 *      first (`gpt-5.2` before `gpt-4o`), replacing the ascending alphabetical
 *      the per-provider fetchers apply.
 *
 * Stable and non-mutating: returns a new array; equal keys keep input order.
 */
export function denoiseSortModels<T extends { id: string }>(models: readonly T[]): T[] {
  return [...models].sort((a, b) => {
    const an = isNoisyId(a.id) ? 1 : 0;
    const bn = isNoisyId(b.id) ? 1 : 0;
    if (an !== bn) return an - bn;          // plain ids ahead of noisy ones
    return b.id.localeCompare(a.id);        // descending within a group
  });
}

// =============================================================================
// F1 helper: intersection marking
// =============================================================================

/**
 * F1/P2: mark models as `recommended` when their id is in the curated set for
 * this provider. Returns a NEW array; input order is preserved. In Round 2 the
 * caller filters the discovered list to the curated intersection before calling
 * this, so every entry is flagged; curated-but-not-discovered ids are the
 * caller's concern (they must NOT be added -- the key does not serve them).
 */
export function markRecommended(
  models: readonly CuratedModel[],
  curatedIds: ReadonlySet<string>,
): CuratedModel[] {
  if (curatedIds.size === 0) return [...models];
  return models.map(m =>
    curatedIds.has(m.id) ? { ...m, recommended: true } : { ...m },
  );
}
