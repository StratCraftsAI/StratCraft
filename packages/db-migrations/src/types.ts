/**
 * Shared migration engine contracts (TICKET_1289_1 F1).
 *
 * The migration engine + the EMBEDDED_MIGRATIONS array are the single source of
 * truth for the SQLite schema. Both hosts -- Electron main and the standalone
 * MCP server -- drive the SAME array through the SAME apply loop so version skew
 * between them is structurally impossible.
 *
 * Two seams keep the engine host-agnostic:
 *
 *  1. `MigrationDb` -- the minimal better-sqlite3-shaped handle the engine and
 *     the function-form migration bodies call (`exec` / `prepare` /
 *     `transaction`). Electron's `DatabaseManager` already implements this
 *     surface verbatim; the standalone wraps its raw better-sqlite3 connection
 *     in a tiny adapter. NOTE: the engine deliberately does NOT import
 *     better-sqlite3 -- it only ever touches this interface, so the package
 *     carries no native dependency.
 *
 *  2. `MigrationHost` -- the app-specific bindings a handful of migration bodies
 *     reference as free identifiers (`dbLog`, `getEvalParquetRoot`,
 *     `computePackageCalendarRatios`, `DATA_QUALITY_EVENT_TABLE_DDL`). Each host
 *     supplies its own implementation. This lets the 127 migration bodies stay
 *     VERBATIM after the move -- they keep referencing the same identifier
 *     names, which now resolve to host-backed delegators (see host.ts).
 */

/**
 * A prepared statement, matching the subset of the better-sqlite3
 * `Statement` surface that migration bodies and the engine use. Kept
 * structurally compatible with `better-sqlite3`'s `Statement` so a real
 * statement satisfies it with no adapter.
 */
export interface MigrationStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/**
 * The minimal database handle the migration engine and the function-form
 * migration bodies operate on. Electron's `DatabaseManager` implements this
 * exact surface; the standalone constructs an adapter over its raw
 * better-sqlite3 connection (see the `MigrationDbAdapter` in the standalone).
 */
export interface MigrationDb {
  /** Execute one or more DDL/DML statements (no result set). */
  exec(sql: string): unknown;
  /** Prepare a statement for parameterized run/get/all. */
  prepare(sql: string): MigrationStatement;
  /**
   * Wrap `fn` in a better-sqlite3 transaction, returning a callable that runs
   * it atomically. Matches better-sqlite3's `db.transaction()` semantics (the
   * whole pending batch runs inside ONE outer transaction -- see migrate()).
   */
  transaction<T>(fn: () => T): () => T;
  /**
   * Wrap `fn` in a better-sqlite3 IMMEDIATE transaction (`BEGIN IMMEDIATE`),
   * returning a callable that runs it atomically. Unlike the default DEFERRED
   * transaction, this acquires the RESERVED write lock up front, so two
   * processes racing a fresh DB are serialized at BEGIN rather than colliding
   * on first write (TICKET_1289_1 AC7). Maps to
   * `betterSqlite.transaction(fn).immediate`.
   */
  transactionImmediate<T>(fn: () => T): () => T;
  /**
   * Run a SQLite `PRAGMA`. Used by the engine to set `busy_timeout` so the
   * loser of a concurrent first-start WAITS for the RESERVED lock instead of
   * failing `SQLITE_BUSY` (AC7). Return value is ignored by the engine.
   */
  pragma(source: string): unknown;
}

/**
 * A single schema migration. `up` may be a SQL string or an imperative
 * function; the function form receives the `MigrationDb` handle and runs inside
 * the same outer transaction as the rest of the migrate() batch.
 *
 * NOTE: the `up`/`preflight`/`postCommit` function signatures intentionally use
 * `MigrationDb` -- Electron's `DatabaseManager` is assignable to it, so the
 * ~33 function-form bodies keep their exact `(db) => void` contract with zero
 * edits. (TICKET_773 up-as-function, TICKET_762 preflight, TICKET_947_3
 * postCommit.)
 */
export interface Migration {
  version: number;
  name: string;
  up: string | ((db: MigrationDb) => void);
  down: string;
  preflight?: (db: MigrationDb) => void;
  postCommit?: (db: MigrationDb) => void;
}

/**
 * Minimal logger surface the migration bodies use (`info` / `warn` / `error`).
 * Electron passes its `dbLog` (electron-log); the standalone passes a
 * console-backed logger. Kept to the three levels the bodies actually call.
 */
export interface MigrationLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * A calendar-padding ratio row, as consumed by `computePackageCalendarRatios`.
 * The shape is host-owned; the engine only forwards it.
 */
export interface CalendarRatioFileRow {
  interval: string;
  firstTimestamp: number;
  lastTimestamp: number;
  rowCount: number;
}

/**
 * Host-specific bindings the migration bodies reference as free identifiers.
 * Supplied once per process via `setMigrationHost()` before `migrate()` runs.
 */
export interface MigrationHost {
  /** Logger the migration bodies call as `dbLog.info/warn/error`. */
  log: MigrationLogger;
  /**
   * Resolve the on-disk root of the per-signal eval parquet store. Used by the
   * v96 preflight to verify parquet partitions exist before dropping the
   * SQLite eval tables. Electron reads its data-root; the standalone re-derives
   * the same path from the shared data-root contract.
   */
  getEvalParquetRoot(): string;
  /**
   * Compute calendar-padding ratios for an imported package's files (v-imported
   * -packages backfill). Host-owned so the (light) calendar math is not
   * duplicated.
   */
  computePackageCalendarRatios(files: CalendarRatioFileRow[]): unknown;
  /**
   * DDL for the `data_quality_event` quarantine/audit ledger (v112). A static
   * string owned by the data-quality constants module (TICKET_854, 6+
   * importers) -- injected rather than moved so those importers are untouched.
   */
  dataQualityEventTableDdl: string;
}
