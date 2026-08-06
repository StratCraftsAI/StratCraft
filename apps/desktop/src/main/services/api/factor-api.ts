/**
 * Factor Service API
 *
 * TICKET_425: Unified Service API Layer
 *
 * Read operations for nona_factors table.
 */

import { getDatabaseManager } from '../../database/db-manager';
import { ApiResponse } from './types';

export async function listFactors(limit: number = 50): Promise<ApiResponse<unknown[]>> {
  try {
    const db = getDatabaseManager();
    const rows = db.prepare(`
      SELECT id, factor_id, name, source, category, ic, sharpe, created_at
      FROM nona_factors
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit);
    return { success: true, data: rows };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
