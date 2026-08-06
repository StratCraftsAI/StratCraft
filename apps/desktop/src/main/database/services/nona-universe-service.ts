/**
 * NonaUniverseService
 *
 * TICKET_927_1_2_B: writer for the `nona_universe` registry. One row per
 * universe; `market_sleeves` is the canonical sorted-dedup'd JSON list of
 * `{ providerId, marketIds, symbols }` -- the forensic single source of
 * truth that the TICKET_927_1_2 backfill rule #2 reads.
 *
 * Construction-time resolution uses the tier-0
 * `staticInstrumentRegistry.marketsOfSymbolList` (TICKET_927_1_1) -- the
 * SAME resolver `persistSignal()` (TICKET_927_1_2_A) and the fusion trunk
 * consume; no parallel registry (TICKET_854).
 *
 * Failure semantics (TICKET_857 fail-fast):
 *   - empty sleeves list             -> throw
 *   - sleeve with invalid providerId -> throw
 *   - sleeve with empty symbols      -> throw
 *   - sleeve whose `(symbols, providerId)` resolves to zero MarketIds via
 *     the registry                   -> throw
 *
 * No fall-through to "all markets" (TICKET_860 / TICKET_927_1 root cause
 * #3); the universe is refused at create time so no downstream consumer
 * has to defend against a broken sleeve list.
 */

import { staticInstrumentRegistry } from '@StratCraft/types';
import type { MarketId } from '@StratCraft/types';
import { DatabaseManager } from '../db-manager';
import { dbLog } from '../../utils/logger';

/**
 * Construction-time input shape. Mirrors `UniverseSleeve` from
 * plugins/.../tool-sweep/universes.ts (the wire shape the UI already
 * produces) plus the orchestrator's pooled-universe payload.
 */
export interface NonaUniversePersistInput {
  /** Universe id; matches `nona_signal_definition.universe_id` (TEXT). */
  id: string;
  /** Human-readable name (defaults to id when caller omits). */
  name?: string;
  /** One entry per construction sleeve; never empty. */
  sleeves: ReadonlyArray<{
    providerId: string;
    symbols: ReadonlyArray<string>;
  }>;
}

/**
 * Persisted JSON shape inside `market_sleeves`. Canonical: sleeves sorted
 * by providerId; marketIds and symbols sorted-dedup'd within each sleeve.
 */
export interface PersistedSleeve {
  providerId: string;
  marketIds: MarketId[];
  symbols: string[];
}

export interface NonaUniverseRow {
  id: string;
  name: string;
  marketSleeves: PersistedSleeve[];
  symbols: string[];
  createdAt: number;
  updatedAt: number;
}

export class NonaUniverseService {
  constructor(private db: DatabaseManager) {}

  /**
   * Resolve every sleeve to its canonical `{providerId, marketIds, symbols}`
   * triple and write/upsert the universe row. Idempotent on `id` -- a
   * second call for the same id rewrites `market_sleeves`, `symbols`, and
   * `updated_at` (the universe is the immutable history of its construction
   * inputs; the writer is the only path that can rewrite it, e.g. when a
   * caller corrects a mislabelled sleeve).
   *
   * Throws fail-fast on any unresolvable sleeve. See file header for the
   * exhaustive list of refuse conditions.
   */
  persist(input: NonaUniversePersistInput): NonaUniverseRow {
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!id) {
      throw new Error(
        `[TICKET_927_1_2_B] NonaUniverseService.persist: id is required and must be a non-empty string`,
      );
    }
    if (!Array.isArray(input.sleeves) || input.sleeves.length === 0) {
      throw new Error(
        `[TICKET_927_1_2_B] NonaUniverseService.persist: universe '${id}' has no sleeves; ` +
          `refusing fail-fast (TICKET_857)`,
      );
    }

