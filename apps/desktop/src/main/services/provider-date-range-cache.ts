/**
 * TICKET_1026: Provider date-range cache (memory + disk).
 *
 * Stale-while-revalidate pattern:
 *   - Cache hit (< 24h old): return immediately.
 *   - Cache hit (>= 24h old): return stale value AND trigger background
 *     refresh. No blocking.
 *   - Cache miss: return null; caller falls through to live probe.
 *     The live result is written back into cache by the caller via
 *     `putSymbolRange`.
 *
 * Disk layer: JSON file at {userData}/provider-date-range-cache.json.
 * Loaded once on init; written atomically (tmp + rename) on every put.
 *
 * Background prefetch: `prefetchAllProviders` iterates every registered
 * provider × its last-seen symbols and refreshes date ranges. Launched
 * after startup completes; respects each provider's rate limiter by
 * going through the provider's own `getSymbolDateRange`.
 */

import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { appLog } from '../utils/logger';
import { getDataProviderManager } from './data-providers/provider-manager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CacheEntry {
  startMs: number;
  endMs: number;
  updatedAt: number;
}

interface DiskEnvelope {
  version: 1;
  entries: Record<string, CacheEntry>;
  knownSymbols: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_FILENAME = 'provider-date-range-cache.json';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const memory = new Map<string, CacheEntry>();
let knownSymbols = new Map<string, Set<string>>();
let diskLoaded = false;

// ---------------------------------------------------------------------------
// Key helper
// ---------------------------------------------------------------------------

function cacheKey(providerId: string, symbol: string): string {
  return `${providerId}:${symbol}`;
}

// ---------------------------------------------------------------------------
// Disk I/O
// ---------------------------------------------------------------------------

function getCachePath(): string {
  return path.join(app.getPath('userData'), CACHE_FILENAME);
}

function loadDiskCache(): void {
  if (diskLoaded) return;
  diskLoaded = true;

  const filePath = getCachePath();
  try {
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const envelope = JSON.parse(raw) as DiskEnvelope;
    if (envelope.version !== 1) return;

    for (const [key, entry] of Object.entries(envelope.entries)) {
      if (
        typeof entry.startMs === 'number' &&
        typeof entry.endMs === 'number' &&
        typeof entry.updatedAt === 'number'
      ) {
        memory.set(key, entry);
      }
    }

    if (envelope.knownSymbols) {
      for (const [pid, syms] of Object.entries(envelope.knownSymbols)) {
        if (Array.isArray(syms)) {
          knownSymbols.set(pid, new Set(syms));
        }
      }
    }

    appLog.info(`[DateRangeCache] Loaded ${memory.size} entries from disk`);
  } catch (err) {
    appLog.warn(
      `[DateRangeCache] Failed to load disk cache: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function writeDiskCacheAsync(): void {
  const filePath = getCachePath();
  const tmpPath = `${filePath}.tmp`;

  const entries: Record<string, CacheEntry> = {};
  for (const [key, val] of memory) {
    entries[key] = val;
  }

  const symMap: Record<string, string[]> = {};
  for (const [pid, syms] of knownSymbols) {
    symMap[pid] = Array.from(syms);
  }

  const envelope: DiskEnvelope = { version: 1, entries, knownSymbols: symMap };
  const json = JSON.stringify(envelope);

  fs.promises
    .writeFile(tmpPath, json, 'utf-8')
    .then(() => fs.promises.rename(tmpPath, filePath))
    .catch((err) => {
      appLog.warn(
        `[DateRangeCache] Disk write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initDateRangeCache(): void {
  loadDiskCache();
}

export function getSymbolRangeFromCache(
  providerId: string,
  symbol: string,
): { entry: CacheEntry | null; stale: boolean } {
  loadDiskCache();
  const key = cacheKey(providerId, symbol);
  const entry = memory.get(key) ?? null;
  if (entry === null) return { entry: null, stale: false };
  const stale = Date.now() - entry.updatedAt >= CACHE_TTL_MS;
  return { entry, stale };
}

export function putSymbolRange(
  providerId: string,
  symbol: string,
  startMs: number,
  endMs: number,
): void {
  const key = cacheKey(providerId, symbol);
  memory.set(key, { startMs, endMs, updatedAt: Date.now() });

  let syms = knownSymbols.get(providerId);
  if (!syms) {
    syms = new Set();
    knownSymbols.set(providerId, syms);
  }
  syms.add(symbol);

  writeDiskCacheAsync();
}

export function trackSymbols(providerId: string, symbols: string[]): void {
  let syms = knownSymbols.get(providerId);
  if (!syms) {
    syms = new Set();
    knownSymbols.set(providerId, syms);
  }
  for (const s of symbols) syms.add(s);
}

/**
 * Background prefetch: refresh date ranges for all providers × known symbols.
 * Non-blocking; errors are logged and swallowed.
 */
export async function prefetchAllProviders(): Promise<void> {
  loadDiskCache();
  const mgr = getDataProviderManager();
  const providers = mgr.listProviders();

  let refreshed = 0;
  let skipped = 0;

  for (const { id: providerId } of providers) {
    if (!mgr.hasProvider(providerId)) continue;
    const provider = mgr.getProvider(providerId);
    if (typeof provider.getSymbolDateRange !== 'function') continue;

    const syms = knownSymbols.get(providerId);
    if (!syms || syms.size === 0) continue;

    for (const symbol of syms) {
      const cached = getSymbolRangeFromCache(providerId, symbol);
      if (cached.entry && !cached.stale) {
        skipped++;
        continue;
      }

      try {
        const range = await provider.getSymbolDateRange(symbol);
        if (range.startTime && range.endTime) {
          putSymbolRange(
            providerId,
            symbol,
            new Date(range.startTime).getTime(),
            new Date(range.endTime).getTime(),
          );
          refreshed++;
        }
      } catch (err) {
        appLog.warn(
          `[DateRangeCache] Prefetch failed for ${providerId}:${symbol}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  appLog.info(
    `[DateRangeCache] Prefetch complete: ${refreshed} refreshed, ${skipped} still fresh`,
  );
}

// ---------------------------------------------------------------------------
// Test-only reset
// ---------------------------------------------------------------------------

export function _resetForTest(): void {
  memory.clear();
  knownSymbols = new Map();
  diskLoaded = false;
}
