/**
 * UniverseService
 *
 * TICKET_880_5_1: CRUD for `user_universe` + `user_universe_symbol` tables.
 * Backs the Universe Editor page and its IPC handlers.
 */

import { DatabaseManager } from '../db-manager';
import { dbLog } from '../../utils/logger';

export interface UniverseSummary {
  id: number;
  name: string;
  provider: string;
  basedOn: string | null;
  symbolCount: number;
  updatedAt: number;
  targetSize: number | null;
}

export interface UniverseDetail extends UniverseSummary {
  symbols: string[];
}

export class UniverseService {
  constructor(private db: DatabaseManager) {}

  list(provider: string): UniverseSummary[] {
    const stmt = this.db.prepare(`
      SELECT
        u.id,
        u.name,
        u.provider,
        u.based_on AS basedOn,
        u.updated_at AS updatedAt,
        u.target_size AS targetSize,
        COUNT(s.symbol) AS symbolCount
      FROM user_universe u
      LEFT JOIN user_universe_symbol s ON s.universe_id = u.id
      WHERE u.provider = ?
      GROUP BY u.id
      ORDER BY u.name
    `);
    return stmt.all(provider) as UniverseSummary[];
  }

  get(id: number): UniverseDetail | null {
    const meta = this.db.prepare(`
      SELECT
        u.id,
        u.name,
        u.provider,
        u.based_on AS basedOn,
        u.updated_at AS updatedAt,
        u.target_size AS targetSize
      FROM user_universe u
      WHERE u.id = ?
    `).get(id) as Omit<UniverseDetail, 'symbols' | 'symbolCount'> | undefined;

    if (!meta) return null;

    const symbols = this.db.prepare(`
      SELECT symbol FROM user_universe_symbol
      WHERE universe_id = ?
      ORDER BY symbol
    `).all(id) as { symbol: string }[];

    return {
      ...meta,
      symbolCount: symbols.length,
      symbols: symbols.map(r => r.symbol),
    };
  }

  create(params: { name: string; provider: string; symbols?: string[] }): { id: number } {
    const now = Date.now();

    const result = this.db.transaction(() => {
      const info = this.db.prepare(`
        INSERT INTO user_universe (name, provider, based_on, created_at, updated_at)
        VALUES (?, ?, NULL, ?, ?)
      `).run(params.name, params.provider, now, now);

      const universeId = Number(info.lastInsertRowid);

      if (params.symbols && params.symbols.length > 0) {
        const insert = this.db.prepare(`
          INSERT OR IGNORE INTO user_universe_symbol (universe_id, symbol, added_at)
          VALUES (?, ?, ?)
        `);
        for (const symbol of params.symbols) {
          insert.run(universeId, symbol, now);
        }
      }

      return { id: universeId };
    })();

    dbLog.info(`[UniverseService] Created universe '${params.name}' (provider=${params.provider}, id=${result.id})`);
    return result;
  }

  update(params: { id: number; name?: string; targetSize?: number | null }): void {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    if (params.name !== undefined) {
      sets.push('name = ?');
      values.push(params.name);
    }
    if (params.targetSize !== undefined) {
      sets.push('target_size = ?');
      values.push(params.targetSize);
    }
    if (sets.length === 0) return;
    const now = Date.now();
    sets.push('updated_at = ?');
    values.push(now);
    values.push(params.id);
    this.db.prepare(
      `UPDATE user_universe SET ${sets.join(', ')} WHERE id = ?`,
    ).run(...values);
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM user_universe WHERE id = ?').run(id);
    dbLog.info(`[UniverseService] Deleted universe id=${id}`);
  }

  addSymbols(params: { universeId: number; symbols: string[] }): void {
    if (params.symbols.length === 0) return;
    const now = Date.now();

    this.db.transaction(() => {
      const insert = this.db.prepare(`
        INSERT OR IGNORE INTO user_universe_symbol (universe_id, symbol, added_at)
        VALUES (?, ?, ?)
      `);
      for (const symbol of params.symbols) {
        insert.run(params.universeId, symbol, now);
      }
      this.db.prepare('UPDATE user_universe SET updated_at = ? WHERE id = ?')
        .run(now, params.universeId);
    })();
  }

  removeSymbols(params: { universeId: number; symbols: string[] }): void {
    if (params.symbols.length === 0) return;
    const now = Date.now();

    this.db.transaction(() => {
      const del = this.db.prepare(`
        DELETE FROM user_universe_symbol WHERE universe_id = ? AND symbol = ?
      `);
      for (const symbol of params.symbols) {
        del.run(params.universeId, symbol);
      }
      this.db.prepare('UPDATE user_universe SET updated_at = ? WHERE id = ?')
        .run(now, params.universeId);
    })();
  }
}
