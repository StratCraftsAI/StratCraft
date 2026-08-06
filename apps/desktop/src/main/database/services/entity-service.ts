/**
 * EntityService - Generic service layer for Data Hub entities
 * 
 * Provides base CRUD operations for any table in the framework database.
 * Used by the Unified Data Hub pattern to manage shared business data.
 * 
 * Related: TICKET_117_1 - Unified Data Hub Pattern Design
 */

import { DatabaseManager } from '../db-manager';
import { dbLog } from '../../utils/logger';

export interface EntityResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Generic Entity Service
 * 
 * Usage:
 * const algoService = new EntityService<AlgorithmRecord>(db, 'nona_algorithms');
 */
export class EntityService<T extends { id: number | string, version?: number }> {
  constructor(
    protected db: DatabaseManager,
    protected tableName: string
  ) {}

  /**
   * Tables that support optimistic locking (version column)
   */
  // TICKET_156: Removed nona_backtest_results (deprecated in V3)
  // TICKET_762: Added nona_signal (mirrors nona_algorithms schema)
  private static VERSIONED_TABLES = ['nona_algorithms', 'nona_signal', 'nona_factors'];

  /**
   * TICKET_580_6: Tables that use soft-delete (deleted_at column)
   * TICKET_762: Added nona_signal (mirrors nona_algorithms schema)
   */
  private static SOFT_DELETE_TABLES = ['nona_algorithms', 'nona_signal'];

  private isVersioned(): boolean {
    return EntityService.VERSIONED_TABLES.includes(this.tableName);
  }

  private isSoftDelete(): boolean {
    return EntityService.SOFT_DELETE_TABLES.includes(this.tableName);
  }

  /**
   * Execute operations in a transaction
   */
  async transaction<R>(fn: () => R): Promise<R> {
    return this.db.transaction(fn)();
  }

  /**
   * Save a new record (Async)
   */
  async save(data: Partial<T>): Promise<number | string> {
    return this.saveSync(data);
  }

  /**
   * Save a new record (Sync - for use in transactions)
   */
  saveSync(data: Partial<T>): number | string {
    try {
      // Ensure initial version is set ONLY if applicable
      const recordData = this.isVersioned() ? { ...data, version: 1 } : { ...data };
      
      const keys = Object.keys(recordData);
      const placeholders = keys.map(k => `@${k}`).join(', ');
      const columns = keys.join(', ');

      const query = `INSERT INTO ${this.tableName} (${columns}) VALUES (${placeholders})`;
      const stmt = this.db.prepare(query);
      const info = stmt.run(recordData as any);

      const id = typeof info.lastInsertRowid === 'bigint' 
        ? Number(info.lastInsertRowid) 
        : info.lastInsertRowid;
      
      dbLog.debug(`[EntityService:${this.tableName}] Saved record with id: ${id}`);
      return id;
    } catch (error) {
      dbLog.error(`[EntityService:${this.tableName}] Save failed:`, error);
      throw error;
    }
  }

  /**
   * Get record by ID (Async)
   */
  async get(id: number | string): Promise<T | null> {
    return this.getSync(id);
  }

