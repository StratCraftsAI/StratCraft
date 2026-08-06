/**
 * MigrationManager Unit Tests
 *
 * TICKET_424_1D: Tests for migration execution, version tracking, idempotency,
 * rollback, and transaction atomicity.
 *
 * Uses real in-memory SQLite (same pattern as db-manager.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseManager, resetDatabaseManager } from '../db-manager';
import {
  MigrationManager,
  EMBEDDED_MIGRATIONS_FOR_TEST,
  installElectronMigrationHost,
} from '../migrations/migration-manager';

const LATEST_SCHEMA_VERSION = Math.max(
  ...EMBEDDED_MIGRATIONS_FOR_TEST.map(m => m.version),
);
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => path.join(__dirname, '..'),
    getPath: () => os.tmpdir(),
    isPackaged: false,
  },
}));

describe('MigrationManager', () => {
  let db: DatabaseManager;
  let testDbPath: string;

  beforeEach(async () => {
    await installElectronMigrationHost();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'StratCraft-migration-test-'));
    testDbPath = path.join(tempDir, 'test.db');
    resetDatabaseManager();
    db = new DatabaseManager({ filename: testDbPath });
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    resetDatabaseManager();
  });

  describe('migrate', () => {
    it('should run all embedded migrations successfully', async () => {
      const manager = new MigrationManager(db);
      await expect(manager.migrate()).resolves.toBeUndefined();
    });

    it('should be idempotent - running twice does not error', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();
      await expect(manager.migrate()).resolves.toBeUndefined();
    });

    it('should create schema_version table and track versions', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      const stmt = db.prepare('SELECT MAX(version) as version FROM schema_version');
      const result = stmt.get() as { version: number };
      expect(result.version).toBeGreaterThanOrEqual(29);
    });

    it('should create key tables from migrations', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      ).all() as Array<{ name: string }>;

      const tableNames = tables.map(t => t.name);
      expect(tableNames).toContain('nona_algorithms');
      expect(tableNames).toContain('nona_factors');
      expect(tableNames).toContain('desktop_backtest_results');
      expect(tableNames).toContain('saved_strategies');
      expect(tableNames).toContain('saved_strategy_components');
      expect(tableNames).toContain('alpha_factory_config');
      expect(tableNames).toContain('desktop_backtest_task_history');
      expect(tableNames).toContain('data_cache_files');
      expect(tableNames).toContain('download_queue');
      expect(tableNames).toContain('imported_packages');
    });
  });

  // TICKET_308_1 (Phase 2): imported_packages catalog table. The only new table
  // the BYOD import introduces; home for the package-level adjustment decision
  // (the adjustment-has-no-home open question) and package provenance. PK
  // package_name is the join key into data_cache_files.provider.
  describe('TICKET_308_1: imported_packages table', () => {
    interface ColumnInfo {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }

    it('creates imported_packages with package_name PK and NOT NULL columns', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      const cols = db
        .prepare('PRAGMA table_info(imported_packages)')
        .all() as ColumnInfo[];
      const byName = new Map(cols.map(c => [c.name, c]));

      expect([...byName.keys()].sort()).toEqual(
        [
          'adjust_mode',
          'archival_cadence',
          'asset_class',
          'calendar_padding_ratio_json',
          'created_at',
          'package_name',
          'source_dialect',
        ].sort()
      );
      // package_name is the sole primary key (the catalog join key).
      expect(byName.get('package_name')?.pk).toBe(1);
      expect(byName.get('package_name')?.notnull).toBe(1);
      expect(byName.get('adjust_mode')?.notnull).toBe(1);
      expect(byName.get('source_dialect')?.notnull).toBe(1);
      expect(byName.get('created_at')?.notnull).toBe(1);
    });

    it('enforces adjust_mode CHECK to none/qfq/hfq', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      const insert = (mode: string) =>
        db
          .prepare(
            `INSERT INTO imported_packages (package_name, adjust_mode, source_dialect)
             VALUES (?, ?, 'mysql')`
          )
          .run(`pkg_${mode}`, mode);

      for (const ok of ['none', 'qfq', 'hfq']) {
        expect(() => insert(ok)).not.toThrow();
      }
      // hfq-typo / unadjusted alias / empty all rejected by the CHECK.
      expect(() => insert('hfqq')).toThrow();
      expect(() => insert('unadjusted')).toThrow();
      expect(() => insert('')).toThrow();
    });

    it('enforces source_dialect CHECK to the supported DuckDB ATTACH dialects', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      const insert = (dialect: string) =>
        db
          .prepare(
            `INSERT INTO imported_packages (package_name, adjust_mode, source_dialect)
             VALUES (?, 'hfq', ?)`
          )
          .run(`pkg_${dialect}`, dialect);

      for (const ok of ['mysql', 'sqlite', 'postgres', 'duckdb']) {
        expect(() => insert(ok)).not.toThrow();
      }
      expect(() => insert('oracle')).toThrow();
    });

    it('rejects a duplicate package_name (PK uniqueness)', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      db.prepare(
        `INSERT INTO imported_packages (package_name, adjust_mode, source_dialect)
         VALUES ('cn_a_share_2026', 'hfq', 'mysql')`
      ).run();
      expect(() =>
        db
          .prepare(
            `INSERT INTO imported_packages (package_name, adjust_mode, source_dialect)
             VALUES ('cn_a_share_2026', 'qfq', 'sqlite')`
          )
          .run()
      ).toThrow();
    });

    it('defaults created_at to a positive epoch-millisecond integer', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      db.prepare(
        `INSERT INTO imported_packages (package_name, adjust_mode, source_dialect)
         VALUES ('pkg_ts', 'none', 'postgres')`
      ).run();
      const row = db
        .prepare('SELECT created_at FROM imported_packages WHERE package_name = ?')
        .get('pkg_ts') as { created_at: number };
      expect(Number.isInteger(row.created_at)).toBe(true);
      // epoch milliseconds -> well past the year-2001 second-count boundary.
      expect(row.created_at).toBeGreaterThan(1_000_000_000_000);
    });
  });

  // TICKET_762 Step 1: nona_signal mirrors nona_algorithms schema exactly.
  // The whole point of the split is that both pools share identical shape,
  // so AlgorithmService can be reused verbatim. If a future ALTER lands on
  // nona_algorithms without a matching ALTER on nona_signal, this test fails.
  describe('TICKET_762: nona_signal table', () => {
    interface ColumnInfo {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }

    function getColumns(table: string): ColumnInfo[] {
      return db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
    }

    function getIndexNames(table: string): string[] {
      const rows = db
        .prepare(`PRAGMA index_list(${table})`)
        .all() as Array<{ name: string }>;
      return rows.map(r => r.name).sort();
    }

    it('creates nona_signal table after migration', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='nona_signal'")
        .all() as Array<{ name: string }>;
      expect(tables).toHaveLength(1);
    });

    it('keeps nona_algorithms mirror columns and allows signal-only extensions', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      const algoCols = getColumns('nona_algorithms');
      const signalCols = getColumns('nona_signal');
      const signalByName = new Map(signalCols.map(c => [c.name, c]));

      const normalize = (c: ColumnInfo) => ({
        name: c.name,
        type: c.type,
        notnull: c.notnull,
        dflt_value: c.dflt_value,
        pk: c.pk,
      });

      for (const algoCol of algoCols) {
        expect(normalize(signalByName.get(algoCol.name)!)).toEqual(normalize(algoCol));
      }
      expect(signalByName.has('bar_interval')).toBe(true);
    });

    it('mirrors nona_algorithms indexes with idx_nona_signal_ prefix', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      const algoIndexes = getIndexNames('nona_algorithms')
        .map(n => n.replace(/^idx_nona_algorithms_/, '').replace(/^idx_algorithms_/, ''))
        .sort();
      const signalIndexes = getIndexNames('nona_signal')
        .map(n => n.replace(/^idx_nona_signal_/, ''))
        .sort();

      expect(signalIndexes).toEqual(expect.arrayContaining(algoIndexes));
    });

    it('enforces unique (strategy_name, user_id) on nona_signal', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      db.prepare(
        "INSERT INTO nona_signal (code, strategy_name, user_id) VALUES ('// a', 'sig1', 'u1')"
      ).run();

      expect(() =>
        db
          .prepare(
            "INSERT INTO nona_signal (code, strategy_name, user_id) VALUES ('// b', 'sig1', 'u1')"
          )
          .run()
      ).toThrow(/UNIQUE/i);
    });

    it('starts empty (no data move in Step 1)', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      const { count } = db
        .prepare('SELECT COUNT(*) AS count FROM nona_signal')
        .get() as { count: number };
      expect(count).toBe(0);
    });
  });

  // TICKET_762 Steps 5-7: sibling tables, views, and discovery backfill.
  // Schema half always runs and is idempotent. Backfill half is a no-op on
  // databases with zero discovery rows; with seeded rows it moves parents +
  // matching strategy_audit children inside the migrate() outer transaction.
  describe('TICKET_762: sibling tables, views, and backfill (v42)', () => {
    it('creates strategy_runs_signal and strategy_audit_signal tables', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('strategy_runs_signal', 'strategy_audit_signal') ORDER BY name`)
        .all() as Array<{ name: string }>;
      expect(tables.map(t => t.name)).toEqual(['strategy_audit_signal', 'strategy_runs_signal']);
    });

    it('creates v_strategy_audit_all and v_algorithms_all views', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      const views = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='view' AND name IN ('v_strategy_audit_all', 'v_algorithms_all') ORDER BY name`)
        .all() as Array<{ name: string }>;
      expect(views.map(v => v.name)).toEqual(['v_algorithms_all', 'v_strategy_audit_all']);
    });

    it('strategy_audit_signal FK to nona_signal cascades on parent delete', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      // Enable FK enforcement (db-manager sets this by default but be explicit).
      db.prepare('PRAGMA foreign_keys = ON').run();

      db.prepare(
        `INSERT INTO nona_signal (id, code, strategy_name, user_id) VALUES (9001, '// a', 'sigA', 'u1')`
      ).run();
      db.prepare(
        `INSERT INTO strategy_audit_signal (
          algorithm_id, signal_source, llm_provider, llm_model,
          d1_completeness, d2_similarity, d3_indicator_fit, d4_code_quality, d5_robustness,
          overall_score, star_rating, code_hash, ast_fingerprint
        ) VALUES (9001, 'signal_discovery', 'CLAUDE', 'm', 1, 1, 1, 1, 1, 5, 5, 'h', 'a')`
      ).run();

      db.prepare('DELETE FROM nona_signal WHERE id = 9001').run();

      const { n } = db
        .prepare('SELECT COUNT(*) AS n FROM strategy_audit_signal WHERE algorithm_id = 9001')
        .get() as { n: number };
      expect(n).toBe(0);
    });

    it('backfill is a no-op on a fresh database (no discovery rows)', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      const { algo } = db
        .prepare(`SELECT COUNT(*) AS algo FROM nona_algorithms`)
        .get() as { algo: number };
      const { sig } = db
        .prepare(`SELECT COUNT(*) AS sig FROM nona_signal`)
        .get() as { sig: number };
      expect(algo).toBe(0);
      expect(sig).toBe(0);
    });

    it('backfill moves discovery rows + audit children preserving ids', async () => {
      // Apply schema only up to v41 (nona_signal table exists but v42 not yet
      // applied), seed discovery rows + audit, then run v42 alone.
      //
      // Easier path: run all migrations, then simulate "pre-cutover state"
      // by inserting discovery rows back into nona_algorithms and re-running
      // a fresh manager on a SECOND in-memory db with manual SQL stop-at-v41
      // is complex. Instead, we exercise the data move by directly executing
      // the same backfill SQL against a hand-seeded state.
      const manager = new MigrationManager(db);
      await manager.migrate();

      // Seed: discovery row in nona_algorithms + matching audit row.
      db.prepare(
        `INSERT INTO nona_algorithms (id, code, strategy_name, user_id, record_type, classification_metadata)
         VALUES (5001, '// disc', 'DiscSignal', 'u1', 'indicator',
                 '{"signal_source":"signal_discovery","discovery_category":"mean_reversion"}')`
      ).run();
      db.prepare(
        `INSERT INTO strategy_audit (
          algorithm_id, signal_source, llm_provider, llm_model,
          d1_completeness, d2_similarity, d3_indicator_fit, d4_code_quality, d5_robustness,
          overall_score, star_rating, code_hash, ast_fingerprint
        ) VALUES (5001, 'signal_discovery', 'CLAUDE', 'm', 1, 1, 1, 1, 1, 5, 5, 'h', 'a')`
      ).run();

      // Re-run the v42 backfill body (idempotent INSERT ... SELECT + DELETE).
      db.exec(`
        INSERT INTO nona_signal (
          id, code, file_path, strategy_name, description, strategy_type,
          classification_metadata, record_type, category, metadata, pnl, user_id,
          is_system, status, activate, create_time, update_time, sync_status,
          last_sync_time, local_only, strategy_rules, prompt_template, version,
          deleted_at, compile_status, compile_error, compile_hash,
          compile_artifact_path, compiled_at, audit_status, backend_validation_report
        )
        SELECT
          id, code, file_path, strategy_name, description, strategy_type,
          classification_metadata, record_type, category, metadata, pnl, user_id,
          is_system, status, activate, create_time, update_time, sync_status,
          last_sync_time, local_only, strategy_rules, prompt_template, version,
          deleted_at, compile_status, compile_error, compile_hash,
          compile_artifact_path, compiled_at, audit_status, backend_validation_report
        FROM nona_algorithms
        WHERE record_type = 'indicator'
          AND json_extract(classification_metadata, '$.signal_source') = 'signal_discovery';

        INSERT INTO strategy_audit_signal (
          algorithm_id, signal_source, regime, llm_provider, llm_model,
          d1_completeness, d2_similarity, d3_indicator_fit, d4_code_quality, d5_robustness,
          overall_score, star_rating, audit_detail, code_hash, ast_fingerprint, create_time
        )
        SELECT
          sa.algorithm_id, sa.signal_source, sa.regime, sa.llm_provider, sa.llm_model,
          sa.d1_completeness, sa.d2_similarity, sa.d3_indicator_fit, sa.d4_code_quality, sa.d5_robustness,
          sa.overall_score, sa.star_rating, sa.audit_detail, sa.code_hash, sa.ast_fingerprint, sa.create_time
        FROM strategy_audit sa
        WHERE sa.algorithm_id IN (
          SELECT id FROM nona_algorithms
          WHERE record_type = 'indicator'
            AND json_extract(classification_metadata, '$.signal_source') = 'signal_discovery'
        );

        DELETE FROM strategy_audit
        WHERE algorithm_id IN (
          SELECT id FROM nona_algorithms
          WHERE record_type = 'indicator'
            AND json_extract(classification_metadata, '$.signal_source') = 'signal_discovery'
        );

        DELETE FROM nona_algorithms
        WHERE record_type = 'indicator'
          AND json_extract(classification_metadata, '$.signal_source') = 'signal_discovery';
      `);

      // Parent moved with preserved id.
      const sig = db
        .prepare('SELECT id, strategy_name FROM nona_signal WHERE id = 5001')
        .get() as { id: number; strategy_name: string };
      expect(sig).toEqual({ id: 5001, strategy_name: 'DiscSignal' });

      // Audit row moved.
      const audSig = db
        .prepare('SELECT COUNT(*) AS n FROM strategy_audit_signal WHERE algorithm_id = 5001')
        .get() as { n: number };
      expect(audSig.n).toBe(1);

      // Original tables clean.
      const algoLeft = db
        .prepare('SELECT COUNT(*) AS n FROM nona_algorithms WHERE id = 5001')
        .get() as { n: number };
      const audLeft = db
        .prepare('SELECT COUNT(*) AS n FROM strategy_audit WHERE algorithm_id = 5001')
        .get() as { n: number };
      expect(algoLeft.n).toBe(0);
      expect(audLeft.n).toBe(0);

      // v_algorithms_all view surfaces the moved row under parent_kind='signal'.
      const viewRow = db
        .prepare(`SELECT parent_kind FROM v_algorithms_all WHERE id = 5001`)
        .get() as { parent_kind: string } | undefined;
      expect(viewRow?.parent_kind).toBe('signal');
    });
  });

  // TICKET_773: v44 heals databases where v43's slot was applied before commit
  // fcde48ce rewrote it to include snapshot_json. The migration is imperative
  // (Migration.up is now `string | (db) => void`) and idempotent.
  describe('TICKET_773: snapshot_json heal migration (v44)', () => {
    function hasSnapshotJson(): boolean {
      const cols = db
        .prepare(`PRAGMA table_info(desktop_discovery_run_history)`)
        .all() as Array<{ name: string }>;
      return cols.some(c => c.name === 'snapshot_json');
    }

    // Case 1: simulate an affected database where v43 ran under the original
    // pre-fcde48ce definition (no snapshot_json column) and was recorded as
    // applied. v44 must add the missing column.
    it('adds snapshot_json column on databases stuck on pre-fcde48ce v43', async () => {
      // Run all migrations first so the rest of the schema is in place.
      await new MigrationManager(db).migrate();

      // Hand-craft the affected state: drop the healthy table, recreate it
      // with the original 10-column schema (no snapshot_json), and clear
      // v44 from schema_version so the runner re-applies it.
      db.exec(`DROP TABLE IF EXISTS desktop_discovery_run_history`);
      db.exec(`
        CREATE TABLE desktop_discovery_run_history (
          id TEXT PRIMARY KEY,
          timestamp INTEGER NOT NULL,
          status TEXT NOT NULL,
          saturation_level TEXT NOT NULL DEFAULT 'green',
          signal_count INTEGER NOT NULL DEFAULT 0,
          signal_name TEXT,
          config_signal_layer TEXT NOT NULL,
          config_categories_json TEXT,
          config_hypotheses_count INTEGER NOT NULL,
          config_batch_size INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.prepare('DELETE FROM schema_version WHERE version = 44').run();

      expect(hasSnapshotJson()).toBe(false);

      const v44Migration = EMBEDDED_MIGRATIONS_FOR_TEST.find(m => m.version === 44)!;
      if (typeof v44Migration.up === 'function') v44Migration.up(db);
      else db.exec(v44Migration.up);
      db.prepare('INSERT INTO schema_version (version) VALUES (44)').run();

      expect(hasSnapshotJson()).toBe(true);
      const v44 = db
        .prepare('SELECT version FROM schema_version WHERE version = 44')
        .get() as { version: number } | undefined;
      expect(v44?.version).toBe(44);
    });

    // Case 2: healthy database (v43 ran the rewritten definition, column
    // already present). v44 must be a strict no-op -- no error, column
    // unchanged, schema_version records v44.
    it('is a no-op on databases that ran the rewritten v43', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      expect(hasSnapshotJson()).toBe(true);
      const v44Applied = db
        .prepare('SELECT COUNT(*) AS n FROM schema_version WHERE version = 44')
        .get() as { n: number };
      expect(v44Applied.n).toBe(1);

      // Run again to confirm idempotency.
      await new MigrationManager(db).migrate();
      expect(hasSnapshotJson()).toBe(true);
    });

    // Case 4: explicit idempotency check -- running migrate twice in the same
    // process leaves v44 applied exactly once and does not error.
    it('records v44 exactly once after multiple migrate() calls', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();
      await manager.migrate();
      await manager.migrate();

      const rows = db
        .prepare('SELECT COUNT(*) AS n FROM schema_version WHERE version = 44')
        .get() as { n: number };
      expect(rows.n).toBe(1);
    });

    // Case 3 fragment: after heal, an insert with a snapshot_json payload
    // succeeds -- this is what saveRunHistory IPC needs.
    it('allows saveRunHistory-style insert after heal', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      const snapshot = JSON.stringify({ hypothesisTabs: [] });
      db.prepare(
        `INSERT INTO desktop_discovery_run_history (
           id, timestamp, status, saturation_level, signal_count, signal_name,
           config_signal_layer, config_categories_json, config_hypotheses_count,
           config_batch_size, snapshot_json
         ) VALUES (?, ?, 'completed', 'green', 0, 'sig', 'layer1', '[]', 3, 5, ?)`
      ).run('run-test-1', Date.now(), snapshot);

      const row = db
        .prepare('SELECT snapshot_json FROM desktop_discovery_run_history WHERE id = ?')
        .get('run-test-1') as { snapshot_json: string };
      expect(row.snapshot_json).toBe(snapshot);
    });
  });

  // TICKET_783_3 Step B: cached_stats_json column on nona_signal -- the
  // Bayesian prior the Alpha Factory aggregator consumes. The migration is
  // imperative (PRAGMA-guarded ADD COLUMN) and idempotent.
  describe('TICKET_783_3: cached_stats_json migration (v46)', () => {
    function hasCachedStatsColumn(): boolean {
      const cols = db
        .prepare(`PRAGMA table_info(nona_signal)`)
        .all() as Array<{ name: string }>;
      return cols.some(c => c.name === 'cached_stats_json');
    }

    it('adds cached_stats_json column to nona_signal', async () => {
      await new MigrationManager(db).migrate();

      expect(hasCachedStatsColumn()).toBe(true);
      const v46 = db
        .prepare('SELECT version FROM schema_version WHERE version = 46')
        .get() as { version: number } | undefined;
      expect(v46?.version).toBe(46);
    });

    it('defaults cached_stats_json to NULL on existing rows after migration', async () => {
      await new MigrationManager(db).migrate();

      // Insert a nona_signal row without touching cached_stats_json -- it
      // must come back as NULL, not an empty string.
      db.prepare(
        `INSERT INTO nona_signal (code, strategy_name, user_id) VALUES (?, ?, ?)`
      ).run('// code', 'NullPriorSig', 'u1');

      const row = db
        .prepare('SELECT cached_stats_json FROM nona_signal WHERE strategy_name = ?')
        .get('NullPriorSig') as { cached_stats_json: string | null };
      expect(row.cached_stats_json).toBeNull();
    });

    it('allows INSERT with a populated cached_stats_json payload', async () => {
      await new MigrationManager(db).migrate();

      const payload = JSON.stringify({
        schema_version: 1,
        lifetime_sharpe: 1.42,
        lifetime_n_trades: 87,
        lifetime_n_bars: 1260,
        last_updated_at: '2026-05-17T12:34:56Z',
        source: 'discovery_round_3',
      });
      db.prepare(
        `INSERT INTO nona_signal (code, strategy_name, user_id, cached_stats_json)
         VALUES (?, ?, ?, ?)`
      ).run('// code', 'PriorSig', 'u1', payload);

      const row = db
        .prepare('SELECT cached_stats_json FROM nona_signal WHERE strategy_name = ?')
        .get('PriorSig') as { cached_stats_json: string };
      expect(JSON.parse(row.cached_stats_json).lifetime_sharpe).toBe(1.42);
    });

    it('is a strict no-op when the column already exists (idempotent re-run)', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();
      // Re-run twice to confirm the imperative `up` does not double-add.
      await manager.migrate();
      await manager.migrate();

      expect(hasCachedStatsColumn()).toBe(true);
      const applied = db
        .prepare('SELECT COUNT(*) AS n FROM schema_version WHERE version = 46')
        .get() as { n: number };
      expect(applied.n).toBe(1);
    });
  });

  // TICKET_196_7_0_2 (covered by TICKET_196_7_6_3 S6): artifact_path column on
  // nona_signal so v2 signal-source artifacts (HMM/n-gram/ML/factor) can be
  // located on disk for live-runtime deploy. Same imperative + PRAGMA-guarded
  // pattern as v46 cached_stats_json.
  describe('TICKET_196_7_0_2: artifact_path migration (v51)', () => {
    function hasArtifactPathColumn(): boolean {
      const cols = db
        .prepare(`PRAGMA table_info(nona_signal)`)
        .all() as Array<{ name: string }>;
      return cols.some(c => c.name === 'artifact_path');
    }

    it('adds artifact_path column to nona_signal', async () => {
      await new MigrationManager(db).migrate();

      expect(hasArtifactPathColumn()).toBe(true);
      const v51 = db
        .prepare('SELECT version FROM schema_version WHERE version = 51')
        .get() as { version: number } | undefined;
      expect(v51?.version).toBe(51);
    });

    it('defaults artifact_path to NULL on existing rows after migration', async () => {
      await new MigrationManager(db).migrate();

      // Insert a v1 nona_signal row without touching artifact_path -- it must
      // come back as NULL (the v1-signal contract per TICKET_196_7_0 Q3).
      db.prepare(
        `INSERT INTO nona_signal (code, strategy_name, user_id) VALUES (?, ?, ?)`
      ).run('// code', 'V1ArtifactlessSig', 'u1');

      const row = db
        .prepare('SELECT artifact_path FROM nona_signal WHERE strategy_name = ?')
        .get('V1ArtifactlessSig') as { artifact_path: string | null };
      expect(row.artifact_path).toBeNull();
    });

    it('allows INSERT with a populated artifact_path payload (v2 signal)', async () => {
      await new MigrationManager(db).migrate();

      // v2 signals point at {userData}/algorithms/<algo_id>/artifact/
      // per TICKET_196_7_0 Q3 + TICKET_196_7_0_1.
      const path = '/home/user/.config/StratCraft/algorithms/abc123/artifact';
      db.prepare(
        `INSERT INTO nona_signal (code, strategy_name, user_id, artifact_path)
         VALUES (?, ?, ?, ?)`
      ).run('// code', 'V2FactorSig', 'u1', path);

      const row = db
        .prepare('SELECT artifact_path FROM nona_signal WHERE strategy_name = ?')
        .get('V2FactorSig') as { artifact_path: string };
      expect(row.artifact_path).toBe(path);
    });

    it('is a strict no-op when the column already exists (idempotent re-run)', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();
      // Re-run twice to confirm the imperative `up` does not double-add.
      await manager.migrate();
      await manager.migrate();

      expect(hasArtifactPathColumn()).toBe(true);
      const applied = db
        .prepare('SELECT COUNT(*) AS n FROM schema_version WHERE version = 51')
        .get() as { n: number };
      expect(applied.n).toBe(1);
    });
  });

  // TICKET_907_1_1: bar_interval column on nona_signal. This promotes the
  // signal timeframe out of metadata JSON so fusion/replay/read models can
  // consume it without renderer-side parsing. Nullable for legacy rows.
  describe('TICKET_907_1_1: bar_interval migration (v82)', () => {
    function hasBarIntervalColumn(): boolean {
      const cols = db
        .prepare(`PRAGMA table_info(nona_signal)`)
        .all() as Array<{ name: string }>;
      return cols.some(c => c.name === 'bar_interval');
    }

    it('adds nullable bar_interval column to nona_signal', async () => {
      await new MigrationManager(db).migrate();

      expect(hasBarIntervalColumn()).toBe(true);
      const v82 = db
        .prepare('SELECT version FROM schema_version WHERE version = 82')
        .get() as { version: number } | undefined;
      expect(v82?.version).toBe(82);
    });

    it('backfills bar_interval from metadata.bar_interval and leaves missing metadata NULL', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      db.prepare(
        `INSERT INTO nona_signal (code, strategy_name, user_id, metadata, bar_interval)
         VALUES (?, ?, ?, ?, NULL)`
      ).run('// code', 'BackfillIntervalSig', 'u1', JSON.stringify({ bar_interval: '5m' }));
      db.prepare(
        `INSERT INTO nona_signal (code, strategy_name, user_id, metadata, bar_interval)
         VALUES (?, ?, ?, ?, NULL)`
      ).run('// code', 'LegacyNoIntervalSig', 'u1', JSON.stringify({ source: 'legacy' }));

      const v82Migration = EMBEDDED_MIGRATIONS_FOR_TEST.find(m => m.version === 82)!;
      if (typeof v82Migration.up === 'function') v82Migration.up(db);
      else db.exec(v82Migration.up);

      const backfilled = db
        .prepare('SELECT bar_interval FROM nona_signal WHERE strategy_name = ?')
        .get('BackfillIntervalSig') as { bar_interval: string | null };
      const legacy = db
        .prepare('SELECT bar_interval FROM nona_signal WHERE strategy_name = ?')
        .get('LegacyNoIntervalSig') as { bar_interval: string | null };

      expect(backfilled.bar_interval).toBe('5m');
      expect(legacy.bar_interval).toBeNull();
    });
  });

  describe('TICKET_804: signal lineage skeleton (v54)', () => {
    const tableExists = (name: string): boolean => {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(name) as { name?: string } | undefined;
      return !!row?.name;
    };
    const columnNames = (table: string): string[] => {
      return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
        .map(r => r.name);
    };
    const indexNames = (table: string): string[] => {
      return (db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>)
        .map(r => r.name);
    };

    it('creates nona_signal_definition + signal_run with all v54 columns', async () => {
      await new MigrationManager(db).migrate();

      expect(tableExists('nona_signal_definition')).toBe(true);
      expect(tableExists('signal_run')).toBe(true);

      const defCols = columnNames('nona_signal_definition');
      for (const c of [
        'id', 'user_id', 'template_id', 'params_canonical', 'universe_id',
        'normalization', 'provider', 'observable', 'training_window',
        'fingerprint', 'code_version', 'signal_source', 'category',
        'display_name', 'created_at', 'deleted_at',
      ]) {
        expect(defCols).toContain(c);
      }

      const runCols = columnNames('signal_run');
      for (const c of [
        'id', 'definition_id', 'user_id', 'run_seq', 'data_snapshot_id',
        'data_window_start', 'data_window_end', 'bars_manifest_path',
        'signal_code', 'artifact_path', 'score', 'metrics_json',
        'session_id', 'status', 'error_message',
        // section 3.4 cache columns
        'cached_from_run_id', 'cost_saved_seconds',
        // section 3.4.1 replication columns
        'replication_index', 'replication_count', 'replication_group_id',
        'created_at', 'deleted_at',
      ]) {
        expect(runCols).toContain(c);
      }

      const v54 = db
        .prepare('SELECT version FROM schema_version WHERE version = 54')
        .get() as { version: number } | undefined;
      expect(v54?.version).toBe(54);
    });

    it('both lineage tables are empty after v54 (no backfill, by section 3.2 design)', async () => {
      // Seed a nona_signal row PRIOR to migration so we have something
      // a backfill would have copied -- and assert it was NOT copied.
      // (Pre-v41 migrations don't create nona_signal yet, so we let the
      // full migration run, then seed, then assert the lineage tables
      // are still empty.)
      await new MigrationManager(db).migrate();

      db.prepare(
        `INSERT INTO nona_signal (code, strategy_name, user_id, metadata)
         VALUES (?, ?, ?, ?)`
      ).run('// code', 'PreV54Signal', 'u1', JSON.stringify({ fingerprint: 'abc123' }));

      const defCount = db
        .prepare('SELECT COUNT(*) AS n FROM nona_signal_definition')
        .get() as { n: number };
      const runCount = db
        .prepare('SELECT COUNT(*) AS n FROM signal_run')
        .get() as { n: number };
      expect(defCount.n).toBe(0);
      expect(runCount.n).toBe(0);
    });

    it('v54 does not modify nona_signal schema or row count', async () => {
      // Run migrations up to v53 only by detecting the schema_version row count
      // after a fresh migrate(), then capture nona_signal row count and column
      // shape before and after a no-op re-migrate (v54 already applied).
      await new MigrationManager(db).migrate();

      db.prepare(
        `INSERT INTO nona_signal (code, strategy_name, user_id) VALUES (?, ?, ?)`
      ).run('// code', 'Existing', 'u1');

      const sigColsBefore = columnNames('nona_signal').sort();
      const sigCountBefore = (db
        .prepare('SELECT COUNT(*) AS n FROM nona_signal')
        .get() as { n: number }).n;

      // Re-run migrate() -- v54 already applied, so this should be a strict
      // no-op against nona_signal (lineage tables exist, but nona_signal is
      // untouched).
      await new MigrationManager(db).migrate();

      const sigColsAfter = columnNames('nona_signal').sort();
      const sigCountAfter = (db
        .prepare('SELECT COUNT(*) AS n FROM nona_signal')
        .get() as { n: number }).n;

      expect(sigColsAfter).toEqual(sigColsBefore);
      expect(sigCountAfter).toBe(sigCountBefore);
    });

    it('definition UNIQUE (user_id, fingerprint, code_version) is enforced', async () => {
      await new MigrationManager(db).migrate();

      const insert = db.prepare(`
        INSERT INTO nona_signal_definition
          (user_id, template_id, params_canonical, fingerprint, signal_source, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      insert.run('u1', 'hmm_regime_v1', '{}', 'fp_abc', 'tool_sweep_hmm', 1);

      // Same (user_id, fingerprint) + same default code_version='v0' -> dupe.
      expect(() =>
        insert.run('u1', 'hmm_regime_v1', '{}', 'fp_abc', 'tool_sweep_hmm', 2)
      ).toThrow(/UNIQUE/);

      // Different user_id is allowed.
      expect(() =>
        insert.run('u2', 'hmm_regime_v1', '{}', 'fp_abc', 'tool_sweep_hmm', 3)
      ).not.toThrow();
    });

    it('signal_run UNIQUE (definition_id, run_seq) is enforced', async () => {
      await new MigrationManager(db).migrate();

      const defId = (db.prepare(`
        INSERT INTO nona_signal_definition
          (user_id, template_id, params_canonical, fingerprint, signal_source, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('u1', 'hmm_regime_v1', '{}', 'fp_xyz', 'tool_sweep_hmm', 1).lastInsertRowid) as number;

      const insertRun = db.prepare(`
        INSERT INTO signal_run
          (definition_id, user_id, run_seq, data_snapshot_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      insertRun.run(defId, 'u1', 1, 'snap_a', 10);

      expect(() =>
        insertRun.run(defId, 'u1', 1, 'snap_b', 20)
      ).toThrow(/UNIQUE/);

      expect(() =>
        insertRun.run(defId, 'u1', 2, 'snap_b', 20)
      ).not.toThrow();
    });

    it('signal_run.status CHECK constraint rejects bad values', async () => {
      await new MigrationManager(db).migrate();

      const defId = (db.prepare(`
        INSERT INTO nona_signal_definition
          (user_id, template_id, params_canonical, fingerprint, signal_source, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('u1', 'hmm_regime_v1', '{}', 'fp_chk', 'tool_sweep_hmm', 1).lastInsertRowid) as number;

      const insertRun = db.prepare(`
        INSERT INTO signal_run
          (definition_id, user_id, run_seq, data_snapshot_id, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const ok of ['ok', 'failed', 'superseded']) {
        const run_seq = ['ok', 'failed', 'superseded'].indexOf(ok) + 1;
        expect(() => insertRun.run(defId, 'u1', run_seq, 'snap', ok, 1)).not.toThrow();
      }
      expect(() => insertRun.run(defId, 'u1', 99, 'snap', 'bogus', 1)).toThrow(/CHECK/);
    });

    it('cached_from_run_id self-FK SET NULL on source delete (no cascade)', async () => {
      await new MigrationManager(db).migrate();

      // FK enforcement is off by default in better-sqlite3; this migration
      // assumes the runtime enables PRAGMA foreign_keys = ON. Mirror that
      // here so the test reflects production behaviour.
      db.exec('PRAGMA foreign_keys = ON');

      const defId = (db.prepare(`
        INSERT INTO nona_signal_definition
          (user_id, template_id, params_canonical, fingerprint, signal_source, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('u1', 'hmm_regime_v1', '{}', 'fp_self', 'tool_sweep_hmm', 1).lastInsertRowid) as number;

      const sourceRunId = (db.prepare(`
        INSERT INTO signal_run
          (definition_id, user_id, run_seq, data_snapshot_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(defId, 'u1', 1, 'snap', 10).lastInsertRowid) as number;

      const cacheRunId = (db.prepare(`
        INSERT INTO signal_run
          (definition_id, user_id, run_seq, data_snapshot_id, cached_from_run_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(defId, 'u1', 2, 'snap', sourceRunId, 20).lastInsertRowid) as number;

      // Hard-delete the source run; cache row stays, with cached_from_run_id
      // nulled out so the dangling FK is explicit rather than silently broken.
      db.prepare('DELETE FROM signal_run WHERE id = ?').run(sourceRunId);

      const cacheRow = db
        .prepare('SELECT cached_from_run_id FROM signal_run WHERE id = ?')
        .get(cacheRunId) as { cached_from_run_id: number | null };
      expect(cacheRow.cached_from_run_id).toBeNull();
    });

    it('definition CASCADE DELETE removes all child runs', async () => {
      await new MigrationManager(db).migrate();
      db.exec('PRAGMA foreign_keys = ON');

      const defId = (db.prepare(`
        INSERT INTO nona_signal_definition
          (user_id, template_id, params_canonical, fingerprint, signal_source, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('u1', 'hmm_regime_v1', '{}', 'fp_cascade', 'tool_sweep_hmm', 1).lastInsertRowid) as number;

      const insertRun = db.prepare(`
        INSERT INTO signal_run
          (definition_id, user_id, run_seq, data_snapshot_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      insertRun.run(defId, 'u1', 1, 'snap_a', 10);
      insertRun.run(defId, 'u1', 2, 'snap_b', 20);

      db.prepare('DELETE FROM nona_signal_definition WHERE id = ?').run(defId);

      const remaining = db
        .prepare('SELECT COUNT(*) AS n FROM signal_run WHERE definition_id = ?')
        .get(defId) as { n: number };
      expect(remaining.n).toBe(0);
    });

    it('all expected indexes are created', async () => {
      await new MigrationManager(db).migrate();

      const defIdx = indexNames('nona_signal_definition');
      for (const i of [
        'idx_signal_definition_user',
        'idx_signal_definition_template',
        'idx_signal_definition_universe',
        'idx_signal_definition_fingerprint',
      ]) {
        expect(defIdx).toContain(i);
      }

      const runIdx = indexNames('signal_run');
      for (const i of [
        'idx_signal_run_definition',
        'idx_signal_run_user',
        'idx_signal_run_snapshot',
        'idx_signal_run_replication_group',
        'idx_signal_run_definition_snapshot',
      ]) {
        expect(runIdx).toContain(i);
      }
    });

    it('migration is idempotent (re-running migrate() does not throw or duplicate version row)', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();
      await manager.migrate();
      await manager.migrate();

      const applied = db
        .prepare('SELECT COUNT(*) AS n FROM schema_version WHERE version = 54')
        .get() as { n: number };
      expect(applied.n).toBe(1);
    });
  });

  describe('getStatus', () => {
    it('should report 0 pending after full migration', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      const status = manager.getStatus();
      expect(status.pendingMigrations).toBe(0);
      expect(status.currentVersion).toBeGreaterThanOrEqual(29);
      expect(status.availableMigrations).toBeGreaterThanOrEqual(29);
    });

    it('should report all migrations as pending on fresh DB', () => {
      const manager = new MigrationManager(db);
      const status = manager.getStatus();
      expect(status.currentVersion).toBe(0);
      expect(status.pendingMigrations).toBeGreaterThanOrEqual(29);
    });
  });

  describe('hasPendingMigrations', () => {
    it('should return true on fresh DB', () => {
      const manager = new MigrationManager(db);
      expect(manager.hasPendingMigrations()).toBe(true);
    });

    it('should return false after full migration', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();
      expect(manager.hasPendingMigrations()).toBe(false);
    });
  });

  describe('rollback', () => {
    it('should rollback to target version', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      const statusBefore = manager.getStatus();
      const currentVersion = statusBefore.currentVersion;

      // Rollback last migration
      await manager.rollback(currentVersion - 1);

      const statusAfter = manager.getStatus();
      expect(statusAfter.currentVersion).toBe(currentVersion - 1);
    });

    it('should throw if target >= current version', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      const { currentVersion } = manager.getStatus();
      await expect(manager.rollback(currentVersion)).rejects.toThrow(
        'Cannot rollback'
      );
      await expect(manager.rollback(currentVersion + 1)).rejects.toThrow(
        'Cannot rollback'
      );
    });

    it('should reject rollback across an intentionally irreversible migration', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();
      const { currentVersion } = manager.getStatus();
      expect(currentVersion).toBe(LATEST_SCHEMA_VERSION);

      await expect(manager.rollback(1)).rejects.toThrow(
        'Migration 97 has no DOWN migration defined',
      );
      expect(manager.getStatus().currentVersion).toBe(currentVersion);
    });
  });

  describe('TICKET_196_6_1: signal_scoreboard table', () => {
    interface ColumnInfo {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }

    function getColumns(table: string): ColumnInfo[] {
      return db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
    }

    function hasIndex(name: string): boolean {
      const rows = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
        .all(name) as Array<{ name: string }>;
      return rows.length > 0;
    }

    it('should create the signal_scoreboard table with the locked column shape', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='signal_scoreboard'")
        .all() as Array<{ name: string }>;
      expect(tables).toHaveLength(1);

      const columns = getColumns('signal_scoreboard');
      const byName = new Map(columns.map(c => [c.name, c]));

      // Locked by TICKET_196_6 "Persistence schema". Any drift is a spec violation.
      // PRAGMA table_info reports `pk` as the 1-based ordinal within the composite
      // PK, not a boolean. Composite PK order = (algo_id, mode, computed_at) per
      // the CREATE TABLE statement -> pk indices 1, 2, 3 respectively.
      expect(byName.get('algo_id')).toMatchObject({ type: 'TEXT', notnull: 1, pk: 1 });
      expect(byName.get('mode')).toMatchObject({ type: 'TEXT', notnull: 1, pk: 2 });
      expect(byName.get('computed_at')).toMatchObject({ type: 'INTEGER', notnull: 1, pk: 3 });
      expect(byName.get('window_bars')).toMatchObject({ type: 'INTEGER', notnull: 1, pk: 0 });
      expect(byName.get('score')).toMatchObject({ type: 'REAL', notnull: 0, pk: 0 });
      expect(byName.get('sharpe_long')).toMatchObject({ type: 'REAL', notnull: 0, pk: 0 });
      expect(byName.get('sharpe_short')).toMatchObject({ type: 'REAL', notnull: 0, pk: 0 });
      expect(byName.get('hit_rate')).toMatchObject({ type: 'REAL', notnull: 0, pk: 0 });
      expect(byName.get('trades')).toMatchObject({ type: 'INTEGER', notnull: 0, pk: 0 });

      // Composite PK is (algo_id, mode, computed_at) per spec.
      const pkCols = columns.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk).map(c => c.name);
      expect(pkCols).toEqual(['algo_id', 'mode', 'computed_at']);
    });

    it('should create idx_scoreboard_algo_mode index', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();
      expect(hasIndex('idx_scoreboard_algo_mode')).toBe(true);
    });

    it('should enforce composite primary key (algo_id, mode, computed_at)', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      const insert = db.prepare(`
        INSERT INTO signal_scoreboard
          (algo_id, computed_at, window_bars, mode, score, sharpe_long, sharpe_short, hit_rate, trades)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insert.run('algo-1', 1700000000000, 60, 'backtest', 0.12, 0.5, -0.1, 0.55, 30);

      // Same (algo_id, mode, computed_at) -> unique violation.
      expect(() =>
        insert.run('algo-1', 1700000000000, 60, 'backtest', 0.13, 0.6, -0.2, 0.6, 31)
      ).toThrow(/UNIQUE|PRIMARY KEY/);

      // Same algo + computed_at but different mode -> allowed.
      expect(() =>
        insert.run('algo-1', 1700000000000, 60, 'live', 0.14, 0.7, -0.3, 0.61, 32)
      ).not.toThrow();
    });

    it('should accept NULL score and metric columns (warmup case)', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      const insert = db.prepare(`
        INSERT INTO signal_scoreboard
          (algo_id, computed_at, window_bars, mode, score, sharpe_long, sharpe_short, hit_rate, trades)
        VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)
      `);
      expect(() => insert.run('algo-warmup', 1700000001000, 60, 'live')).not.toThrow();

      const row = db
        .prepare('SELECT * FROM signal_scoreboard WHERE algo_id = ?')
        .get('algo-warmup') as Record<string, unknown>;
      expect(row.score).toBeNull();
      expect(row.sharpe_long).toBeNull();
      expect(row.trades).toBeNull();
    });

    it('should be idempotent: a second migrate() does not error or duplicate the table', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();
      await expect(manager.migrate()).resolves.toBeUndefined();

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='signal_scoreboard'")
        .all() as Array<{ name: string }>;
      expect(tables).toHaveLength(1);
    });
  });

  // TICKET_196_6_2: PIT extension -- adds forward_test_started_at column to
  // signal_scoreboard. Nullable INTEGER (unix ms). Sits empty at land-time;
  // populated later by the live alt-data writer (TICKET_196_7_7) and the
  // Scoreboard batch job. These tests pin the column shape and the
  // additive-migration contract.
  describe('TICKET_196_6_2: signal_scoreboard forward_test_started_at', () => {
    interface ColumnInfo {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }

    function getColumns(table: string): ColumnInfo[] {
      return db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
    }

    it('creates forward_test_started_at as nullable INTEGER with no default', async () => {
      await new MigrationManager(db).migrate();

      const columns = getColumns('signal_scoreboard');
      const col = columns.find(c => c.name === 'forward_test_started_at');
      expect(col).toBeDefined();
      expect(col).toMatchObject({
        type: 'INTEGER',
        notnull: 0,
        dflt_value: null,
        pk: 0,
      });

      const v48 = db
        .prepare('SELECT version FROM schema_version WHERE version = 48')
        .get() as { version: number } | undefined;
      expect(v48?.version).toBe(48);
    });

    it('accepts NULL for forward_test_started_at (omitted from INSERT)', async () => {
      await new MigrationManager(db).migrate();

      const insert = db.prepare(`
        INSERT INTO signal_scoreboard
          (algo_id, computed_at, window_bars, mode, score, sharpe_long, sharpe_short, hit_rate, trades)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      expect(() =>
        insert.run('algo-pit-null', 1748000000000, 60, 'backtest', 0.1, 0.4, -0.1, 0.52, 25)
      ).not.toThrow();

      const row = db
        .prepare('SELECT forward_test_started_at FROM signal_scoreboard WHERE algo_id = ?')
        .get('algo-pit-null') as { forward_test_started_at: number | null };
      expect(row.forward_test_started_at).toBeNull();
    });

    it('accepts a unix-ms INTEGER for forward_test_started_at and round-trips', async () => {
      await new MigrationManager(db).migrate();

      const startedAt = 1748000000000;
      const insert = db.prepare(`
        INSERT INTO signal_scoreboard
          (algo_id, computed_at, window_bars, mode, score, sharpe_long, sharpe_short, hit_rate, trades, forward_test_started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      expect(() =>
        insert.run('algo-pit-live', 1748000060000, 60, 'live', 0.2, 0.8, -0.05, 0.6, 12, startedAt)
      ).not.toThrow();

      const row = db
        .prepare('SELECT forward_test_started_at FROM signal_scoreboard WHERE algo_id = ?')
        .get('algo-pit-live') as { forward_test_started_at: number };
      expect(row.forward_test_started_at).toBe(startedAt);
    });

    it('leaves rows written without forward_test_started_at as NULL (pre-v48 writer contract)', async () => {
      // AC#6: rows written by a pre-v48 writer (which has no knowledge of
      // the new column) must end up with forward_test_started_at = NULL.
      // After migrate() the column exists, but the v47-shape INSERT is
      // still legal because the new column is nullable with no default --
      // SQLite fills it with NULL for any row that omits it. That is
      // exactly the contract a still-deployed pre-v48 writer would honor,
      // so this assertion locks in the AC#6 guarantee without relying on
      // rollback (which is independently brittle on this repo at the
      // current migration head, unrelated to this ticket).
      await new MigrationManager(db).migrate();

      const insertV47Shape = db.prepare(`
        INSERT INTO signal_scoreboard
          (algo_id, computed_at, window_bars, mode, score, sharpe_long, sharpe_short, hit_rate, trades)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertV47Shape.run('algo-pre-v48', 1747000000000, 60, 'live', 0.05, 0.3, -0.2, 0.5, 7);

      const row = db
        .prepare(
          'SELECT forward_test_started_at FROM signal_scoreboard WHERE algo_id = ?'
        )
        .get('algo-pre-v48') as { forward_test_started_at: number | null };
      expect(row.forward_test_started_at).toBeNull();
    });

    it('is idempotent: a second migrate() does not re-add the column or throw', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();
      await expect(manager.migrate()).resolves.toBeUndefined();
      await expect(manager.migrate()).resolves.toBeUndefined();

      const columns = getColumns('signal_scoreboard');
      const matches = columns.filter(c => c.name === 'forward_test_started_at');
      expect(matches).toHaveLength(1);

      const applied = db
        .prepare('SELECT COUNT(*) AS n FROM schema_version WHERE version = 48')
        .get() as { n: number };
      expect(applied.n).toBe(1);
    });

  });

  // TICKET_196_6_3: v_algorithms_all and v_strategy_audit_all were created at
  // v42 / v45 with `SELECT *` over UNION ALL. After v46 (cached_stats_json
  // added to nona_signal only), the two sides diverged in column count.
  // SQLite tolerated the mismatch at view-creation and SELECT time but
  // failed any `ALTER TABLE ... DROP/ADD COLUMN` against any table -- the
  // engine walks every view's SELECT during ALTER. v49 heals both views by
  // recreating them with explicit intersection column lists. These tests
  // pin: (1) the views project explicit columns (no SELECT *); (2) the
  // parent_kind discriminator still works; (3) DROP COLUMN no longer trips
  // the union-mismatch error post-v49; (4) cached_stats_json (signal-only
  // by v46 design) is NOT projected by v_algorithms_all; (5) the migration
  // is idempotent.
  describe('TICKET_196_6_3: view drift fix (v49)', () => {
    function getViewSql(name: string): string | undefined {
      const row = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='view' AND name=?")
        .get(name) as { sql?: string } | undefined;
      return row?.sql;
    }

    it('views recreated with explicit columns (no SELECT *)', async () => {
      await new MigrationManager(db).migrate();

      const algoView = getViewSql('v_algorithms_all');
      const auditView = getViewSql('v_strategy_audit_all');

      expect(algoView).toBeDefined();
      expect(auditView).toBeDefined();

      // Post-v49 the views project explicit column lists. The pre-v49 bug
      // was `SELECT *, 'algorithm' AS parent_kind` -- the literal token
      // `SELECT *` must not appear anywhere in either view's stored SQL.
      expect(algoView).not.toMatch(/SELECT\s+\*/i);
      expect(auditView).not.toMatch(/SELECT\s+\*/i);

      // Sanity: explicit columns we expect to see in each view.
      expect(algoView).toMatch(/strategy_name/);
      expect(algoView).toMatch(/parent_kind/);
      expect(auditView).toMatch(/overall_score/);
      expect(auditView).toMatch(/parent_kind/);
    });

    it('parent_kind discriminator still works across both sides', async () => {
      await new MigrationManager(db).migrate();

      db.prepare(
        `INSERT INTO nona_algorithms (id, code, strategy_name, user_id)
         VALUES (7001, '// algo', 'AlgoRow', 'u1')`
      ).run();
      db.prepare(
        `INSERT INTO nona_signal (id, code, strategy_name, user_id)
         VALUES (7002, '// sig', 'SignalRow', 'u1')`
      ).run();

      const rows = db
        .prepare(`SELECT parent_kind, COUNT(*) AS n FROM v_algorithms_all
                  WHERE id IN (7001, 7002) GROUP BY parent_kind ORDER BY parent_kind`)
        .all() as Array<{ parent_kind: string; n: number }>;
      expect(rows).toEqual([
        { parent_kind: 'algorithm', n: 1 },
        { parent_kind: 'signal', n: 1 },
      ]);

      db.prepare(
        `INSERT INTO strategy_audit (
           algorithm_id, signal_source, llm_provider, llm_model,
           d1_completeness, d2_similarity, d3_indicator_fit, d4_code_quality, d5_robustness,
           overall_score, star_rating, code_hash, ast_fingerprint
         ) VALUES (7001, 'indicator_detector_macd', 'CLAUDE', 'm', 1, 1, 1, 1, 1, 5, 5, 'h1', 'a1')`
      ).run();
      db.prepare(
        `INSERT INTO strategy_audit_signal (
           algorithm_id, signal_source, llm_provider, llm_model,
           d1_completeness, d2_similarity, d3_indicator_fit, d4_code_quality, d5_robustness,
           overall_score, star_rating, code_hash, ast_fingerprint
         ) VALUES (7002, 'signal_discovery', 'CLAUDE', 'm', 1, 1, 1, 1, 1, 5, 5, 'h2', 'a2')`
      ).run();

      const auditRows = db
        .prepare(`SELECT parent_kind, COUNT(*) AS n FROM v_strategy_audit_all
                  WHERE algorithm_id IN (7001, 7002) GROUP BY parent_kind ORDER BY parent_kind`)
        .all() as Array<{ parent_kind: string; n: number }>;
      expect(auditRows).toEqual([
        { parent_kind: 'algorithm', n: 1 },
        { parent_kind: 'signal', n: 1 },
      ]);
    });

    // The core unblock: pre-v49 any `ALTER TABLE ... DROP/ADD COLUMN`
    // anywhere in the schema raised "SELECTs to the left and right of
    // UNION ALL do not have the same number of result columns" because
    // SQLite re-validates every view during ALTER. v49 heals the views so
    // the schema-walk succeeds.
    it('ALTER TABLE ... ADD/DROP COLUMN no longer trips the view-mismatch error', async () => {
      await new MigrationManager(db).migrate();

      // ADD COLUMN -- this walks every view's SELECT under the hood.
      expect(() =>
        db.exec(`ALTER TABLE signal_scoreboard ADD COLUMN view_drift_probe_v49 INTEGER`)
      ).not.toThrow();

      // DROP COLUMN -- the direct repro from the ticket's blast radius.
      expect(() =>
        db.exec(`ALTER TABLE signal_scoreboard DROP COLUMN view_drift_probe_v49`)
      ).not.toThrow();

      // Views still queryable after the schema walk.
      expect(() =>
        db.prepare(`SELECT COUNT(*) AS n FROM v_algorithms_all`).get()
      ).not.toThrow();
      expect(() =>
        db.prepare(`SELECT COUNT(*) AS n FROM v_strategy_audit_all`).get()
      ).not.toThrow();
    });

    // Positive contract for the intersection projection: cached_stats_json
    // (v46, signal-only) is intentionally excluded from v_algorithms_all so
    // the column-shape invariant holds. Callers that need the prior must
    // query nona_signal directly.
    it('cached_stats_json is NOT projected by v_algorithms_all (signal-specific column stays signal-specific)', async () => {
      await new MigrationManager(db).migrate();

      expect(() =>
        db.prepare(`SELECT cached_stats_json FROM v_algorithms_all LIMIT 1`).get()
      ).toThrow(/no such column/i);

      // But the column does exist on the underlying table.
      expect(() =>
        db.prepare(`SELECT cached_stats_json FROM nona_signal LIMIT 1`).get()
      ).not.toThrow();
    });

    it('is idempotent: a second migrate() does not re-create or throw', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();
      await expect(manager.migrate()).resolves.toBeUndefined();
      await expect(manager.migrate()).resolves.toBeUndefined();

      const applied = db
        .prepare('SELECT COUNT(*) AS n FROM schema_version WHERE version = 49')
        .get() as { n: number };
      expect(applied.n).toBe(1);

      // Views still in place with the same explicit-column shape.
      expect(getViewSql('v_algorithms_all')).not.toMatch(/SELECT\s+\*/i);
      expect(getViewSql('v_strategy_audit_all')).not.toMatch(/SELECT\s+\*/i);
    });
  });

  // ===========================================================================
  // TICKET_568_5_1 Phase 1: nona_factors.source CHECK widening (v50)
  // ===========================================================================

  describe('TICKET_568_5_1: nona_factors source CHECK widened (v50)', () => {
    it('accepts the four new alt-data source values after v50', async () => {
      await new MigrationManager(db).migrate();

      // All four alt-data source values must be accepted.
      const alt = ['macro', 'sentiment', 'fund_flow', 'on_chain'] as const;
      for (const src of alt) {
        expect(() =>
          db
            .prepare(
              `INSERT INTO nona_factors (factor_id, name, category, source)
               VALUES (?, ?, ?, ?)`,
            )
            .run(`alt_${src}_1`, `Alt ${src}`, 'macro', src),
        ).not.toThrow();
      }

      // And the legacy source values still work.
      for (const src of ['library', 'alpha158', 'alpha101', 'talib', 'mined', 'custom']) {
        expect(() =>
          db
            .prepare(
              `INSERT INTO nona_factors (factor_id, name, category, source)
               VALUES (?, ?, ?, ?)`,
            )
            .run(`legacy_${src}_1`, `Legacy ${src}`, 'momentum', src),
        ).not.toThrow();
      }
    });

    it('rejects a non-whitelisted source value', async () => {
      await new MigrationManager(db).migrate();
      expect(() =>
        db
          .prepare(
            `INSERT INTO nona_factors (factor_id, name, category, source)
             VALUES ('bogus_1', 'Bogus', 'macro', 'not_a_real_source')`,
          )
          .run(),
      ).toThrow(/CHECK constraint failed/i);
    });

    it('preserves v15-v17 columns through the v50 rebuild (factor_type, translation_status, qlib_expr, cs_pipeline)', async () => {
      await new MigrationManager(db).migrate();

      // Insert a row carrying every v15-v17 column with non-default values.
      db
        .prepare(
          `INSERT INTO nona_factors
             (factor_id, name, category, source, factor_type, translation_status, qlib_expr, cs_pipeline)
           VALUES ('preserve_1', 'Preserve', 'momentum', 'alpha158',
                   'cross_sectional', 'ok', 'Mean($close, 5)', '[]')`,
        )
        .run();

      const row = db
        .prepare(
          `SELECT factor_type, translation_status, qlib_expr, cs_pipeline
           FROM nona_factors WHERE factor_id = 'preserve_1'`,
        )
        .get() as Record<string, string>;
      expect(row.factor_type).toBe('cross_sectional');
      expect(row.translation_status).toBe('ok');
      expect(row.qlib_expr).toBe('Mean($close, 5)');
      expect(row.cs_pipeline).toBe('[]');
    });

    it('idempotent: schema_version records v50 exactly once', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();
      await manager.migrate();

      const applied = db
        .prepare('SELECT COUNT(*) AS n FROM schema_version WHERE version = 50')
        .get() as { n: number };
      expect(applied.n).toBe(1);
    });

    it('rolling back v50 refuses to drop rows that already use the new source values', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      // Pollute the table with an alt-data row, then attempt rollback to v49.
      db
        .prepare(
          `INSERT INTO nona_factors (factor_id, name, category, source)
           VALUES ('macro_block_rollback', 'Block Rollback', 'macro', 'macro')`,
        )
        .run();

      const v50Migration = EMBEDDED_MIGRATIONS_FOR_TEST.find(m => m.version === 50)!;
      expect(() => db.exec(v50Migration.down)).toThrow();
    });

    it('rolling back v50 succeeds when no alt-data rows are present, and restores v15 CHECK', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();

      const v50Migration = EMBEDDED_MIGRATIONS_FOR_TEST.find(m => m.version === 50)!;
      expect(() => db.exec(v50Migration.down)).not.toThrow();

      // After rollback, inserting an alt-data source value must be rejected
      // by the restored v15 CHECK.
      expect(() =>
        db
          .prepare(
            `INSERT INTO nona_factors (factor_id, name, category, source)
             VALUES ('macro_after_rollback', 'After Rollback', 'macro', 'macro')`,
          )
          .run(),
      ).toThrow(/CHECK constraint failed/i);
    });
  });

  describe('TICKET_196_7_7 P4.1: alt_data_history table (v52)', () => {
    interface ColumnInfo {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }

    function getColumns(table: string): ColumnInfo[] {
      return db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
    }

    it('creates alt_data_history with the locked column shape and composite primary key', async () => {
      await new MigrationManager(db).migrate();

      const exists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='alt_data_history'")
        .get();
      expect(exists).toBeDefined();

      const columns = getColumns('alt_data_history');
      const byName = Object.fromEntries(columns.map(c => [c.name, c]));

      expect(byName.provider_id).toMatchObject({ type: 'TEXT', notnull: 1, pk: 1 });
      expect(byName.series_id).toMatchObject({ type: 'TEXT', notnull: 1, pk: 2 });
      expect(byName.category).toMatchObject({ type: 'TEXT', notnull: 1, pk: 0 });
      expect(byName.symbol).toMatchObject({ type: 'TEXT', notnull: 0, pk: 0 });
      expect(byName.event_time).toMatchObject({ type: 'TEXT', notnull: 1, pk: 3 });
      expect(byName.knowledge_time).toMatchObject({ type: 'TEXT', notnull: 1, pk: 4 });
      expect(byName.value).toMatchObject({ type: 'REAL', notnull: 1, pk: 0 });
      // vintage_id participates in the PK; SQLite stores the literal "''"
      // default text as dflt_value so the column never holds NULL.
      expect(byName.vintage_id).toMatchObject({ type: 'TEXT', notnull: 1, pk: 5 });
      expect(byName.vintage_id.dflt_value).toBe("''");
      expect(byName.captured_at).toMatchObject({ type: 'INTEGER', notnull: 1, pk: 0 });

      const idx = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_alt_data_history_lookup'"
        )
        .get();
      expect(idx).toBeDefined();

      const v52 = db
        .prepare('SELECT version FROM schema_version WHERE version = 52')
        .get() as { version: number } | undefined;
      expect(v52?.version).toBe(52);
    });

    it('accepts an alt-data row without a vintage and round-trips', async () => {
      await new MigrationManager(db).migrate();

      const insert = db.prepare(`
        INSERT INTO alt_data_history
          (provider_id, series_id, category, symbol, event_time, knowledge_time, value, captured_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      expect(() =>
        insert.run('fred', 'DGS10', 'macro', null, '2026-05-01', '2026-05-02T08:30:00Z', 4.25, 1748000000000)
      ).not.toThrow();

      const row = db
        .prepare(
          `SELECT provider_id, series_id, category, symbol, value, vintage_id
           FROM alt_data_history WHERE provider_id = 'fred' AND series_id = 'DGS10'`
        )
        .get() as Record<string, string | number | null>;
      expect(row.value).toBe(4.25);
      expect(row.symbol).toBeNull();
      // Default sentinel preserves PK uniqueness across "no vintage" rows.
      expect(row.vintage_id).toBe('');
    });

    it('rejects a duplicate (provider, series, event_time, knowledge_time) without vintage', async () => {
      // PK collapses NULL-equivalent vintage to '' so two non-ALFRED rows for
      // the same observation timestamps cannot both land. INSERT OR IGNORE
      // is the production write path (P4.1 persist step); plain INSERT must
      // raise so a future writer that forgets OR IGNORE fails loudly.
      await new MigrationManager(db).migrate();

      const insert = db.prepare(`
        INSERT INTO alt_data_history
          (provider_id, series_id, category, event_time, knowledge_time, value, captured_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      insert.run('fred', 'CPIAUCSL', 'macro', '2026-04-01', '2026-05-13T12:30:00Z', 318.5, 1748100000000);
      expect(() =>
        insert.run('fred', 'CPIAUCSL', 'macro', '2026-04-01', '2026-05-13T12:30:00Z', 318.5, 1748100000001)
      ).toThrow(/UNIQUE constraint failed/i);
    });

    it('accepts two ALFRED vintages for the same (event_time, knowledge_time) pair', async () => {
      // ALFRED archive: the same publication can be revised; each vintage
      // is a distinct fact. The PK includes vintage_id to make this legal.
      await new MigrationManager(db).migrate();

      const insert = db.prepare(`
        INSERT INTO alt_data_history
          (provider_id, series_id, category, event_time, knowledge_time, value, vintage_id, captured_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insert.run('fred', 'GDPC1', 'macro', '2026-03-31', '2026-04-29T12:30:00Z', 21500.0, '2026-04-29', 1748000000000);
      expect(() =>
        insert.run('fred', 'GDPC1', 'macro', '2026-03-31', '2026-04-29T12:30:00Z', 21512.3, '2026-05-30', 1748100000000)
      ).not.toThrow();

      const rows = db
        .prepare(
          `SELECT vintage_id, value FROM alt_data_history
           WHERE provider_id = 'fred' AND series_id = 'GDPC1' ORDER BY vintage_id`
        )
        .all() as Array<{ vintage_id: string; value: number }>;
      expect(rows).toHaveLength(2);
      expect(rows[0].vintage_id).toBe('2026-04-29');
      expect(rows[1].vintage_id).toBe('2026-05-30');
      expect(rows[1].value).toBeCloseTo(21512.3, 4);
    });

    it('idempotent: a second migrate() does not re-create the table or throw', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();
      await expect(manager.migrate()).resolves.toBeUndefined();

      const tables = db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='alt_data_history'")
        .get() as { n: number };
      expect(tables.n).toBe(1);

      const applied = db
        .prepare('SELECT COUNT(*) AS n FROM schema_version WHERE version = 52')
        .get() as { n: number };
      expect(applied.n).toBe(1);
    });
  });

  // TICKET_196_7_5_2_1 P6: universe_id + symbol_breakdown columns on
  // signal_scoreboard. Same nullable-column + idempotent + legacy-INSERT
  // contract as the v48 forward_test_started_at migration.
  describe('TICKET_196_7_5_2_1 P6: signal_scoreboard universe_id + symbol_breakdown (v53)', () => {
    interface ColumnInfo {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }

    function getColumns(table: string): ColumnInfo[] {
      return db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
    }

    it('creates universe_id and symbol_breakdown as nullable TEXT columns with no default', async () => {
      await new MigrationManager(db).migrate();

      const columns = getColumns('signal_scoreboard');
      const universeIdCol = columns.find(c => c.name === 'universe_id');
      const breakdownCol = columns.find(c => c.name === 'symbol_breakdown');

      expect(universeIdCol).toMatchObject({
        type: 'TEXT',
        notnull: 0,
        dflt_value: null,
        pk: 0,
      });
      expect(breakdownCol).toMatchObject({
        type: 'TEXT',
        notnull: 0,
        dflt_value: null,
        pk: 0,
      });

      const v53 = db
        .prepare('SELECT version FROM schema_version WHERE version = 53')
        .get() as { version: number } | undefined;
      expect(v53?.version).toBe(53);
    });

    it('creates idx_scoreboard_universe index on universe_id', async () => {
      await new MigrationManager(db).migrate();

      const idx = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_scoreboard_universe'"
        )
        .get() as { name: string } | undefined;
      expect(idx?.name).toBe('idx_scoreboard_universe');
    });

    it('leaves rows written without universe_id / symbol_breakdown as NULL (pre-v53 writer contract)', async () => {
      // A v47/v48-shape INSERT must still be legal after v53 lands -- the
      // two new columns are nullable with no default, so SQLite fills them
      // with NULL on any row that omits them. This locks in the contract a
      // still-deployed pre-v53 writer would honor.
      await new MigrationManager(db).migrate();

      const insertV48Shape = db.prepare(`
        INSERT INTO signal_scoreboard
          (algo_id, computed_at, window_bars, mode, score, sharpe_long, sharpe_short, hit_rate, trades, forward_test_started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertV48Shape.run('algo-pre-v53', 1747100000000, 60, 'backtest', 0.05, 0.3, -0.2, 0.5, 7, null);

      const row = db
        .prepare(
          'SELECT universe_id, symbol_breakdown FROM signal_scoreboard WHERE algo_id = ?'
        )
        .get('algo-pre-v53') as { universe_id: string | null; symbol_breakdown: string | null };
      expect(row.universe_id).toBeNull();
      expect(row.symbol_breakdown).toBeNull();
    });

    it('accepts an INSERT carrying universe_id + JSON symbol_breakdown and round-trips both', async () => {
      await new MigrationManager(db).migrate();

      const breakdown = JSON.stringify([
        { symbol: 'SPY', score: 0.12, sharpe_long: 1.3, trades: 42 },
        { symbol: 'QQQ', score: 0.18, sharpe_long: 1.7, trades: 31 },
      ]);
      const insertV53Shape = db.prepare(`
        INSERT INTO signal_scoreboard
          (algo_id, computed_at, window_bars, mode, score, sharpe_long, sharpe_short, hit_rate, trades, forward_test_started_at, universe_id, symbol_breakdown)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertV53Shape.run(
        'algo-universe-spy-qqq',
        1748000000000,
        60,
        'tool_sweep_hmm',
        0.15,
        1.5,
        -0.1,
        0.55,
        73,
        null,
        'sp500_top50',
        breakdown,
      );

      const row = db
        .prepare(
          'SELECT universe_id, symbol_breakdown FROM signal_scoreboard WHERE algo_id = ?'
        )
        .get('algo-universe-spy-qqq') as { universe_id: string; symbol_breakdown: string };
      expect(row.universe_id).toBe('sp500_top50');
      const parsed = JSON.parse(row.symbol_breakdown) as Array<{ symbol: string }>;
      expect(parsed).toHaveLength(2);
      expect(parsed[0].symbol).toBe('SPY');
      expect(parsed[1].symbol).toBe('QQQ');
    });

    it('is idempotent: re-running migrate() does not re-add columns or duplicate the index', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();
      await expect(manager.migrate()).resolves.toBeUndefined();
      await expect(manager.migrate()).resolves.toBeUndefined();

      const columns = getColumns('signal_scoreboard');
      expect(columns.filter(c => c.name === 'universe_id')).toHaveLength(1);
      expect(columns.filter(c => c.name === 'symbol_breakdown')).toHaveLength(1);

      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_scoreboard_universe'"
        )
        .all() as Array<{ name: string }>;
      expect(indexes).toHaveLength(1);

      const applied = db
        .prepare('SELECT COUNT(*) AS n FROM schema_version WHERE version = 53')
        .get() as { n: number };
      expect(applied.n).toBe(1);
    });
  });

  // ============================================================
  // TICKET_804_3 S1+S2: signal_definition_rollup VIEW (v57)
  // + family-level BH columns on signal_run (v58).
  //
  // S1 ticket test cases:
  //   - VIEW returns one row per definition; aggregates correct for
  //     known-fixture seed data.
  //   - Definition with no runs -> NULL aggregates, run_count=0.
  //
  // S2 (structural): both columns present with CHECK constraint on
  // statistical_verdict_family; legacy rows leave them NULL by design.
  // ============================================================
  describe('TICKET_804_3: definition rollup VIEW + family BH columns (v57, v58)', () => {
    const insertDef = (
      args: { userId: string; templateId: string; fingerprint: string; universeId?: string | null; displayName?: string | null; deletedAt?: number | null }
    ): number => {
      return Number(
        db.prepare(`
          INSERT INTO nona_signal_definition
            (user_id, template_id, params_canonical, universe_id, fingerprint, signal_source, display_name, created_at, deleted_at)
          VALUES (?, ?, '{}', ?, ?, 'tool_sweep_hmm', ?, 0, ?)
        `).run(
          args.userId,
          args.templateId,
          args.universeId ?? null,
          args.fingerprint,
          args.displayName ?? null,
          args.deletedAt ?? null
        ).lastInsertRowid
      );
    };

    const insertRun = (args: {
      definitionId: number;
      runSeq: number;
      status?: 'ok' | 'failed' | 'superseded';
      oosSharpe?: number | null;
      verdict?: 'significant' | 'marginal' | 'not_significant' | 'insufficient_data' | null;
      createdAt?: number;
      deletedAt?: number | null;
    }): number => {
      return Number(
        db.prepare(`
          INSERT INTO signal_run
            (definition_id, user_id, run_seq, data_snapshot_id, status,
             oos_sharpe, statistical_verdict, created_at, deleted_at)
          VALUES (?, 'u1', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          args.definitionId,
          args.runSeq,
          `snap_${args.definitionId}_${args.runSeq}`,
          args.status ?? 'ok',
          args.oosSharpe ?? null,
          args.verdict ?? null,
          args.createdAt ?? args.runSeq * 100,
          args.deletedAt ?? null
        ).lastInsertRowid
      );
    };

    // S1, test case 1: aggregates correct for known-fixture seed data.
    it('S1: VIEW returns one row per definition with correct aggregates', async () => {
      await new MigrationManager(db).migrate();

      const defA = insertDef({
        userId: 'u1', templateId: 'hmm_regime_v1', fingerprint: 'fp_a',
        universeId: 'sp500_top50', displayName: 'HMM A',
      });
      // 3 runs: oos_sharpe = 0.5, 1.0, 1.5; one 'significant', one 'marginal'.
      insertRun({ definitionId: defA, runSeq: 1, oosSharpe: 0.5, verdict: 'marginal', createdAt: 100 });
      insertRun({ definitionId: defA, runSeq: 2, oosSharpe: 1.0, verdict: 'significant', createdAt: 200 });
      insertRun({ definitionId: defA, runSeq: 3, oosSharpe: 1.5, verdict: 'not_significant', createdAt: 300 });

      const defB = insertDef({
        userId: 'u1', templateId: 'ngram_v1', fingerprint: 'fp_b',
        universeId: null, displayName: 'NG B',
      });
      insertRun({ definitionId: defB, runSeq: 1, oosSharpe: 2.0, verdict: 'significant', createdAt: 50 });

      const rows = db.prepare(`
        SELECT definition_id, template_id, universe_id, display_name,
               run_count, significant_runs,
               mean_oos_sharpe, min_oos_sharpe, max_oos_sharpe,
               first_run_at, last_run_at
        FROM signal_definition_rollup
        ORDER BY definition_id
      `).all() as Array<{
        definition_id: number;
        template_id: string;
        universe_id: string | null;
        display_name: string | null;
        run_count: number;
        significant_runs: number;
        mean_oos_sharpe: number | null;
        min_oos_sharpe: number | null;
        max_oos_sharpe: number | null;
        first_run_at: number | null;
        last_run_at: number | null;
      }>;

      expect(rows).toHaveLength(2);

      const a = rows.find(r => r.definition_id === defA)!;
      expect(a.template_id).toBe('hmm_regime_v1');
      expect(a.universe_id).toBe('sp500_top50');
      expect(a.display_name).toBe('HMM A');
      expect(a.run_count).toBe(3);
      expect(a.significant_runs).toBe(1);
      expect(a.mean_oos_sharpe).toBeCloseTo(1.0, 6);
      expect(a.min_oos_sharpe).toBeCloseTo(0.5, 6);
      expect(a.max_oos_sharpe).toBeCloseTo(1.5, 6);
      expect(a.first_run_at).toBe(100);
      expect(a.last_run_at).toBe(300);

      const b = rows.find(r => r.definition_id === defB)!;
      expect(b.run_count).toBe(1);
      expect(b.significant_runs).toBe(1);
      expect(b.mean_oos_sharpe).toBeCloseTo(2.0, 6);
    });

    // S1, test case 2: definition with no runs -> NULL aggregates, run_count=0.
    it('S1: definition with no runs surfaces run_count=0 and NULL aggregates', async () => {
      await new MigrationManager(db).migrate();

      const defId = insertDef({
        userId: 'u1', templateId: 'hmm_regime_v1', fingerprint: 'fp_empty',
        displayName: 'Empty',
      });

      const row = db.prepare(`
        SELECT definition_id, run_count, significant_runs,
               mean_oos_sharpe, min_oos_sharpe, max_oos_sharpe,
               first_run_at, last_run_at
        FROM signal_definition_rollup
        WHERE definition_id = ?
      `).get(defId) as {
        definition_id: number;
        run_count: number;
        significant_runs: number;
        mean_oos_sharpe: number | null;
        min_oos_sharpe: number | null;
        max_oos_sharpe: number | null;
        first_run_at: number | null;
        last_run_at: number | null;
      };

      expect(row.definition_id).toBe(defId);
      expect(row.run_count).toBe(0);
      expect(row.significant_runs).toBe(0);
      expect(row.mean_oos_sharpe).toBeNull();
      expect(row.min_oos_sharpe).toBeNull();
      expect(row.max_oos_sharpe).toBeNull();
      expect(row.first_run_at).toBeNull();
      expect(row.last_run_at).toBeNull();
    });

    // S1: failed / superseded / soft-deleted runs must not contribute to aggregates.
    it('S1: failed / superseded / soft-deleted runs are excluded from aggregates', async () => {
      await new MigrationManager(db).migrate();

      const defId = insertDef({
        userId: 'u1', templateId: 'hmm_regime_v1', fingerprint: 'fp_filter',
      });

      // Only this one should count.
      insertRun({ definitionId: defId, runSeq: 1, oosSharpe: 1.0, verdict: 'significant' });
      // Excluded by status filter.
      insertRun({ definitionId: defId, runSeq: 2, oosSharpe: 99.0, status: 'failed' });
      insertRun({ definitionId: defId, runSeq: 3, oosSharpe: 99.0, status: 'superseded' });
      // Excluded by soft-delete filter.
      insertRun({ definitionId: defId, runSeq: 4, oosSharpe: 99.0, verdict: 'significant', deletedAt: 1 });

      const row = db.prepare(`
        SELECT run_count, significant_runs, mean_oos_sharpe, max_oos_sharpe
        FROM signal_definition_rollup WHERE definition_id = ?
      `).get(defId) as {
        run_count: number;
        significant_runs: number;
        mean_oos_sharpe: number | null;
        max_oos_sharpe: number | null;
      };

      expect(row.run_count).toBe(1);
      expect(row.significant_runs).toBe(1);
      expect(row.mean_oos_sharpe).toBeCloseTo(1.0, 6);
      expect(row.max_oos_sharpe).toBeCloseTo(1.0, 6);
    });

    // S1: soft-deleted definitions are hidden from the VIEW.
    it('S1: soft-deleted definitions do not appear in the VIEW', async () => {
      await new MigrationManager(db).migrate();

      insertDef({
        userId: 'u1', templateId: 'hmm_regime_v1', fingerprint: 'fp_live',
      });
      const tombId = insertDef({
        userId: 'u1', templateId: 'hmm_regime_v1', fingerprint: 'fp_dead',
        deletedAt: 999,
      });

      const rows = db.prepare(`SELECT definition_id FROM signal_definition_rollup`).all() as Array<{ definition_id: number }>;
      expect(rows.map(r => r.definition_id)).not.toContain(tombId);
    });

    // S2: columns are present on signal_run after v58.
    it('S2: signal_run carries p_value_bh_family_adjusted + statistical_verdict_family columns', async () => {
      await new MigrationManager(db).migrate();

      const cols = (db.prepare('PRAGMA table_info(signal_run)').all() as Array<{ name: string }>)
        .map(r => r.name);
      expect(cols).toContain('p_value_bh_family_adjusted');
      expect(cols).toContain('statistical_verdict_family');
    });

    // S2: legacy rows leave both columns NULL (no backfill, by design).
    it('S2: new signal_run rows default to NULL for both family-BH columns', async () => {
      await new MigrationManager(db).migrate();

      const defId = insertDef({
        userId: 'u1', templateId: 'hmm_regime_v1', fingerprint: 'fp_legacy',
      });
      const runId = insertRun({ definitionId: defId, runSeq: 1, oosSharpe: 1.0 });

      const row = db.prepare(`
        SELECT p_value_bh_family_adjusted, statistical_verdict_family
        FROM signal_run WHERE id = ?
      `).get(runId) as {
        p_value_bh_family_adjusted: number | null;
        statistical_verdict_family: string | null;
      };
      expect(row.p_value_bh_family_adjusted).toBeNull();
      expect(row.statistical_verdict_family).toBeNull();
    });

    // S2: CHECK constraint on statistical_verdict_family rejects bad values.
    it('S2: statistical_verdict_family CHECK constraint rejects bad values', async () => {
      await new MigrationManager(db).migrate();

      const defId = insertDef({
        userId: 'u1', templateId: 'hmm_regime_v1', fingerprint: 'fp_check',
      });

      const upd = db.prepare(
        `UPDATE signal_run SET statistical_verdict_family = ? WHERE id = ?`
      );

      const runOk = insertRun({ definitionId: defId, runSeq: 1, oosSharpe: 1.0 });
      for (const ok of ['significant', 'marginal', 'not_significant', 'insufficient_data']) {
        expect(() => upd.run(ok, runOk)).not.toThrow();
      }
      expect(() => upd.run('bogus', runOk)).toThrow(/CHECK/);
    });

    // Both migrations recorded exactly once.
    it('v57 and v58 are each applied exactly once', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();
      await manager.migrate();
      await manager.migrate();

      const applied = db
        .prepare('SELECT version FROM schema_version WHERE version IN (57, 58) ORDER BY version')
        .all() as Array<{ version: number }>;
      expect(applied.map(r => r.version)).toEqual([57, 58]);
    });

    // v57 down/up cycle: dropping and recreating the VIEW must be safe.
    it('v57 VIEW is recreated cleanly on re-apply (DROP IF EXISTS guard)', async () => {
      await new MigrationManager(db).migrate();

      // Drop manually and re-run the v57 up SQL inline to simulate a repair.
      db.exec('DROP VIEW IF EXISTS signal_definition_rollup');
      db.exec(`
        CREATE VIEW signal_definition_rollup AS
        SELECT d.id AS definition_id, COUNT(r.id) AS run_count
        FROM nona_signal_definition d
        LEFT JOIN signal_run r
          ON r.definition_id = d.id AND r.status = 'ok' AND r.deleted_at IS NULL
        WHERE d.deleted_at IS NULL
        GROUP BY d.id
      `);

      const view = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='view' AND name='signal_definition_rollup'"
      ).get() as { name: string } | undefined;
      expect(view?.name).toBe('signal_definition_rollup');
    });
  });

  // TICKET_805_2: plugin_telemetry_state table (v59) -- persists once-only
  // emit timestamps for marketplace.promo.first_run and marketplace.promo.converted.
  describe('TICKET_805_2: plugin_telemetry_state table (v59)', () => {
    const tableExists = (name: string): boolean => {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(name) as { name?: string } | undefined;
      return !!row?.name;
    };
    const columnNames = (table: string): string[] => {
      return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
        .map(r => r.name);
    };

    it('creates plugin_telemetry_state with plugin_id PK + two nullable INTEGER columns', async () => {
      await new MigrationManager(db).migrate();
      expect(tableExists('plugin_telemetry_state')).toBe(true);

      const cols = columnNames('plugin_telemetry_state');
      expect(cols).toEqual(
        expect.arrayContaining(['plugin_id', 'first_run_emitted_at', 'install_with_promo_at']),
      );

      const info = db.prepare('PRAGMA table_info(plugin_telemetry_state)').all() as Array<{
        name: string;
        type: string;
        notnull: number;
        pk: number;
      }>;
      const pluginIdCol = info.find(c => c.name === 'plugin_id');
      expect(pluginIdCol?.pk).toBe(1);
      const firstRunCol = info.find(c => c.name === 'first_run_emitted_at');
      expect(firstRunCol?.type.toUpperCase()).toBe('INTEGER');
      expect(firstRunCol?.notnull).toBe(0);
      const installCol = info.find(c => c.name === 'install_with_promo_at');
      expect(installCol?.type.toUpperCase()).toBe('INTEGER');
      expect(installCol?.notnull).toBe(0);
    });

    it('records v59 in schema_version exactly once on repeated migrate() calls', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();
      await manager.migrate();
      await manager.migrate();

      const applied = db
        .prepare('SELECT COUNT(*) AS n FROM schema_version WHERE version = 59')
        .get() as { n: number };
      expect(applied.n).toBe(1);
    });
  });

  describe('TICKET_880_5: user_universe + user_universe_symbol + curated seed (v77)', () => {
    it('creates both tables and seeds 9 universes with correct symbol counts (post-v78 expansion)', async () => {
      await new MigrationManager(db).migrate();

      const tableExists = (name: string): boolean => {
        const row = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
          .get(name) as { name?: string } | undefined;
        return !!row?.name;
      };
      expect(tableExists('user_universe')).toBe(true);
      expect(tableExists('user_universe_symbol')).toBe(true);

      const universeCount = db
        .prepare('SELECT COUNT(*) AS n FROM user_universe')
        .get() as { n: number };
      expect(universeCount.n).toBe(9);

      // v77 seeds 1132, v78 adds 15*2 sp500_top50 + 10*1 crypto_top50 = 1172
      const symbolCount = db
        .prepare('SELECT COUNT(*) AS n FROM user_universe_symbol')
        .get() as { n: number };
      expect(symbolCount.n).toBe(1172);
    });

    it('seeds correct universe-provider combinations', async () => {
      await new MigrationManager(db).migrate();

      const rows = db
        .prepare('SELECT name, provider, based_on AS basedOn FROM user_universe ORDER BY name, provider')
        .all() as Array<{ name: string; provider: string; basedOn: string }>;

      expect(rows).toEqual([
        { name: 'crypto_top50',   provider: 'ccxt',      basedOn: 'crypto_top50' },
        { name: 'g10_fx',         provider: 'dukascopy', basedOn: 'g10_fx' },
        { name: 'g10_fx',         provider: 'yfinance',  basedOn: 'g10_fx' },
        { name: 'sp500_top50',    provider: 'alpaca',    basedOn: 'sp500_top50' },
        { name: 'sp500_top50',    provider: 'yfinance',  basedOn: 'sp500_top50' },
        { name: 'sp500_top500',   provider: 'alpaca',    basedOn: 'sp500_top500' },
        { name: 'sp500_top500',   provider: 'yfinance',  basedOn: 'sp500_top500' },
        { name: 'us_sector_etfs', provider: 'alpaca',    basedOn: 'us_sector_etfs' },
        { name: 'us_sector_etfs', provider: 'yfinance',  basedOn: 'us_sector_etfs' },
      ]);
    });

    it('records v77 in schema_version exactly once', async () => {
      const manager = new MigrationManager(db);
      await manager.migrate();
      await manager.migrate();

      const applied = db
        .prepare('SELECT COUNT(*) AS n FROM schema_version WHERE version = 77')
        .get() as { n: number };
      expect(applied.n).toBe(1);
    });
  });

  describe('TICKET_880_5_11: overselection target_size + candidate pool expansion (v78)', () => {
    it('adds target_size column to user_universe', async () => {
      await new MigrationManager(db).migrate();

      const columns = db
        .prepare("PRAGMA table_info('user_universe')")
        .all() as Array<{ name: string; type: string }>;
      const targetSizeCol = columns.find(c => c.name === 'target_size');
      expect(targetSizeCol).toBeDefined();
      expect(targetSizeCol!.type).toBe('INTEGER');
    });

    it('sp500_top50 universes have 65 symbols and target_size=50', async () => {
      await new MigrationManager(db).migrate();

      const sp500Rows = db
        .prepare("SELECT id, target_size FROM user_universe WHERE based_on = 'sp500_top50'")
        .all() as Array<{ id: number; target_size: number | null }>;

      expect(sp500Rows.length).toBe(2); // yfinance + alpaca
      for (const row of sp500Rows) {
        expect(row.target_size).toBe(50);

        const symbolCount = db
          .prepare('SELECT COUNT(*) AS n FROM user_universe_symbol WHERE universe_id = ?')
          .get(row.id) as { n: number };
        expect(symbolCount.n).toBe(65); // 50 original + 15 extra
      }
    });

    it('crypto_top50 universe has 40 pairs and target_size=30', async () => {
      await new MigrationManager(db).migrate();

      const cryptoRows = db
        .prepare("SELECT id, target_size FROM user_universe WHERE based_on = 'crypto_top50'")
        .all() as Array<{ id: number; target_size: number | null }>;

      expect(cryptoRows.length).toBe(1); // ccxt only
      expect(cryptoRows[0].target_size).toBe(30);

      const symbolCount = db
        .prepare('SELECT COUNT(*) AS n FROM user_universe_symbol WHERE universe_id = ?')
        .get(cryptoRows[0].id) as { n: number };
      expect(symbolCount.n).toBe(40); // 30 original + 10 extra
    });

    it('other universes have target_size=NULL (no overselection)', async () => {
      await new MigrationManager(db).migrate();

      const otherRows = db
        .prepare(
          "SELECT name, provider, target_size FROM user_universe " +
          "WHERE based_on NOT IN ('sp500_top50', 'crypto_top50')",
        )
        .all() as Array<{ name: string; provider: string; target_size: number | null }>;

      for (const row of otherRows) {
        expect(row.target_size).toBeNull();
      }
    });

    it('extra sp500 symbols are the correct 15 next-tier names', async () => {
      await new MigrationManager(db).migrate();

      const expected = ['TXN','VZ','GS','DHR','BKNG','NEE','RTX','SPGI','T','AMGN',
        'PFE','UBER','LOW','HON','UNP'];

      const sp500 = db
        .prepare("SELECT id FROM user_universe WHERE based_on = 'sp500_top50' LIMIT 1")
        .get() as { id: number };

      const symbols = db
        .prepare('SELECT symbol FROM user_universe_symbol WHERE universe_id = ? ORDER BY symbol')
        .all(sp500.id) as Array<{ symbol: string }>;

      const symbolSet = new Set(symbols.map(r => r.symbol));
      for (const s of expected) {
        expect(symbolSet.has(s)).toBe(true);
      }
    });

    it('records v78 in schema_version', async () => {
      await new MigrationManager(db).migrate();

      const applied = db
        .prepare('SELECT COUNT(*) AS n FROM schema_version WHERE version = 78')
        .get() as { n: number };
      expect(applied.n).toBe(1);
    });
  });

  describe('TICKET_880_5_9_5: trained/requested symbol count columns (v79)', () => {
    it('adds trained_symbol_count and requested_symbol_count to signal_scoreboard', async () => {
      await new MigrationManager(db).migrate();

      const columns = db
        .prepare("PRAGMA table_info('signal_scoreboard')")
        .all() as Array<{ name: string; type: string; notnull: number }>;

      const trained = columns.find(c => c.name === 'trained_symbol_count');
      expect(trained).toBeDefined();
      expect(trained!.type).toBe('INTEGER');
      expect(trained!.notnull).toBe(0);

      const requested = columns.find(c => c.name === 'requested_symbol_count');
      expect(requested).toBeDefined();
      expect(requested!.type).toBe('INTEGER');
      expect(requested!.notnull).toBe(0);
    });

    it('adds trained_symbol_count and requested_symbol_count to signal_run', async () => {
      await new MigrationManager(db).migrate();

      const columns = db
        .prepare("PRAGMA table_info('signal_run')")
        .all() as Array<{ name: string; type: string; notnull: number }>;

      const trained = columns.find(c => c.name === 'trained_symbol_count');
      expect(trained).toBeDefined();
      expect(trained!.type).toBe('INTEGER');
      expect(trained!.notnull).toBe(0);

      const requested = columns.find(c => c.name === 'requested_symbol_count');
      expect(requested).toBeDefined();
      expect(requested!.type).toBe('INTEGER');
      expect(requested!.notnull).toBe(0);
    });

    it('existing rows default to NULL for both columns', async () => {
      await new MigrationManager(db).migrate();

      db.exec(`
        INSERT INTO signal_scoreboard (algo_id, computed_at, window_bars, mode, score)
        VALUES ('test-algo', 1000, 500, 'tool_sweep_hmm', 0.5)
      `);

      const row = db
        .prepare('SELECT trained_symbol_count, requested_symbol_count FROM signal_scoreboard WHERE algo_id = ?')
        .get('test-algo') as { trained_symbol_count: number | null; requested_symbol_count: number | null };

      expect(row.trained_symbol_count).toBeNull();
      expect(row.requested_symbol_count).toBeNull();
    });

    it('accepts explicit symbol count values on INSERT', async () => {
      await new MigrationManager(db).migrate();

      db.exec(`
        INSERT INTO signal_scoreboard
          (algo_id, computed_at, window_bars, mode, score, trained_symbol_count, requested_symbol_count)
        VALUES ('test-algo-2', 2000, 500, 'tool_sweep_hmm', 0.7, 37, 50)
      `);

      const row = db
        .prepare('SELECT trained_symbol_count, requested_symbol_count FROM signal_scoreboard WHERE algo_id = ?')
        .get('test-algo-2') as { trained_symbol_count: number; requested_symbol_count: number };

      expect(row.trained_symbol_count).toBe(37);
      expect(row.requested_symbol_count).toBe(50);
    });

    it('records v79 in schema_version exactly once', async () => {
      await new MigrationManager(db).migrate();
      await new MigrationManager(db).migrate();

      const applied = db
        .prepare('SELECT COUNT(*) AS n FROM schema_version WHERE version = 79')
        .get() as { n: number };
      expect(applied.n).toBe(1);
    });
  });
});
