/**
 * Policy-free local strategy CRUD shared by the renderer IPC and Service API.
 *
 * Strategy generation remains in the commercial strategy-api adapter. This
 * module owns only offline operations backed by the public persistence store.
 */

import { getDatabaseManager } from '../../database/db-manager';
import { mainT } from '../../i18n/main-strings';
import { getCurrentMainLocale } from '../locale-service';
import type { ApiResponse } from './types';
import {
  getStrategy as getStrategyFromStore,
  listStrategies as listStrategiesFromStore,
  softDeleteStrategy,
  SoftDeleteStrategyError,
} from '@StratCraft/strategy-persistence-store';

export interface DeleteStrategyResult {
  deleted_count: number;
  deleted_ids: number[];
}

export async function listStrategies(limit = 50): Promise<ApiResponse<unknown[]>> {
  try {
    const rows = listStrategiesFromStore(getDatabaseManager(), { limit });
    return { success: true, data: rows };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function deleteStrategy(params: {
  id?: number;
  strategy_type?: number;
  signal_source_prefix?: string;
}): Promise<ApiResponse<DeleteStrategyResult>> {
  const hasId = params.id !== undefined;
  const hasFilter = params.strategy_type !== undefined || params.signal_source_prefix !== undefined;

  if (hasId && hasFilter) {
    return { success: false, error: 'Cannot combine id with strategy_type/signal_source_prefix. Use one mode.' };
  }
  if (!hasId && !hasFilter) {
    return { success: false, error: 'Provide either id (single delete) or strategy_type/signal_source_prefix (batch delete).' };
  }
  if (hasId && (!Number.isInteger(params.id) || params.id! <= 0)) {
    return { success: false, error: 'id must be a positive integer.' };
  }

  try {
    const db = getDatabaseManager();
    const result = hasId
      ? softDeleteStrategy(db, { mode: 'id', id: params.id! })
      : softDeleteStrategy(db, {
          mode: 'filter',
          strategyType: params.strategy_type,
          signalSourcePrefix: params.signal_source_prefix,
        });
    return {
      success: true,
      data: { deleted_count: result.deletedCount, deleted_ids: result.deletedIds },
    };
  } catch (error) {
    if (error instanceof SoftDeleteStrategyError) {
      return { success: false, error: error.message };
    }
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getStrategy(id: number): Promise<ApiResponse<unknown>> {
  try {
    const row = getStrategyFromStore(getDatabaseManager(), id);
    if (!row) {
      return {
        success: false,
        error: mainT(
          getCurrentMainLocale(),
          'errors',
          'main.backtestApi.strategyNotFound',
          { id },
        ),
      };
    }
    return { success: true, data: row };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
