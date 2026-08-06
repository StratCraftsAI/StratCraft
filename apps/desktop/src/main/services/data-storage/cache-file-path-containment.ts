/**
 * TICKET_958_5 AC #4 -- `data_cache_files.file_path` containment guard.
 *
 * Every row in `data_cache_files` exists so a downstream reader (the
 * universe min-bars gate, the data picker, the strategy compiler) can
 * resolve a symbol/interval/provider tuple to a parquet on disk and
 * read it. After TICKET_958_5 collapses the read path, the only
 * legitimate target is the canonical Electron cache directory
 * (`userData/{PARQUET_CACHE_DIR}/...`). A row that points outside that
 * tree -- e.g. at an external upstream research store or a user mount
 * under `/mnt/...` -- would let a future caller bypass the
 * canonical writer and read a non-canonical schema, re-introducing the
 * "two read paths" footgun the ticket exists to remove.
 *
 * This guard runs at the metadata write boundary (`upsertMetadata` in
 * data-cache-manager.ts) and throws a structured TICKET_858 error on
 * any non-contained path. Reject is fail-fast (no swallow, no
 * fallback): the metadata write must not commit, because a row pointing
 * outside the cache is worse than no row at all.
 *
 * Research escape hatch (`STRATCRAFT_RESEARCH_MODE=1`): the same flag
 * that gates Databento provider registration (provider-manager.ts).
 * Setting it bypasses the containment check so a researcher running the
 * Electron app against a local store outside `userData/` can still
 * register rows. Documented in the throw message so a future
 * investigator does not need to chase the env var.
 */

import { join, resolve, relative, isAbsolute, sep } from 'path';
import { PARQUET_CACHE_DIR } from '../../../shared/constants/data-import';
import { getDataRoot } from '../../utils/data-root';

/**
 * Error thrown by `assertCacheFilePathContained`. Structured so callers
 * (UI, log forwarders) can render the failure without re-parsing the
 * message. Distinguished from `CacheWriteIntegrityError` (TICKET_958_4)
 * by `kind: 'containment'`.
 */
export class CacheFilePathContainmentError extends Error {
  public readonly filePath: string;
  public readonly cacheRoot: string;
  public readonly kind: 'containment' = 'containment';

  constructor(message: string, fields: { filePath: string; cacheRoot: string }) {
    super(message);
    this.name = 'CacheFilePathContainmentError';
    this.filePath = fields.filePath;
    this.cacheRoot = fields.cacheRoot;
  }
}

/**
 * Resolve the canonical cache root once per process. Centralised so a
 * future move from `userData/data/parquet` to a different layout is one
 * edit, not seven.
 */
function getCanonicalCacheRoot(): string {
  return resolve(join(getDataRoot(), PARQUET_CACHE_DIR));
}

/**
 * Containment check using `path.relative`. A descendant of `root`
 * produces a relative path that:
 *
 *   - is NOT absolute (would mean different drive / root);
 *   - does NOT start with `..` (would mean path escapes `root`);
 *   - is NOT empty (would mean `filePath === root` itself, never a file).
 *
 * Order matters: we resolve the absolute path of `filePath` BEFORE
 * computing relative, so symlinks / `..` segments in the input string
 * are normalised. We do NOT realpath() the file -- the file may not
 * exist yet at write time (the parquet is written first, then the
 * metadata row; or vice-versa in the merge branch). String-level
 * normalisation is sufficient for the containment promise.
 */
function isPathContained(filePath: string, cacheRoot: string): boolean {
  const resolvedPath = resolve(filePath);
  const rel = relative(cacheRoot, resolvedPath);
  if (rel === '') return false;
  if (isAbsolute(rel)) return false;
  if (rel === '..' || rel.startsWith('..' + sep) || rel.startsWith('../')) return false;
  return true;
}

/**
 * AC #4 boundary guard. Called from `upsertMetadata` at the SINGLE
 * `INSERT INTO data_cache_files` / `UPDATE data_cache_files` site. A
 * non-contained path throws; the metadata write does not commit.
 *
 * Escape hatch: `STRATCRAFT_RESEARCH_MODE=1` bypasses the check (same
 * flag as provider-manager.ts uses for Databento registration). This
 * exists for research workflows that point the Electron app at an
 * external store; it is NOT a production path.
 */
export function assertCacheFilePathContained(filePath: string): void {
  if (process.env.STRATCRAFT_RESEARCH_MODE === '1') {
    return;
  }
  const cacheRoot = getCanonicalCacheRoot();
  if (isPathContained(filePath, cacheRoot)) {
    return;
  }
  throw new CacheFilePathContainmentError(
    `[TICKET_958_5 AC #4] data_cache_files.file_path '${filePath}' is not ` +
      `contained in the canonical cache root '${cacheRoot}'. Every cached ` +
      `parquet MUST live under userData/${PARQUET_CACHE_DIR}/ so the ` +
      `universe min-bars gate's single SQL read path can resolve it. ` +
      `If this is a research workflow against an external store, set ` +
      `STRATCRAFT_RESEARCH_MODE=1 to bypass this guard.`,
    { filePath, cacheRoot },
  );
}

/**
 * Test-only escape used by the AC #4 unit tests to read the resolved
 * cache root without going through `app.getPath`. Exported separately
 * so production code paths cannot accidentally depend on the internal
 * helper.
 */
export const __TEST_ONLY__ = {
  getCanonicalCacheRoot,
  isPathContained,
};
