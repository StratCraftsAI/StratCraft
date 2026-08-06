/**
 * StartupAuditService - Service layer for startup_audit table
 *
 * TICKET_560_2: Startup Check Audit Persistence
 *
 * Handles:
 * - Inserting audit records after each app launch
 * - Querying the latest audit record
 * - Listing recent audit records
 */

import { DatabaseManager } from '../db-manager';
import { dbLog } from '../../utils/logger';
import {
  StartupAuditStore,
  type StartupAuditRecord,
  type SqliteDatabase,
} from '@StratCraft/user-data-store';

// ============================================================================
// Types
// ============================================================================

export interface StartupAuditInsertData {
  session_id: string;

  // Migration-561 results
  migration_561_status?: string;
  migration_561_dirs_copied?: number;
  migration_561_files_copied?: number;
  migration_561_files_skipped?: number;
  migration_561_error?: string;

  // Database init
  db_schema_version?: number;
  db_migrations_applied?: number;
  db_integrity_ok?: number;
  db_recovery_attempted?: number;

  // Plugin discovery
  plugins_discovered?: number;
  plugins_loaded?: number;
  plugins_failed?: string; // JSON array of failed plugin IDs

  // Environment
  python_path?: string;
  executor_available?: number;
  node_version?: string;
  electron_version?: string;
  platform?: string;

  // Timing
  startup_duration_ms?: number;
  phase_durations?: string; // JSON

  // Overall
  status: string;
  warnings?: string | null; // JSON array
}

export type { StartupAuditRecord };

// ============================================================================
// Service
// ============================================================================

export class StartupAuditService {
  private readonly readStore: StartupAuditStore;

  constructor(private db: DatabaseManager) {
    this.readStore = new StartupAuditStore(db as unknown as SqliteDatabase);
  }

  /**
   * Insert a new startup audit record.
   */
  insertAudit(data: StartupAuditInsertData): number {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO startup_audit (
          session_id,
          migration_561_status, migration_561_dirs_copied, migration_561_files_copied,
          migration_561_files_skipped, migration_561_error,
          db_schema_version, db_migrations_applied, db_integrity_ok, db_recovery_attempted,
          plugins_discovered, plugins_loaded, plugins_failed,
          python_path, executor_available, node_version, electron_version, platform,
          startup_duration_ms, phase_durations,
          status, warnings
        ) VALUES (
          @session_id,
          @migration_561_status, @migration_561_dirs_copied, @migration_561_files_copied,
          @migration_561_files_skipped, @migration_561_error,
          @db_schema_version, @db_migrations_applied, @db_integrity_ok, @db_recovery_attempted,
          @plugins_discovered, @plugins_loaded, @plugins_failed,
          @python_path, @executor_available, @node_version, @electron_version, @platform,
          @startup_duration_ms, @phase_durations,
          @status, @warnings
        )
      `);

      const params = {
        session_id: data.session_id,
        migration_561_status: data.migration_561_status ?? null,
        migration_561_dirs_copied: data.migration_561_dirs_copied ?? 0,
        migration_561_files_copied: data.migration_561_files_copied ?? 0,
        migration_561_files_skipped: data.migration_561_files_skipped ?? 0,
        migration_561_error: data.migration_561_error ?? null,
        db_schema_version: data.db_schema_version ?? null,
        db_migrations_applied: data.db_migrations_applied ?? 0,
        db_integrity_ok: data.db_integrity_ok ?? 1,
        db_recovery_attempted: data.db_recovery_attempted ?? 0,
        plugins_discovered: data.plugins_discovered ?? 0,
        plugins_loaded: data.plugins_loaded ?? 0,
        plugins_failed: data.plugins_failed ?? null,
        python_path: data.python_path ?? null,
        executor_available: data.executor_available ?? 0,
        node_version: data.node_version ?? null,
        electron_version: data.electron_version ?? null,
        platform: data.platform ?? null,
        startup_duration_ms: data.startup_duration_ms ?? null,
        phase_durations: data.phase_durations ?? null,
        status: data.status,
        warnings: data.warnings ?? null,
      };

      const info = stmt.run(params);
      const id = typeof info.lastInsertRowid === 'bigint'
        ? Number(info.lastInsertRowid)
        : info.lastInsertRowid;
      dbLog.info(`[StartupAuditService] Inserted startup audit id=${id}, session=${data.session_id}, status=${data.status}`);
      return id as number;
    } catch (error) {
      dbLog.error('[StartupAuditService] insertAudit failed:', error);
      throw error;
    }
  }

  /**
   * Get the most recent startup audit record.
   */
  getLatest(): StartupAuditRecord | null {
    try {
      return this.readStore.getLatest();
    } catch (error) {
      dbLog.error('[StartupAuditService] getLatest failed:', error);
      throw error;
    }
  }

  /**
   * List recent startup audit records.
   */
  list(limit: number = 20): StartupAuditRecord[] {
    try {
      return this.readStore.list(limit, 0);
    } catch (error) {
      dbLog.error('[StartupAuditService] list failed:', error);
      throw error;
    }
  }
}
