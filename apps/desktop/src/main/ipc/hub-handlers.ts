/**
 * Hub Transaction IPC Handlers
 *
 * TICKET_132 Phase 5: Event bus and state management removed
 * Only database transaction support remains (platform feature)
 *
 * Related: TICKET_117_1 - Unified Data Hub Pattern
 */

import { ipcMain } from 'electron';
import { getEntitlementEnforcer } from '../services/entitlement-enforcer';
import { getDatabaseManager } from '../database/db-manager';
import { ipcLog } from '../utils/logger';
import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from '../services/locale-service';

export function registerHubMessagingHandlers(): void {
  const enforcer = getEntitlementEnforcer();
  const db = getDatabaseManager();

  // --- Transactions ---

  /**
   * hub:transaction
   * Execute multiple entity operations atomically
   */
  ipcMain.handle('hub:transaction', async (_event, operations: any[], pluginId = 'system') => {
    const { AlgorithmService } = require('../database/services/algorithm-service');
    const algoService = new AlgorithmService(db);
    
    // Mapper for entity services
    const getService = (entity: string) => {
      if (entity === 'nona_algorithm') return algoService;
      // Future: Add other services here
      throw new Error(mainT(getCurrentMainLocale(), 'errors', 'ipc.hub.unsupportedEntity', { entity }));
    };

    try {
      // 1. Pre-validate all permissions asynchronously before starting transaction
      // since better-sqlite3 transactions must be synchronous.
      for (const op of operations) {
        const { action, entity } = op;
        if (action === 'save' || action === 'update' || action === 'delete') {
          if (!await enforcer.canWriteHubEntity(pluginId, entity)) {
            throw new Error(mainT(getCurrentMainLocale(), 'errors', 'ipc.hub.permissionDenied', { pluginId, action, entity }));
          }
        } else {
          if (!await enforcer.canReadHubEntity(pluginId, entity)) {
            throw new Error(mainT(getCurrentMainLocale(), 'errors', 'ipc.hub.permissionDenied', { pluginId, action, entity }));
          }
        }
      }

      // 2. Execute synchronous transaction
      return db.transaction(() => {
        const results = [];
        for (const op of operations) {
          const { action, entity, payload, expectedVersion } = op;
          const service = getService(entity);
          let res;

          switch (action) {
            case 'save':
              // We use a non-async version or wrap the call if needed, 
              // but EntityService methods are async. 
              // Actually, better-sqlite3 is sync, so we should make 
              // a sync version of service methods for transactions.
              // For now, we call the underlying sync prepare/run.
              res = service.saveSync(payload);
              break;
            case 'update':
              res = service.updateSync(op.id, payload, expectedVersion);
              break;
            case 'delete':
              res = service.deleteSync(op.id);
              break;
            case 'get':
              res = service.getSync(op.id);
              break;
            default:
              throw new Error(mainT(getCurrentMainLocale(), 'errors', 'ipc.hub.unsupportedAction', { action }));
          }
          results.push({ action, entity, data: res });
        }
        return { success: true, data: results };
      })();
    } catch (error) {
      ipcLog.error('[Hub] Transaction failed:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcLog.info('[Hub] Transaction handlers registered');
}
