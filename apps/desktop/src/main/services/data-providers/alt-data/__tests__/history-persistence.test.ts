/**
 * Alt-Data History Persistence Tests
 *
 * TICKET_196_7_7 P4.1 step (b): verify the registration-time wrapper and the
 * `INSERT OR IGNORE` write path against an in-memory SQLite DB carrying the
 * v52 `alt_data_history` schema. Tests focus on:
 *   * `wrapProviderWithHistoryPersistence` proxy semantics (identity fields,
 *     `fetchFactorData` pass-through, `startLiveStream` onRow interception,
 *     no-op for providers without live streaming).
 *   * `persistAltDataRow` write semantics (vintage default sentinel,
 *     INSERT OR IGNORE duplicate suppression, ALFRED multi-vintage retention,
 *     error isolation when the DB throws on prepare/run).
 *   * Lazy DB resolution (no crash when the DB is not yet initialised; the
 *     row is dropped and the live stream continues).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import type {
  AlternativeDataRequest,
  AlternativeFactorRow,
} from '../../../../../shared/types/signal-discovery';
import type { IAlternativeDataProvider } from '../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getAppPath: () => '/tmp' },
  safeStorage: { isEncryptionAvailable: () => false },
}));

// The db-manager mock returns whatever `currentDb` points to at the moment
// the module under test calls `getDatabaseManager().getDb()`. Each test
// assigns `currentDb` BEFORE importing or invoking the module so the lazy
// resolver picks up the right handle.
let currentDb: BetterSqlite3Database | null = null;
let getDatabaseManagerThrows = false;

// Path is relative to the module under test (../history-persistence), NOT
// the test file. The persistence module sits at .../alt-data/, so its import
// `../../../database/db-manager` resolves to .../main/database/db-manager.
// Vitest's vi.mock() matches module identity by resolved path, so this mock
// MUST use the same string the module under test uses.
vi.mock('../../../../database/db-manager', () => ({
  getDatabaseManager: () => {
    if (getDatabaseManagerThrows) {
      throw new Error('[test] db-manager not initialised');
    }
    return {
      getDb: () => currentDb,
    };
  },
}));

vi.mock('../../../../utils/logger', () => ({
  appLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createInMemoryDbWithSchema(): BetterSqlite3Database {
  const db = new Database(':memory:');
  // Mirror migration v52 exactly. Schema-shape regressions are caught by the
  // migration-manager.test.ts suite; here we just need a place to write rows.
  db.exec(`
    CREATE TABLE alt_data_history (
      provider_id    TEXT    NOT NULL,
      series_id      TEXT    NOT NULL,
      category       TEXT    NOT NULL,
      symbol         TEXT,
      event_time     TEXT    NOT NULL,
      knowledge_time TEXT    NOT NULL,
      value          REAL    NOT NULL,
      vintage_id     TEXT    NOT NULL DEFAULT '',
      captured_at    INTEGER NOT NULL,
      PRIMARY KEY (provider_id, series_id, event_time, knowledge_time, vintage_id)
    );
  `);
  return db;
}

function sampleRow(overrides: Partial<AlternativeFactorRow> = {}): AlternativeFactorRow {
  return {
    category: 'macro',
    factor_name: 'DGS10',
    event_time: '2026-05-01',
    knowledge_time: '2026-05-02T08:30:00Z',
    value: 4.25,
    source_provider: 'fred',
    ...overrides,
  };
}

function makeFakeProvider(opts: {
  withLiveStream: boolean;
  rowsToEmit?: AlternativeFactorRow[];
}): IAlternativeDataProvider {
  const fetchFactorData = vi.fn(async (_p: AlternativeDataRequest) => opts.rowsToEmit ?? []);
  const provider: IAlternativeDataProvider = {
    id: 'fake',
    name: 'Fake Provider',
    source: 'macro',
    vintage_supported: false,
    live_streaming_supported: opts.withLiveStream,
    fetchFactorData,
  };
  if (opts.withLiveStream) {
    provider.startLiveStream = vi.fn(
      (
        _params: AlternativeDataRequest,
        onRow: (row: AlternativeFactorRow) => void,
        _onError: (err: Error) => void,
      ) => {
        for (const row of opts.rowsToEmit ?? []) onRow(row);
        return () => {};
      },
    );
  }
  return provider;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('persistAltDataRow', () => {
  let persistAltDataRow: typeof import('../history-persistence').persistAltDataRow;
  let _resetCache: typeof import('../history-persistence')._resetAltDataHistoryCacheForTests;

  beforeEach(async () => {
    currentDb = createInMemoryDbWithSchema();
    getDatabaseManagerThrows = false;
    vi.resetModules();
    const mod = await import('../history-persistence');
    persistAltDataRow = mod.persistAltDataRow;
    _resetCache = mod._resetAltDataHistoryCacheForTests;
    _resetCache();
  });

  afterEach(() => {
    if (currentDb) currentDb.close();
    currentDb = null;
  });

  it('writes a row with the expected column values and an empty-string vintage sentinel', () => {
    const wrote = persistAltDataRow(sampleRow());
    expect(wrote).toBe(true);

    const row = currentDb!
      .prepare('SELECT * FROM alt_data_history WHERE provider_id = ? AND series_id = ?')
      .get('fred', 'DGS10') as Record<string, unknown>;
    expect(row.value).toBe(4.25);
    expect(row.event_time).toBe('2026-05-01');
    expect(row.knowledge_time).toBe('2026-05-02T08:30:00Z');
    expect(row.vintage_id).toBe('');
    expect(row.symbol).toBeNull();
    expect(typeof row.captured_at).toBe('number');
  });

  it('returns false (silent dedup) on a duplicate INSERT without vintage', () => {
    expect(persistAltDataRow(sampleRow())).toBe(true);
    // INSERT OR IGNORE: same PK -> no row written, no throw.
    expect(persistAltDataRow(sampleRow({ value: 4.30 }))).toBe(false);
    const { n } = currentDb!
      .prepare('SELECT COUNT(*) AS n FROM alt_data_history')
      .get() as { n: number };
    expect(n).toBe(1);
    // Original value preserved -- IGNORE means "first write wins", not "last write wins".
    const row = currentDb!
      .prepare('SELECT value FROM alt_data_history')
      .get() as { value: number };
    expect(row.value).toBe(4.25);
  });

  it('accepts two ALFRED vintages for the same (event_time, knowledge_time) pair', () => {
    const base = sampleRow({
      factor_name: 'GDPC1',
      event_time: '2026-03-31',
      knowledge_time: '2026-04-29T12:30:00Z',
    });
    expect(persistAltDataRow({ ...base, value: 21500.0, vintage_id: '2026-04-29' })).toBe(true);
    expect(persistAltDataRow({ ...base, value: 21512.3, vintage_id: '2026-05-30' })).toBe(true);

    const rows = currentDb!
      .prepare(
        `SELECT vintage_id, value FROM alt_data_history
         WHERE provider_id = 'fred' AND series_id = 'GDPC1' ORDER BY vintage_id`,
      )
      .all() as Array<{ vintage_id: string; value: number }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ vintage_id: '2026-04-29', value: 21500.0 });
    expect(rows[1].vintage_id).toBe('2026-05-30');
    expect(rows[1].value).toBeCloseTo(21512.3, 4);
  });

  it('persists symbol when present (non-macro categories)', () => {
    persistAltDataRow(
      sampleRow({
        category: 'on_chain',
        factor_name: 'funding_rate_z',
        source_provider: 'binance-funding',
        symbol: 'BTC/USDT',
      }),
    );
    const row = currentDb!
      .prepare('SELECT symbol FROM alt_data_history')
      .get() as { symbol: string };
    expect(row.symbol).toBe('BTC/USDT');
  });

  it('returns false without throwing when the DB resolver throws (DB not initialised)', () => {
    // Simulate bootstrap order where alt-data providers register before
    // the database is ready.
    getDatabaseManagerThrows = true;
    _resetCache();
    expect(() => persistAltDataRow(sampleRow())).not.toThrow();
    expect(persistAltDataRow(sampleRow())).toBe(false);
  });

  it('returns false without throwing when prepare() itself throws (e.g. schema drift)', () => {
    // Close the DB and re-resolve to surface a runtime prepare failure.
    currentDb!.close();
    // The cached handle still points at the closed DB; resolveDb() will
    // return the closed handle and prepare() will throw.
    expect(() => persistAltDataRow(sampleRow())).not.toThrow();
    expect(persistAltDataRow(sampleRow())).toBe(false);
  });
});

describe('wrapProviderWithHistoryPersistence', () => {
  let wrapProviderWithHistoryPersistence: typeof import('../history-persistence').wrapProviderWithHistoryPersistence;
  let _resetCache: typeof import('../history-persistence')._resetAltDataHistoryCacheForTests;

  beforeEach(async () => {
    currentDb = createInMemoryDbWithSchema();
    getDatabaseManagerThrows = false;
    vi.resetModules();
    const mod = await import('../history-persistence');
    wrapProviderWithHistoryPersistence = mod.wrapProviderWithHistoryPersistence;
    _resetCache = mod._resetAltDataHistoryCacheForTests;
    _resetCache();
  });

  afterEach(() => {
    if (currentDb) currentDb.close();
    currentDb = null;
  });

  it('preserves identity fields (id, name, source, capability flags)', () => {
    const inner = makeFakeProvider({ withLiveStream: true });
    const wrapped = wrapProviderWithHistoryPersistence(inner);
    expect(wrapped.id).toBe(inner.id);
    expect(wrapped.name).toBe(inner.name);
    expect(wrapped.source).toBe(inner.source);
    expect(wrapped.vintage_supported).toBe(inner.vintage_supported);
    expect(wrapped.live_streaming_supported).toBe(inner.live_streaming_supported);
  });

  it('passes fetchFactorData through unchanged (no persistence side-effect on historical fetch)', async () => {
    const rows = [sampleRow()];
    const inner = makeFakeProvider({ withLiveStream: true, rowsToEmit: rows });
    const wrapped = wrapProviderWithHistoryPersistence(inner);

    const out = await wrapped.fetchFactorData({
      category: 'macro',
      factor_name: 'DGS10',
      start_time: '2026-01-01T00:00:00Z',
      end_time: '2026-12-31T23:59:59Z',
    });
    expect(out).toEqual(rows);

    // Historical fetch is NOT a live-stream event; nothing should land in
    // alt_data_history just because the user called fetchFactorData().
    const { n } = currentDb!
      .prepare('SELECT COUNT(*) AS n FROM alt_data_history')
      .get() as { n: number };
    expect(n).toBe(0);
  });

  it('intercepts startLiveStream().onRow and persists every emitted row', () => {
    const emitted = [
      sampleRow({ event_time: '2026-05-01', knowledge_time: '2026-05-02T08:30:00Z' }),
      sampleRow({ event_time: '2026-06-01', knowledge_time: '2026-06-02T08:30:00Z', value: 4.40 }),
    ];
    const inner = makeFakeProvider({ withLiveStream: true, rowsToEmit: emitted });
    const wrapped = wrapProviderWithHistoryPersistence(inner);

    const observed: AlternativeFactorRow[] = [];
    const stop = wrapped.startLiveStream!(
      {
        category: 'macro',
        factor_name: 'DGS10',
        start_time: '2026-01-01T00:00:00Z',
        end_time: '2026-12-31T23:59:59Z',
      },
      (row) => observed.push(row),
      () => {},
    );
    stop();

    // User callback still fires for every row (persistence does not eat the event).
    expect(observed).toEqual(emitted);

    const rows = currentDb!
      .prepare('SELECT event_time, value FROM alt_data_history ORDER BY event_time')
      .all() as Array<{ event_time: string; value: number }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].event_time).toBe('2026-05-01');
    expect(rows[1].value).toBe(4.40);
  });

  it('still invokes user onRow when the DB write fails (error isolation)', () => {
    // Force every persistAltDataRow call to fail by destroying the schema.
    currentDb!.exec('DROP TABLE alt_data_history;');

    const inner = makeFakeProvider({
      withLiveStream: true,
      rowsToEmit: [sampleRow()],
    });
    const wrapped = wrapProviderWithHistoryPersistence(inner);

    const observed: AlternativeFactorRow[] = [];
    expect(() =>
      wrapped.startLiveStream!(
        {
          category: 'macro',
          factor_name: 'DGS10',
          start_time: '2026-01-01T00:00:00Z',
          end_time: '2026-12-31T23:59:59Z',
        },
        (row) => observed.push(row),
        () => {},
      )(),
    ).not.toThrow();
    // Persistence silently failed, but the downstream consumer (stdin bridge,
    // renderer event) still saw the row.
    expect(observed).toHaveLength(1);
  });

  it('returns the original provider unchanged when live_streaming is not supported', () => {
    const inner = makeFakeProvider({ withLiveStream: false });
    const wrapped = wrapProviderWithHistoryPersistence(inner);
    // No proxy created -- the same object identity passes through. This
    // matters because the wrapper has nothing to wrap for non-live providers,
    // and returning the original object keeps the bootstrap log line accurate.
    expect(wrapped).toBe(inner);
  });
});
