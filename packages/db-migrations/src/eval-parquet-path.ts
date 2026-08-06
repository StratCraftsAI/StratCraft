/**
 * Eval-parquet root path derivation, shared by Electron main and the standalone
 * MCP server (TICKET_1289_1 F1, TICKET_854).
 *
 * The v96 migration's preflight resolves the on-disk root of the per-signal eval
 * parquet store before dropping the SQLite eval tables. That resolution is
 * `<dataRoot>/data/parquet/eval`. Both hosts must agree on this path, so the
 * join lives here; each host supplies only its own `dataRoot` (Electron:
 * app.getPath('userData') or STRATCRAFT_DATA_ROOT; standalone: the same, via its
 * resolveUserDataDir()).
 *
 * Mirrors apps/desktop/.../eval-parquet-writer.ts getEvalParquetRoot() +
 * PARQUET_CACHE_DIR ('data/parquet'); the Electron side keeps its own richer
 * writer (with the test override) and is unaffected -- only the migration
 * preflight routes through the shared host.
 */
import { join } from 'path';

/** Subdir under the data root that holds the parquet cache (mirror of PARQUET_CACHE_DIR). */
export const PARQUET_CACHE_DIR = 'data/parquet';

/** `<dataRoot>/data/parquet/eval` -- the per-signal eval parquet store root. */
export function evalParquetRootFor(dataRoot: string): string {
  return join(dataRoot, PARQUET_CACHE_DIR, 'eval');
}
