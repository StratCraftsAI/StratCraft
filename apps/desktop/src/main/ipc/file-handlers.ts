/**
 * File IPC Handlers
 * 
 * Implements the File Sharing Hub Pattern for cross-plugin file sharing.
 * Provides IPC interface for file registration, retrieval, and management.
 * 
 * Related: TICKET_117_2 - File Sharing Hub
 */

import { ipcMain } from 'electron';
import { getDatabaseManager } from '../database/db-manager';
import { FileService, type FileMetadata, type FileQuery } from '../database/services/file-service';
import { getEntitlementEnforcer } from '../services/entitlement-enforcer'; // TICKET_132 Week 3
import { sendToRenderer } from '../window'; // TICKET_132 Phase 5: Direct IPC, no event bus
import { ipcLog } from '../utils/logger';
import { initializeSharedDirectories } from '../utils/file-security';

/**
 * Register file IPC handlers
 */
export function registerFileHandlers(): void {
  const db = getDatabaseManager();
  const fileService = new FileService(db);
  const enforcer = getEntitlementEnforcer(); // TICKET_132 Week 3

  // Initialize shared directories
  initializeSharedDirectories();

  /**
   * entity:save:file:*
   * Register a new file
   */
  ipcMain.handle('entity:save:file:strategy', async (_event, data: FileMetadata, pluginId = 'system') => {
    return handleFileSave('strategy', data, pluginId);
  });

  ipcMain.handle('entity:save:file:data', async (_event, data: FileMetadata, pluginId = 'system') => {
    return handleFileSave('data', data, pluginId);
  });

  ipcMain.handle('entity:save:file:report', async (_event, data: FileMetadata, pluginId = 'system') => {
    return handleFileSave('report', data, pluginId);
  });

  ipcMain.handle('entity:save:file:config', async (_event, data: FileMetadata, pluginId = 'system') => {
    return handleFileSave('config', data, pluginId);
  });

  ipcMain.handle('entity:save:file:cache', async (_event, data: FileMetadata, pluginId = 'system') => {
    return handleFileSave('cache', data, pluginId);
  });

  async function handleFileSave(fileType: string, data: FileMetadata, pluginId: string) {
    try {
      // Permission Check
      const entityType = `file:${fileType}`;
      if (!await enforcer.canWriteHubEntity(pluginId, entityType)) {
        ipcLog.warn(`[Hub] Permission denied: ${pluginId} cannot write to ${entityType}`);
        return {
          success: false,
          error: { code: 'PERMISSION_DENIED', message: 'MSG_FILE_WRITE_DENIED' }
        };
      }

      // Ensure type matches
      data.type = fileType as any;

      const fileId = await fileService.registerFile(data, pluginId);

      // TICKET_132 Phase 5: Direct renderer notification
      sendToRenderer('entity:created:file', {
        id: fileId,
        name: data.name,
        type: fileType
      });

      return { success: true, data: fileId };
    } catch (error) {
      ipcLog.error('[Hub] Failed to register file:', error);
      return {
        success: false,
        error: {
          code: 'INTERNAL',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * entity:get:file:*
   * Get file metadata by ID
   */
  const handleFileGet = async (fileType: string, fileId: string, pluginId: string) => {
    try {
      // Permission Check
      const entityType = `file:${fileType}`;
      if (!await enforcer.canReadHubEntity(pluginId, entityType)) {
        ipcLog.warn(`[Hub] Permission denied: ${pluginId} cannot read from ${entityType}`);
        return {
          success: false,
          error: { code: 'PERMISSION_DENIED', message: 'MSG_FILE_READ_DENIED' }
        };
      }

      const record = await fileService.get(fileId);
      if (!record) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'MSG_FILE_NOT_FOUND' },
        };
      }

      // Verify type matches
      if (record.type !== fileType) {
        return {
          success: false,
          error: { code: 'TYPE_MISMATCH', message: 'MSG_FILE_TYPE_MISMATCH' },
        };
      }

      return { success: true, data: record };
    } catch (error) {
      ipcLog.error('[Hub] Failed to get file:', error);
      return {
        success: false,
        error: {
          code: 'INTERNAL',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  };

  ipcMain.handle('entity:get:file:strategy', async (_event, fileId: string, pluginId = 'system') => {
    return handleFileGet('strategy', fileId, pluginId);
  });

  ipcMain.handle('entity:get:file:data', async (_event, fileId: string, pluginId = 'system') => {
    return handleFileGet('data', fileId, pluginId);
  });

  ipcMain.handle('entity:get:file:report', async (_event, fileId: string, pluginId = 'system') => {
    return handleFileGet('report', fileId, pluginId);
  });

  ipcMain.handle('entity:get:file:config', async (_event, fileId: string, pluginId = 'system') => {
    return handleFileGet('config', fileId, pluginId);
  });

  ipcMain.handle('entity:get:file:cache', async (_event, fileId: string, pluginId = 'system') => {
    return handleFileGet('cache', fileId, pluginId);
  });

  /**
   * hub:file:find
   * Find files by query
   */
  ipcMain.handle('hub:file:find', async (_event, query: FileQuery, pluginId = 'system') => {
    try {
      // Permission check for the file type if specified
      if (query.type) {
        const entityType = `file:${query.type}`;
        if (!await enforcer.canReadHubEntity(pluginId, entityType)) {
          ipcLog.warn(`[Hub] Permission denied: ${pluginId} cannot read from ${entityType}`);
          return {
            success: false,
            error: { code: 'PERMISSION_DENIED', message: 'MSG_FILE_READ_DENIED' }
          };
        }
      }

      const records = await fileService.findFiles(query);
      return { success: true, data: records };
    } catch (error) {
      ipcLog.error('[Hub] Failed to find files:', error);
      return {
        success: false,
        error: {
          code: 'INTERNAL',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });

  /**
   * hub:file:resolve
   * Get file content or path
   */
  ipcMain.handle('hub:file:resolve', async (_event, fileId: string, pluginId = 'system') => {
    try {
      // Get file record first to check permissions
      const record = await fileService.get(fileId);
      if (!record) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'MSG_FILE_NOT_FOUND' },
        };
      }

      // Permission Check
      const entityType = `file:${record.type}`;
      if (!await enforcer.canReadHubEntity(pluginId, entityType)) {
        ipcLog.warn(`[Hub] Permission denied: ${pluginId} cannot resolve ${entityType}`);
        return {
          success: false,
          error: { code: 'PERMISSION_DENIED', message: 'MSG_FILE_READ_DENIED' }
        };
      }

      const resolved = await fileService.resolveFile(fileId);
      return { success: true, data: resolved };
    } catch (error) {
      ipcLog.error('[Hub] Failed to resolve file:', error);
      return {
        success: false,
        error: {
          code: 'INTERNAL',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });

  /**
   * hub:file:remove
   * Remove file registration and optionally delete physical file
   */
  ipcMain.handle('hub:file:remove', async (_event, { fileId, deleteFile }: { fileId: string, deleteFile?: boolean }, pluginId = 'system') => {
    try {
      // Get file record first to check permissions
      const record = await fileService.get(fileId);
      if (!record) {
        return {
          success: false,
          error: { code: 'NOT_FOUND', message: 'MSG_FILE_NOT_FOUND' },
        };
      }

      // Permission Check - need write permission to remove
      const entityType = `file:${record.type}`;
      if (!await enforcer.canWriteHubEntity(pluginId, entityType)) {
        ipcLog.warn(`[Hub] Permission denied: ${pluginId} cannot remove ${entityType}`);
        return {
          success: false,
          error: { code: 'PERMISSION_DENIED', message: 'MSG_FILE_WRITE_DENIED' }
        };
      }

      await fileService.removeFile(fileId, deleteFile !== false);

      // TICKET_132 Phase 5: Direct renderer notification
      sendToRenderer('entity:removed:file', { id: fileId });

      return { success: true, data: null };
    } catch (error) {
      ipcLog.error('[Hub] Failed to remove file:', error);
      return {
        success: false,
        error: {
          code: 'INTERNAL',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });

  /**
   * hub:file:cleanup
   * System-only: cleanup orphaned files
   */
  ipcMain.handle('hub:file:cleanup', async (_event, pluginId = 'system') => {
    try {
      if (pluginId !== 'system') {
        return {
          success: false,
          error: { code: 'PERMISSION_DENIED', message: 'MSG_FILE_SYSTEM_ONLY' }
        };
      }

      const count = await fileService.cleanupOrphanedFiles();
      return { success: true, data: { cleanedCount: count } };
    } catch (error) {
      ipcLog.error('[Hub] Failed to cleanup files:', error);
      return {
        success: false,
        error: {
          code: 'INTERNAL',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  });

  ipcLog.info('[Hub] File handlers registered with permission checks');
}