    const persistedSleeves: PersistedSleeve[] = [];
    for (const sleeve of input.sleeves) {
      const providerId =
        typeof sleeve.providerId === 'string' ? sleeve.providerId.trim() : '';
      if (!providerId) {
        throw new Error(
          `[TICKET_927_1_2_B] NonaUniverseService.persist: universe '${id}' sleeve has ` +
            `invalid providerId='${String(sleeve.providerId)}'`,
        );
      }
      if (!Array.isArray(sleeve.symbols) || sleeve.symbols.length === 0) {
        throw new Error(
          `[TICKET_927_1_2_B] NonaUniverseService.persist: universe '${id}' sleeve ` +
            `providerId='${providerId}' has an empty symbol list`,
        );
      }

      // Sort + dedup the input symbols so re-persisting an identical
      // construction yields a byte-identical JSON payload (ticket section 5
      // Q3: reproducibility -- old runs must remain re-runnable
      // byte-identically).
      const symbols: string[] = Array.from(new Set<string>(sleeve.symbols)).sort();

      const marketIdSet = staticInstrumentRegistry.marketsOfSymbolList(
        symbols,
        providerId,
      );
      if (marketIdSet.size === 0) {
        const head = symbols.slice(0, 3).join(',');
        const tail = symbols.length > 3 ? ',...' : '';
        throw new Error(
          `[TICKET_927_1_2_B] NonaUniverseService.persist: universe '${id}' sleeve ` +
            `providerId='${providerId}' symbols=[${head}${tail}] resolved to zero ` +
            `MarketIds via the tier-0 instrument registry; refusing fail-fast ` +
            `(TICKET_857; TICKET_927_1_2_B section 3 root cause #2 step 2)`,
        );
      }
      const marketIds = Array.from(marketIdSet).sort() as MarketId[];

      persistedSleeves.push({ providerId, marketIds, symbols });
    }

    // Sort sleeves by providerId so the canonical JSON is stable across
    // input orderings (ticket section 5 Q3 reproducibility).
    persistedSleeves.sort((a, b) => (a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0));

    // Derived flat symbol projection: union over sleeves (ticket section 5
    // Q1 "for fast reads ... updated atomically with market_sleeves").
    const flatSet = new Set<string>();
    for (const sleeve of persistedSleeves) {
      for (const s of sleeve.symbols) flatSet.add(s);
    }
    const flatSymbols = Array.from(flatSet).sort();

    const marketSleevesJson = JSON.stringify(persistedSleeves);
    const symbolsJson = JSON.stringify(flatSymbols);
    const name = typeof input.name === 'string' && input.name.trim().length > 0
      ? input.name.trim()
      : id;
    const now = Date.now();

    // Idempotent upsert -- the `id` is the universe's identity. A repeat
    // write with identical inputs produces a byte-identical JSON payload;
    // updated_at moves forward (so the operator can tell the row was
    // touched), created_at is preserved.
    this.db
      .prepare(
        `INSERT INTO nona_universe (id, name, market_sleeves, symbols, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name           = excluded.name,
           market_sleeves = excluded.market_sleeves,
           symbols        = excluded.symbols,
           updated_at     = excluded.updated_at`,
      )
      .run(id, name, marketSleevesJson, symbolsJson, now, now);

    dbLog.info(
      `[NonaUniverseService] Persisted universe '${id}' (${persistedSleeves.length} sleeve(s), ` +
        `${flatSymbols.length} symbols, markets=[${persistedSleeves.flatMap(s => s.marketIds).join(',')}])`,
    );

    return {
      id,
      name,
      marketSleeves: persistedSleeves,
      symbols: flatSymbols,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Read a universe row by id. Returns null when the id is unknown.
   * Used by TICKET_927_1_2 backfill rule #2 (Python script reads the same
   * table directly; this is the Node-side reader for in-process consumers
   * such as the universe-replay handler or the picker UI).
   */
  get(id: string): NonaUniverseRow | null {
    const row = this.db
      .prepare(
        `SELECT id, name, market_sleeves AS marketSleevesJson,
                symbols AS symbolsJson, created_at AS createdAt,
                updated_at AS updatedAt
           FROM nona_universe WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          name: string;
          marketSleevesJson: string;
          symbolsJson: string;
          createdAt: number;
          updatedAt: number;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      marketSleeves: JSON.parse(row.marketSleevesJson) as PersistedSleeve[],
      symbols: JSON.parse(row.symbolsJson) as string[],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
