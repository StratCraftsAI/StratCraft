/**
 * Recycle Bin IPC Handlers
 *
 * TICKET_580_6: Soft-Delete / Recycle Bin (30-Day Retention)
 *
 * Handles:
 * - List soft-deleted records
 * - Restore soft-deleted records
 * - Permanently purge soft-deleted records
 */

import { ipcMain } from 'electron';
import { ipcLog } from '../utils/logger';
import { getSoftDeleteService, SOFT_DELETE_TABLES } from '../services/soft-delete-service';
import type { SoftDeleteTable } from '../services/soft-delete-service';

// Channel constants
const RECYCLE_BIN_CHANNELS = {
  LIST_DELETED: 'v3:recycle-bin:list-deleted',
  RESTORE: 'v3:recycle-bin:restore',
  PURGE: 'v3:recycle-bin:purge',
} as const;

export function registerRecycleBinHandlers(): void {
  // List soft-deleted records for a table
  ipcMain.handle(
    RECYCLE_BIN_CHANNELS.LIST_DELETED,
    async (_event, params: { table: string; limit?: number; offset?: number }) => {
      try {
        if (!params?.table || !SOFT_DELETE_TABLES.includes(params.table as SoftDeleteTable)) {
          return {
            success: false,
            errorMessage: `Invalid table. Valid tables: ${SOFT_DELETE_TABLES.join(', ')}`,
            i18nKey: 'recycleBin.validation.invalidTable',
            records: [],
          };
        }

        const service = getSoftDeleteService();
        const records = service.listDeleted(params.table, {
          limit: params.limit,
          offset: params.offset,
        });

        return { success: true, records };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        ipcLog.error('[RecycleBinHandlers] List deleted failed:', msg);
        return { success: false, errorMessage: msg, records: [] };
      }
    }
  );

  // Restore a soft-deleted record
  ipcMain.handle(
    RECYCLE_BIN_CHANNELS.RESTORE,
    async (_event, params: { table: string; id: number | string }) => {
      try {
        if (!params?.table || !params?.id) {
          return { success: false, errorMessage: 'Missing table or id parameter', i18nKey: 'recycleBin.validation.missingTableOrId' };
        }

        const service = getSoftDeleteService();
        service.restore(params.table, params.id);

        ipcLog.info(`[RecycleBinHandlers] Restored record ${params.id} in ${params.table}`);
        return { success: true };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        ipcLog.error('[RecycleBinHandlers] Restore failed:', msg);
        return { success: false, errorMessage: msg };
      }
    }
  );

  // Permanently purge a soft-deleted record
  ipcMain.handle(
    RECYCLE_BIN_CHANNELS.PURGE,
    async (_event, params: { table: string; id: number | string }) => {
      try {
        if (!params?.table || !params?.id) {
          return { success: false, errorMessage: 'Missing table or id parameter', i18nKey: 'recycleBin.validation.missingTableOrId' };
        }

        const service = getSoftDeleteService();
        service.purge(params.table, params.id);

        ipcLog.info(`[RecycleBinHandlers] Purged record ${params.id} from ${params.table}`);
        return { success: true };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        ipcLog.error('[RecycleBinHandlers] Purge failed:', msg);
        return { success: false, errorMessage: msg };
      }
    }
  );

  ipcLog.info('[RecycleBinHandlers] Recycle bin handlers registered');
}
