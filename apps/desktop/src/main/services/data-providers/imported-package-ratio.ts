/**
 * TICKET_919_9 -- compute a BYOD imported package's
 * `calendar_padding_ratio_json` from its per-symbol
 * `(first_timestamp, last_timestamp, row_count)` triples.
 *
 * TICKET_1289_1 F1: the implementation moved to @StratCraft/db-migrations so the
 * v-imported-packages backfill migration body (which now lives in that shared
 * package) and the standalone MCP host can both reach it without importing
 * apps/desktop source. This module re-exports it verbatim so every existing
 * app-side consumer (`data-cache-manager`, `registerImportedPackage`, the
 * dedicated unit test) keeps its current import path (TICKET_854 single source).
 *
 * The full contract (median aggregation, strict skip rules, no fabricated 1.0)
 * is documented on the shared implementation.
 */
export {
  computePackageCalendarRatios,
  type PackageRatioInputRow,
} from '@StratCraft/db-migrations';
