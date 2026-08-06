/**
 * Database IPC Handlers
 *
 * Provides simplified database access for component7 (WorkflowRowSelector).
 * Wraps the existing algorithm-handlers.ts (Hub Pattern) with a simpler API.
 *
 * Related:
 * - TICKET_077_COMPONENT7: Data Integration for WorkflowRowSelector
 * - TICKET_117_1: Unified Data Hub Pattern Design
 */

import { ipcMain } from 'electron';
import { getDatabaseManager } from '../database/db-manager';
import { AlgorithmService } from '../database/services/algorithm-service';
import { ipcLog } from '../utils/logger';

/**
 * Register database IPC handlers
 */
export function registerDatabaseHandlers(): void {
  const db = getDatabaseManager();
  const algorithmService = new AlgorithmService(db, 'v_algorithms_all');

  /**
   * database:getAlgorithms
   * Get algorithms filtered by strategy_type and/or signal_source prefix
   *
   * @param options.userId - Optional legacy user ID parameter, ignored for local machine-scoped queries
   * @param options.strategyType - Single type or array of types (e.g., 9 or [0,1,2,3])
   * @param options.signalSourcePrefix - TICKET_210: Filter by signal_source prefix (e.g., 'indicator_detector', 'indicator_entry')
   */
  ipcMain.handle('database:getAlgorithms', async (_event, options: {
    userId?: string;
    strategyType?: number | number[];
    signalSourcePrefix?: string;
  }) => {
    try {
      ipcLog.info('[Database] getAlgorithms called:', options);

      const { userId, strategyType, signalSourcePrefix } = options;

      // TICKET_210: Use signal_source filter if provided
      if (signalSourcePrefix) {
        const records = await algorithmService.getAlgorithmsBySignalSource(userId, {
          strategy_type: typeof strategyType === 'number' ? strategyType : undefined,
          signalSourcePrefix,
        });

        return {
          success: true,
          data: records.map(r => ({
            id: r.id,
            code: r.code,
            strategyName: r.strategy_name || '',
            strategyType: r.strategy_type,
            description: r.description,
            classificationMetadata: r.classification_metadata || null,
          })),
        };
      }

      // Handle single type
      if (typeof strategyType === 'number') {
        const records = await algorithmService.getAlgorithmsByUserId(userId, {
          strategy_type: strategyType,
        });

        return {
          success: true,
          data: records.map(r => ({
            id: r.id,
            code: r.code,
            strategyName: r.strategy_name || '',
            strategyType: r.strategy_type,
            description: r.description,
            classificationMetadata: r.classification_metadata || null,
          })),
        };
      }

      // Handle array of types
      if (Array.isArray(strategyType)) {
        // Query each type and combine results
        const allRecords = await Promise.all(
          strategyType.map(type =>
            algorithmService.getAlgorithmsByUserId(userId, {
              strategy_type: type,
            })
          )
        );

        const combined = allRecords.flat();

        return {
          success: true,
          data: combined.map(r => ({
            id: r.id,
            code: r.code,
            strategyName: r.strategy_name || '',
            strategyType: r.strategy_type,
            description: r.description,
            classificationMetadata: r.classification_metadata || null,
          })),
        };
      }

      // No filter - get all algorithms for user
      const records = await algorithmService.getAlgorithmsByUserId(userId);

      return {
        success: true,
        data: records.map(r => ({
          id: r.id,
          code: r.code,
          strategy_name: r.strategy_name || '',
          strategy_type: r.strategy_type,
          description: r.description,
          classification_metadata: r.classification_metadata || null,
        })),
      };
    } catch (error) {
      ipcLog.error('[Database] Failed to get algorithms:', error);
      return {
        success: false,
        error: {
          code: 'INTERNAL',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });

  ipcLog.info('[Database] Database handlers registered');
}
