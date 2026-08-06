/**
 * Catalog snapshot IO (TICKET_646 Phase 5, generalized by TICKET_1265_3_1 F2).
 *
 * The last-known-good snapshot is the middle link of the P5 degradation chain
 * (live backend -> disk snapshot -> heuristic). These two PURE, path-injected
 * helpers were formerly private to the Electron `LLMKeyResolver`; extracted here
 * so the MCP standalone process gets the SAME degradation chain instead of
 * re-implementing it (AC9). Process-specific concerns stay with the caller:
 *
 * - the snapshot PATH (Electron: app.getPath('userData'); MCP: its data dir),
 * - catalog SOURCE tracking + change events (Electron IPC-only),
 * - the in-flight write guard / in-memory cache.
 *
 * These helpers own only the bytes: atomic write of an envelope, and validated
 * read of one. Failures never throw -- a snapshot is an offline crutch, never a
 * hard dependency (TICKET_856 fallback discipline).
 */

import * as fs from 'node:fs';
import type { BackendProviderResponse } from '@StratCraft/types';
import type { ProviderLogger } from './logger';

/**
 * On-disk snapshot envelope. `payload` is the verbatim backend response from
 * `/api/llm/providers/models`; `timestamp` is ms-since-epoch at write time.
 */
export interface CatalogSnapshotEnvelope {
  timestamp: number;
  payload: BackendProviderResponse;
}

/** Structural check: is this a well-formed snapshot envelope? */
export function isValidSnapshotEnvelope(value: unknown): value is CatalogSnapshotEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const env = value as Partial<CatalogSnapshotEnvelope>;
  return (
    typeof env.timestamp === 'number' &&
    typeof env.payload === 'object' &&
    env.payload !== null &&
    Array.isArray((env.payload as BackendProviderResponse).providers)
  );
}

/**
 * Atomically persist a backend response as the last-known-good snapshot.
 * Writes to `<file>.tmp` then renames over the target so a reader never sees a
 * half-written file. Returns the written envelope on success, or null on any
 * failure (best-effort: the live response path must not break).
 */
export async function writeCatalogSnapshot(
  filePath: string,
  payload: BackendProviderResponse,
  log: ProviderLogger,
): Promise<CatalogSnapshotEnvelope | null> {
  const tmpPath = `${filePath}.tmp`;
  const envelope: CatalogSnapshotEnvelope = { timestamp: Date.now(), payload };
  try {
    await fs.promises.writeFile(tmpPath, JSON.stringify(envelope), 'utf-8');
    await fs.promises.rename(tmpPath, filePath);
    log.debug(`[CatalogSnapshot] persisted: ${filePath}`);
    return envelope;
  } catch (error) {
    log.warn(`[CatalogSnapshot] failed to persist: ${error instanceof Error ? error.message : String(error)}`);
    // Best-effort cleanup of a stale tmp file.
    try {
      if (fs.existsSync(tmpPath)) {
        await fs.promises.unlink(tmpPath);
      }
    } catch {
      // ignore
    }
    return null;
  }
}

/**
 * Read and validate the on-disk snapshot envelope. Returns null when the file
 * is missing, unreadable, unparseable, or structurally wrong (garbage must not
 * be fed to catalog consumers).
 */
export async function readCatalogSnapshot(
  filePath: string,
  log: ProviderLogger,
): Promise<CatalogSnapshotEnvelope | null> {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    if (!isValidSnapshotEnvelope(parsed)) {
      log.warn('[CatalogSnapshot] snapshot has unexpected shape; ignoring');
      return null;
    }
    return parsed;
  } catch (error) {
    log.warn(`[CatalogSnapshot] failed to read: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
