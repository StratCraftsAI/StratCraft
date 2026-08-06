/**
 * NonaUniverseService -- TICKET_927_1_2_B unit tests.
 *
 * Section 9 acceptance covered here:
 *   (a) pooled-universe create writes sorted dedup'd `market_sleeves`
 *   (b) single-sleeve create writes a 1-entry list
 *   (c) unresolvable sleeve refuses universe-create fail-fast
 *   (d) the sleeves union (what backfill rule #2 computes) equals the
 *       MarketScope a forward `persistSignal()` write (TICKET_927_1_2_A
 *       deriveMarketScope path) would produce from the same sleeves.
 *
 * Runs against an in-memory SQLite carrying the v88 schema exactly so
 * the JSON round-trip is real (no shape mocks). The MarketScope and
 * staticInstrumentRegistry symbols are the real exports from
 * @StratCraft/types -- the same resolver persistSignal() consumes
 * (TICKET_854 single source of truth).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import { MarketScope, staticInstrumentRegistry } from '@StratCraft/types';

vi.mock('../../../utils/logger', () => ({
  dbLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { NonaUniverseService } from '../nona-universe-service';

// Minimal DatabaseManager shim: NonaUniverseService only calls .prepare().
function asDbManager(db: BetterSqlite3Database): any {
  return { prepare: (sql: string) => db.prepare(sql) };
}

function createInMemoryDb(): BetterSqlite3Database {
  const db = new Database(':memory:');
  // Mirror migration v88 exactly.
  db.exec(`
    CREATE TABLE nona_universe (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      market_sleeves  TEXT NOT NULL,
      symbols         TEXT NOT NULL,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );
    CREATE INDEX idx_nona_universe_market_sleeves
      ON nona_universe(market_sleeves);
  `);
  return db;
}

describe('TICKET_927_1_2_B NonaUniverseService.persist', () => {
  let db: BetterSqlite3Database;
  let svc: NonaUniverseService;

  beforeEach(() => {
    db = createInMemoryDb();
    svc = new NonaUniverseService(asDbManager(db));
  });

  afterEach(() => {
    db.close();
  });

  // -------------------------------------------------------------------------
  // (a) Pooled-universe -- sorted, dedup'd sleeves.
  // -------------------------------------------------------------------------
  it('(a) pooled-universe writes sorted dedup\'d market_sleeves JSON', () => {
    // Three sleeves on purpose in NON-sorted providerId order; one sleeve
    // has a duplicate symbol. The persisted JSON must come back sorted by
    // providerId and with symbols dedup'd + sorted within each sleeve.
    const row = svc.persist({
      id: 'u_xmkt',
      name: 'Cross-Market Pooled',
      sleeves: [
        { providerId: 'yfinance', symbols: ['EURUSD=X', 'GBPUSD=X'] },
        { providerId: 'alpaca', symbols: ['MSFT', 'AAPL', 'AAPL'] },
        { providerId: 'ccxt', symbols: ['BTC/USDT', 'ETH/USDT'] },
      ],
    });

    expect(row.id).toBe('u_xmkt');
    expect(row.name).toBe('Cross-Market Pooled');

    // Three sleeves, sorted by providerId alphabetically:
    //   alpaca < ccxt < yfinance
    expect(row.marketSleeves.map((s) => s.providerId)).toEqual([
      'alpaca',
      'ccxt',
      'yfinance',
    ]);

    // alpaca sleeve: AAPL appears once, symbols sorted.
    expect(row.marketSleeves[0]).toEqual({
      providerId: 'alpaca',
      marketIds: ['alpaca_us_equity'],
      symbols: ['AAPL', 'MSFT'],
    });

    // ccxt sleeve.
    expect(row.marketSleeves[1]).toEqual({
      providerId: 'ccxt',
      marketIds: ['ccxt_spot'],
      symbols: ['BTC/USDT', 'ETH/USDT'],
    });

    // yfinance sleeve: =X shape -> forex MarketId.
    expect(row.marketSleeves[2]).toEqual({
      providerId: 'yfinance',
      marketIds: ['yfinance_forex'],
      symbols: ['EURUSD=X', 'GBPUSD=X'],
    });

    // Flat symbol projection (Q1) -- union over sleeves, sorted.
    expect(row.symbols).toEqual([
      'AAPL',
      'BTC/USDT',
      'ETH/USDT',
      'EURUSD=X',
      'GBPUSD=X',
      'MSFT',
    ]);

    // On-disk shape: JSON columns parse to the canonical sleeve list and
    // flat symbols. Re-read the row to confirm the disk-side payload is
    // exactly what the backfill / picker / UI will read.
    const persisted = db
      .prepare('SELECT * FROM nona_universe WHERE id = ?')
      .get('u_xmkt') as {
        id: string;
        name: string;
        market_sleeves: string;
        symbols: string;
        created_at: number;
        updated_at: number;
      };
    expect(persisted.id).toBe('u_xmkt');
    expect(persisted.name).toBe('Cross-Market Pooled');
    expect(JSON.parse(persisted.market_sleeves)).toEqual(row.marketSleeves);
    expect(JSON.parse(persisted.symbols)).toEqual(row.symbols);
    expect(persisted.created_at).toBe(persisted.updated_at);
  });

  // -------------------------------------------------------------------------
  // (b) Single-sleeve universe.
  // -------------------------------------------------------------------------
  it('(b) single-sleeve universe writes a 1-entry market_sleeves list', () => {
    const row = svc.persist({
      id: 'sp500_top50',
      sleeves: [
        { providerId: 'alpaca', symbols: ['AAPL', 'MSFT', 'GOOGL'] },
      ],
    });

    // Name defaults to id when omitted.
    expect(row.name).toBe('sp500_top50');
    expect(row.marketSleeves).toHaveLength(1);
    expect(row.marketSleeves[0]).toEqual({
      providerId: 'alpaca',
      marketIds: ['alpaca_us_equity'],
      symbols: ['AAPL', 'GOOGL', 'MSFT'],
    });
    expect(row.symbols).toEqual(['AAPL', 'GOOGL', 'MSFT']);
  });

  // -------------------------------------------------------------------------
  // (c) Refuse on unresolvable sleeve (TICKET_857 fail-fast).
  // -------------------------------------------------------------------------
  it('(c) refuses fail-fast when a sleeve resolves to zero MarketIds', () => {
    // Bare 'AAPL' with an unregistered providerId 'mysterydata' -> the
    // tier-0 registry's switch returns null for every symbol (no
    // provider-specific resolver) and `marketsOfSymbolList` -> empty set.
    expect(() =>
      svc.persist({
        id: 'u_bad',
        sleeves: [
          { providerId: 'mysterydata', symbols: ['AAPL', 'MSFT'] },
        ],
      }),
    ).toThrow(/resolved to zero MarketIds/);

    // The bad universe must NOT have been written.
    const row = db
      .prepare('SELECT 1 AS one FROM nona_universe WHERE id = ?')
      .get('u_bad');
    expect(row).toBeUndefined();
  });

  it('(c) refuses fail-fast when sleeves[] is empty', () => {
    expect(() =>
      svc.persist({ id: 'u_empty', sleeves: [] }),
    ).toThrow(/no sleeves/);
  });

  it('(c) refuses fail-fast when a sleeve has invalid providerId', () => {
    expect(() =>
      svc.persist({
        id: 'u_bad_pid',
        sleeves: [{ providerId: '', symbols: ['AAPL'] }],
      }),
    ).toThrow(/invalid providerId/);
  });

  it('(c) refuses fail-fast when a sleeve has empty symbols', () => {
    expect(() =>
      svc.persist({
        id: 'u_bad_syms',
        sleeves: [{ providerId: 'alpaca', symbols: [] }],
      }),
    ).toThrow(/empty symbol list/);
  });

  it('(c) refuses fail-fast when id is empty', () => {
    expect(() =>
      svc.persist({ id: '   ', sleeves: [{ providerId: 'alpaca', symbols: ['AAPL'] }] }),
    ).toThrow(/id is required/);
  });

  // -------------------------------------------------------------------------
  // (d) Backfill rule #2 union == TICKET_927_1_2_A forward-write scope.
  // -------------------------------------------------------------------------
  it('(d) sleeves[*].marketIds union equals the MarketScope persistSignal() would derive from the same sleeves', () => {
    const sleeves = [
      { providerId: 'alpaca', symbols: ['AAPL', 'MSFT'] },
      { providerId: 'ccxt', symbols: ['BTC/USDT'] },
      { providerId: 'yfinance', symbols: ['EURUSD=X'] },
    ];

    // Forward path -- the same resolver call deriveMarketScope() makes in
    // discovery-persistence.ts:2949-2998 (TICKET_927_1_2_A).
    const forwardAccumulated = new Set<string>();
    for (const sleeve of sleeves) {
      const s = staticInstrumentRegistry.marketsOfSymbolList(sleeve.symbols, sleeve.providerId);
      for (const m of s) forwardAccumulated.add(m);
    }
    const forwardScope = MarketScope.from(
      Array.from(forwardAccumulated).sort() as any,
    );

    // Backfill-rule-#2 path -- persist sleeves, then union over the
    // PERSISTED marketIds (what scripts/backfill_market_scope.py
    // _try_rule_2_universe_sleeves reads).
    const persisted = svc.persist({ id: 'u_d', sleeves });
    const rule2Union = new Set<string>();
    for (const sleeve of persisted.marketSleeves) {
      for (const m of sleeve.marketIds) rule2Union.add(m);
    }
    const rule2Scope = MarketScope.from(
      Array.from(rule2Union).sort() as any,
    );

    // The on-the-wire JSON shapes must be byte-identical -- that is what
    // the consumer reads. .equals() is the value-class equality test.
    expect(rule2Scope.equals(forwardScope)).toBe(true);
    expect(rule2Scope.toJson()).toBe(forwardScope.toJson());
    expect(rule2Scope.toJson()).toBe(
      '["alpaca_us_equity","ccxt_spot","yfinance_forex"]',
    );
  });

  // -------------------------------------------------------------------------
  // Reproducibility (ticket section 5 Q3): re-persisting the SAME
  // construction inputs in DIFFERENT input order yields a byte-identical
  // market_sleeves JSON payload.
  // -------------------------------------------------------------------------
  it('canonical-form invariance: input-order permutations produce identical market_sleeves JSON', () => {
    const a = svc.persist({
      id: 'u_repro_a',
      sleeves: [
        { providerId: 'yfinance', symbols: ['EURUSD=X'] },
        { providerId: 'alpaca', symbols: ['MSFT', 'AAPL'] },
      ],
    });
    const b = svc.persist({
      id: 'u_repro_b',
      sleeves: [
        { providerId: 'alpaca', symbols: ['AAPL', 'MSFT'] },
        { providerId: 'yfinance', symbols: ['EURUSD=X'] },
      ],
    });
    const aRow = db.prepare('SELECT market_sleeves FROM nona_universe WHERE id = ?').get('u_repro_a') as { market_sleeves: string };
    const bRow = db.prepare('SELECT market_sleeves FROM nona_universe WHERE id = ?').get('u_repro_b') as { market_sleeves: string };
    expect(aRow.market_sleeves).toBe(bRow.market_sleeves);
    // Plus the in-memory return shapes also match.
    expect(a.marketSleeves).toEqual(b.marketSleeves);
  });
});

describe('TICKET_927_1_2_B NonaUniverseService.get', () => {
  let db: BetterSqlite3Database;
  let svc: NonaUniverseService;

  beforeEach(() => {
    db = createInMemoryDb();
    svc = new NonaUniverseService(asDbManager(db));
  });

  afterEach(() => {
    db.close();
  });

  it('round-trips a persisted universe', () => {
    const written = svc.persist({
      id: 'u_get',
      sleeves: [{ providerId: 'alpaca', symbols: ['AAPL', 'MSFT'] }],
    });
    const read = svc.get('u_get');
    expect(read).not.toBeNull();
    expect(read!.id).toBe('u_get');
    expect(read!.name).toBe('u_get');
    expect(read!.marketSleeves).toEqual(written.marketSleeves);
    expect(read!.symbols).toEqual(written.symbols);
  });

  it('returns null for an unknown id', () => {
    expect(svc.get('u_nope')).toBeNull();
  });
});
