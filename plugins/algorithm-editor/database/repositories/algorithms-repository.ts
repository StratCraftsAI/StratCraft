import { DatabaseManager } from '@StratCraft/desktop/database/db-manager';

/**
 * Algorithm entity - matches algorithms table schema
 *
 * See: plugins/algorithm-editor/database/schema/001_initial.sql
 */
export interface Algorithm {
  id: number;
  code: string;
  file_path: string | null;
  strategy_name: string | null;
  description: string | null;
  strategy_type: number; // 0-9
  classification_metadata: string | null; // JSON
  record_type: 'indicator' | 'strategy';
  category: string | null;
  metadata: string | null; // JSON
  pnl: string;
  user_id: string | null;
  is_system: number; // 0 or 1
  status: number; // 0 or 1
  activate: number; // 0 or 1
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

/**
 * Input for creating new algorithm
 */
export interface CreateAlgorithmInput {
  code: string;
  file_path?: string;
  strategy_name?: string;
  description?: string;
  strategy_type?: number;
  classification_metadata?: object | string;
  record_type?: 'indicator' | 'strategy';
  category?: string;
  metadata?: object | string;
  user_id?: string;
  is_system?: number;
  pnl?: string;
  status?: number;
  activate?: number;
}

/**
 * Input for updating algorithm
 */
export type UpdateAlgorithmInput = Partial<CreateAlgorithmInput>;

/**
 * AlgorithmsRepository - Plugin-owned repository for algorithm data
 *
 * This repository operates on the algorithm-editor plugin's isolated database.
 * Each plugin gets its own .db file via DatabaseService.
 *
 * See: TICKET_110_PLUGIN_DATABASE_INFRASTRUCTURE.md
 */
export class AlgorithmsRepository {
  constructor(private db: DatabaseManager) {}

  /**
   * Find algorithm by ID
   */
  findById(id: number): Algorithm | null {
    const stmt = this.db.prepare<[number]>('SELECT * FROM algorithms WHERE id = ?');
    const result = stmt.get(id) as Algorithm | undefined;
    return result || null;
  }

  /**
   * Find all algorithms for a specific user
   */
  findByUserId(userId: string): Algorithm[] {
    const stmt = this.db.prepare<[string]>(
      'SELECT * FROM algorithms WHERE user_id = ? ORDER BY created_at DESC'
    );
    return stmt.all(userId) as Algorithm[];
  }

  /**
   * Find algorithms by strategy type
   */
  findByType(strategyType: number, userId?: string): Algorithm[] {
    let sql = 'SELECT * FROM algorithms WHERE strategy_type = ?';
    const params: unknown[] = [strategyType];

    if (userId) {
      sql += ' AND user_id = ?';
      params.push(userId);
    }

    sql += ' ORDER BY created_at DESC';

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as Algorithm[];
  }

  /**
   * Find active algorithms
   */
  findActive(userId?: string): Algorithm[] {
    let sql = 'SELECT * FROM algorithms WHERE status = 1 AND activate = 1';
    const params: unknown[] = [];

    if (userId) {
      sql += ' AND user_id = ?';
      params.push(userId);
    }

    sql += ' ORDER BY created_at DESC';

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as Algorithm[];
  }

  /**
   * Find system algorithms
   */
  findSystemAlgorithms(): Algorithm[] {
    const stmt = this.db.prepare(
      'SELECT * FROM algorithms WHERE is_system = 1 ORDER BY strategy_type, strategy_name'
    );
    return stmt.all() as Algorithm[];
  }

  /**
   * Search algorithms by name or description
   */
  search(query: string, userId?: string): Algorithm[] {
    let sql = `
      SELECT * FROM algorithms
      WHERE (strategy_name LIKE ? OR description LIKE ?)
    `;
    const likeQuery = `%${query}%`;
    const params: unknown[] = [likeQuery, likeQuery];

    if (userId) {
      sql += ' AND user_id = ?';
      params.push(userId);
    }

    sql += ' ORDER BY created_at DESC';

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as Algorithm[];
  }