  /**
   * Get record by ID (Sync)
   */
  getSync(id: number | string): T | null {
    try {
      const softDeleteFilter = this.isSoftDelete() ? ' AND deleted_at IS NULL' : '';
      const stmt = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE id = ?${softDeleteFilter}`);
      const result = stmt.get(id) as T | undefined;
      return result || null;
    } catch (error) {
      dbLog.error(`[EntityService:${this.tableName}] Get failed for id ${id}:`, error);
      throw error;
    }
  }

  /**
   * Find records with simple filters
   */
  async find(filters: Record<string, any> = {}, options: { limit?: number, offset?: number, orderBy?: string } = {}): Promise<T[]> {
    try {
      let query = `SELECT * FROM ${this.tableName}`;
      const params: Record<string, any> = {};
      const clauses: string[] = [];

      // TICKET_580_6: Exclude soft-deleted records
      if (this.isSoftDelete()) {
        clauses.push('deleted_at IS NULL');
      }

      const filterKeys = Object.keys(filters);
      for (const k of filterKeys) {
        params[k] = filters[k];
        clauses.push(`${k} = @${k}`);
      }

      if (clauses.length > 0) {
        query += ` WHERE ${clauses.join(' AND ')}`;
      }

      if (options.orderBy) {
        query += ` ORDER BY ${options.orderBy}`;
      }

      if (options.limit) {
        query += ` LIMIT @limit`;
        params.limit = options.limit;
      }

      if (options.offset) {
        query += ` OFFSET @offset`;
        params.offset = options.offset;
      }

      const stmt = this.db.prepare(query);
      return stmt.all(params) as T[];
    } catch (error) {
      dbLog.error(`[EntityService:${this.tableName}] Find failed:`, error);
      throw error;
    }
  }

  /**
   * Update record by ID (Async)
   */
  async update(id: number | string, data: Partial<T>, expectedVersion?: number): Promise<void> {
    return this.updateSync(id, data, expectedVersion);
  }

  /**
   * Update record by ID (Sync)
   */
  updateSync(id: number | string, data: Partial<T>, expectedVersion?: number): void {
    try {
      const updateData = { ...data };
      const keys = Object.keys(updateData);
      if (keys.length === 0) return;

      let query: string;
      const params: Record<string, any> = { ...updateData, id };

      if (expectedVersion !== undefined) {
        // Optimistic Locking: Check version and increment it
        const setClauses = [...keys.map(k => `${k} = @${k}`), 'version = version + 1'].join(', ');
        query = `UPDATE ${this.tableName} SET ${setClauses} WHERE id = @id AND version = @expectedVersion`;
        params.expectedVersion = expectedVersion;
      } else {
        // Standard Update: Also increment version if column exists
        const setClauses = keys.map(k => `${k} = @${k}`).join(', ');
        query = `UPDATE ${this.tableName} SET ${setClauses} WHERE id = @id`;
      }
      
      const stmt = this.db.prepare(query);
      const info = stmt.run(params as any);
      
      if (info.changes === 0 && expectedVersion !== undefined) {
        throw new Error(`CONFLICT: Record ${id} was modified by another plugin or does not exist.`);
      }

      dbLog.debug(`[EntityService:${this.tableName}] Updated record with id: ${id}`);
    } catch (error) {
      dbLog.error(`[EntityService:${this.tableName}] Update failed for id ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete record by ID (Async)
   */
  async delete(id: number | string): Promise<void> {
    return this.deleteSync(id);
  }

  /**
   * Delete record by ID (Sync)
   * TICKET_580_6: For soft-delete tables, sets deleted_at instead of hard deleting.
   */
  deleteSync(id: number | string): void {
    try {
      if (this.isSoftDelete()) {
        const stmt = this.db.prepare(
          `UPDATE ${this.tableName} SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`
        );
        stmt.run(id);
        dbLog.debug(`[EntityService:${this.tableName}] Soft-deleted record with id: ${id}`);
      } else {
        const stmt = this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`);
        stmt.run(id);
        dbLog.debug(`[EntityService:${this.tableName}] Deleted record with id: ${id}`);
      }
    } catch (error) {
      dbLog.error(`[EntityService:${this.tableName}] Delete failed for id ${id}:`, error);
      throw error;
    }
  }

  /**
   * TICKET_580_6: Hard-delete record by ID (bypasses soft-delete).
   * Used for batch-generation dedup cleanup where permanent removal is needed.
   */
  hardDeleteSync(id: number | string): void {
    try {
      const stmt = this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`);
      stmt.run(id);
      dbLog.debug(`[EntityService:${this.tableName}] Hard-deleted record with id: ${id}`);
    } catch (error) {
      dbLog.error(`[EntityService:${this.tableName}] Hard delete failed for id ${id}:`, error);
      throw error;
    }
  }

  /**
   * TICKET_580_6: Hard-delete record by ID (async wrapper).
   */
  async hardDelete(id: number | string): Promise<void> {
    return this.hardDeleteSync(id);
  }

  /**
   * Count records
   */
  async count(filters: Record<string, any> = {}): Promise<number> {
    try {
      let query = `SELECT COUNT(*) as count FROM ${this.tableName}`;
      const params: Record<string, any> = {};
      const clauses: string[] = [];

      // TICKET_580_6: Exclude soft-deleted records
      if (this.isSoftDelete()) {
        clauses.push('deleted_at IS NULL');
      }

      const filterKeys = Object.keys(filters);
      for (const k of filterKeys) {
        params[k] = filters[k];
        clauses.push(`${k} = @${k}`);
      }

      if (clauses.length > 0) {
        query += ` WHERE ${clauses.join(' AND ')}`;
      }

      const stmt = this.db.prepare(query);
      const result = stmt.get(params) as { count: number };
      return result.count;
    } catch (error) {
      dbLog.error(`[EntityService:${this.tableName}] Count failed:`, error);
      throw error;
    }
  }
}