  /**
   * Create new algorithm
   */
  create(input: CreateAlgorithmInput): Algorithm {
    const stmt = this.db.prepare(`
      INSERT INTO algorithms (
        code, file_path, strategy_name, description, strategy_type,
        classification_metadata, record_type, category, metadata, pnl,
        user_id, is_system, status, activate
      ) VALUES (
        @code, @file_path, @strategy_name, @description, @strategy_type,
        @classification_metadata, @record_type, @category, @metadata, @pnl,
        @user_id, @is_system, @status, @activate
      )
    `);

    const params = {
      code: input.code,
      file_path: input.file_path || null,
      strategy_name: input.strategy_name || null,
      description: input.description || null,
      strategy_type: input.strategy_type ?? 0,
      classification_metadata: this.serializeJson(input.classification_metadata),
      record_type: input.record_type || 'strategy',
      category: input.category || null,
      metadata: this.serializeJson(input.metadata),
      pnl: input.pnl || '0.00',
      user_id: input.user_id || null,
      is_system: input.is_system ?? 0,
      status: input.status ?? 1,
      activate: input.activate ?? 1,
    };

    const result = stmt.run(params);
    const id = result.lastInsertRowid as number;

    const created = this.findById(id);
    if (!created) {
      throw new Error(`Failed to retrieve created algorithm with ID ${id}`);
    }

    return created;
  }

  /**
   * Update existing algorithm
   */
  update(id: number, input: UpdateAlgorithmInput): Algorithm | null {
    const updates: string[] = [];
    const params: Record<string, unknown> = { id };

    if (input.code !== undefined) {
      updates.push('code = @code');
      params.code = input.code;
    }
    if (input.file_path !== undefined) {
      updates.push('file_path = @file_path');
      params.file_path = input.file_path;
    }
    if (input.strategy_name !== undefined) {
      updates.push('strategy_name = @strategy_name');
      params.strategy_name = input.strategy_name;
    }
    if (input.description !== undefined) {
      updates.push('description = @description');
      params.description = input.description;
    }
    if (input.strategy_type !== undefined) {
      updates.push('strategy_type = @strategy_type');
      params.strategy_type = input.strategy_type;
    }
    if (input.classification_metadata !== undefined) {
      updates.push('classification_metadata = @classification_metadata');
      params.classification_metadata = this.serializeJson(input.classification_metadata);
    }
    if (input.record_type !== undefined) {
      updates.push('record_type = @record_type');
      params.record_type = input.record_type;
    }
    if (input.category !== undefined) {
      updates.push('category = @category');
      params.category = input.category;
    }
    if (input.metadata !== undefined) {
      updates.push('metadata = @metadata');
      params.metadata = this.serializeJson(input.metadata);
    }
    if (input.pnl !== undefined) {
      updates.push('pnl = @pnl');
      params.pnl = input.pnl;
    }
    if (input.status !== undefined) {
      updates.push('status = @status');
      params.status = input.status;
    }
    if (input.activate !== undefined) {
      updates.push('activate = @activate');
      params.activate = input.activate;
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    const stmt = this.db.prepare(`
      UPDATE algorithms
      SET ${updates.join(', ')}
      WHERE id = @id
    `);

    stmt.run(params);
    return this.findById(id);
  }

  /**
   * Delete algorithm by ID
   */
  delete(id: number): boolean {
    const stmt = this.db.prepare('DELETE FROM algorithms WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Count algorithms
   */
  count(userId?: string): number {
    let sql = 'SELECT COUNT(*) as count FROM algorithms';
    const params: unknown[] = [];

    if (userId) {
      sql += ' WHERE user_id = ?';
      params.push(userId);
    }

    const stmt = this.db.prepare(sql);
    const result = stmt.get(...params) as { count: number } | undefined;
    return result?.count || 0;
  }

  /**
   * Get all algorithms (with optional limit)
   */
  findAll(limit?: number, offset?: number): Algorithm[] {
    let sql = 'SELECT * FROM algorithms ORDER BY created_at DESC';

    if (limit !== undefined) {
      sql += ` LIMIT ${limit}`;
      if (offset !== undefined) {
        sql += ` OFFSET ${offset}`;
      }
    }

    const stmt = this.db.prepare(sql);
    return stmt.all() as Algorithm[];
  }

  /**
   * Helper: Serialize object to JSON string
   */
  private serializeJson(value: object | string | null | undefined): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string') {
      return value;
    }
    return JSON.stringify(value);
  }
}
