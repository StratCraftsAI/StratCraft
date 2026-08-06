/**
 * Credential IPC Handlers
 *
 * Part of TICKET_032: Credential Security Redesign - Phase 3
 * Provides IPC bridge between renderer and C++ Core credential service.
 */

import { ipcMain, IpcMainInvokeEvent, BrowserWindow } from 'electron';
import type { CredentialHealth } from '@StratCraft/types';
// TICKET_134: V3 uses SecureCredentialService instead of gRPC CoreClient
import { getSecureCredentialService } from '../services/secure-credential-service';
// TICKET_192: API Key Validation
import { getApiKeyValidator } from '../services/api-key-validator';
// TICKET_646_1 Phase 3: Pre-cache BYOK models after successful key validation
import { fetchBYOKModels, invalidateBYOKModelCache } from '../services/byok-model-fetcher';
// TICKET_883 Phase 3: Refresh data-provider cache on credential change
import { resolveDataProviderFromCredential } from '../services/data-providers/provider-manager';
import { CREDENTIAL_CHANNELS, SECURITY_CHANNELS } from '../../shared/constants/channels';
import { LLM_PROVIDER_RECORDS } from '../../shared/constants/llm-providers';
import { API_KEY_VALIDATION_IPC_TIMEOUT_MS } from '../../shared/constants/timing';
import { ipcLog } from '../utils/logger';
import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from '../services/locale-service';

/**
 * TICKET_646_1 fix: Resolve a credential key (e.g. 'llm.openai.apiKey') to
 * its provider ID (e.g. 'OPENAI') so we can invalidate the BYOK model cache
 * when the key is set or deleted via the generic credential handlers.
 */
function resolveProviderIdFromKey(credentialKey: string): string | null {
  const record = LLM_PROVIDER_RECORDS.find(p => p.secretKey === credentialKey);
  return record ? record.id : null;
}

/**
 * TICKET_883 Phase 3: After a data-provider credential changes, refresh
 * that provider's cached status so the UI reflects the new state immediately
 * instead of waiting for TTL expiry.
 */
function refreshDataProviderOnCredentialChange(pluginId: string, key: string): void {
  const dataProviderId = resolveDataProviderFromCredential(pluginId, key);
  if (!dataProviderId) return;

  try {
    const { getDataProviderManager } = require('../services/data-providers/provider-manager');
    const manager = getDataProviderManager();
    manager.refreshSingleProvider(dataProviderId).catch((err: Error) => {
      ipcLog.debug(`[Credential] Data provider refresh for '${dataProviderId}' failed: ${err.message}`);
    });
  } catch {
    ipcLog.debug(`[Credential] DataProviderManager not initialized, skipping refresh for '${dataProviderId}'`);
  }
}

/**
 * Register credential IPC handlers
 */
export function registerCredentialHandlers(): void {
  const credentialService = getSecureCredentialService();

  // Get credential
  ipcMain.handle(
    CREDENTIAL_CHANNELS.GET,
    async (_event: IpcMainInvokeEvent, pluginId: string, key: string) => {
      ipcLog.debug(`[Credential] Get: ${pluginId}:${key}`);
      try {
        const response = await credentialService.getSecret(pluginId, key);
        return {
          success: response.success,
          value: response.value,
          errorCode: response.errorCode,
          errorMessage: response.errorMessage,
          health: response.health,
        };
      } catch (error) {
        ipcLog.error(`[Credential] Get failed: ${error}`);
        return {
          success: false,
          errorMessage: error instanceof Error ? error.message : 'MSG_CREDENTIAL_ERROR',
        };
      }
    }
  );

  // Set credential
  ipcMain.handle(
    CREDENTIAL_CHANNELS.SET,
    async (_event: IpcMainInvokeEvent, pluginId: string, key: string, value: string) => {
      ipcLog.debug(`[Credential] Set: ${pluginId}:${key}`);
      try {
        const response = await credentialService.setSecret(pluginId, key, value);
        // TICKET_646_1 fix: Invalidate BYOK model cache when an LLM API key changes.
        // The new key may belong to a different account with different model access.
        if (response.success) {
          const providerId = resolveProviderIdFromKey(key);
          if (providerId) {
            invalidateBYOKModelCache(providerId);
          }
          refreshDataProviderOnCredentialChange(pluginId, key);
        }
        return {
          success: response.success,
          errorCode: response.errorCode,
          errorMessage: response.errorMessage,
          health: response.health,
        };
      } catch (error) {
        ipcLog.error(`[Credential] Set failed: ${error}`);
        return {
          success: false,
          errorMessage: error instanceof Error ? error.message : 'MSG_CREDENTIAL_ERROR',
        };
      }
    }
  );

  // Delete credential
  ipcMain.handle(
    CREDENTIAL_CHANNELS.DELETE,
    async (_event: IpcMainInvokeEvent, pluginId: string, key: string) => {
      ipcLog.debug(`[Credential] Delete: ${pluginId}:${key}`);
      try {
        const response = await credentialService.deleteSecret(pluginId, key);
        // TICKET_646_1 fix: Invalidate BYOK model cache when an LLM API key is deleted.
        // Prevents stale cache from showing models for a key that no longer exists.
        if (response.success) {
          const providerId = resolveProviderIdFromKey(key);
          if (providerId) {
            invalidateBYOKModelCache(providerId);
          }
          refreshDataProviderOnCredentialChange(pluginId, key);
        }
        return {
          success: response.success,
          errorCode: response.errorCode,
          errorMessage: response.errorMessage,
          health: response.health,
        };
      } catch (error) {
        ipcLog.error(`[Credential] Delete failed: ${error}`);
        return {
          success: false,
          errorMessage: error instanceof Error ? error.message : 'MSG_CREDENTIAL_ERROR',
        };
      }
    }
  );

  // Check if credential exists
  ipcMain.handle(
    CREDENTIAL_CHANNELS.HAS,
    async (_event: IpcMainInvokeEvent, pluginId: string, key: string) => {
      ipcLog.debug(`[Credential] Has: ${pluginId}:${key}`);
      try {
        const exists = await credentialService.hasCredential(pluginId, key);
        return { success: true, exists };
      } catch (error) {
        ipcLog.error(`[Credential] Has failed: ${error}`);
        return {
          success: false,
          exists: false,
          errorMessage: error instanceof Error ? error.message : 'MSG_CREDENTIAL_ERROR',
        };
      }
    }
  );

  // List credential keys for a plugin
  ipcMain.handle(
    CREDENTIAL_CHANNELS.LIST,
    async (_event: IpcMainInvokeEvent, pluginId: string) => {
      ipcLog.debug(`[Credential] List: ${pluginId}`);
      try {
        const keys = await credentialService.listCredentialKeys(pluginId);
        return { success: true, keys };
      } catch (error) {
        ipcLog.error(`[Credential] List failed: ${error}`);
        return {
          success: false,
          keys: [],
          errorMessage: error instanceof Error ? error.message : 'MSG_CREDENTIAL_ERROR',
        };
      }
    }
  );

  // Validate user with master password
  // TICKET_134: V3 uses OS keychain (safeStorage), no master password needed
  ipcMain.handle(
    CREDENTIAL_CHANNELS.VALIDATE_USER,
    async (_event: IpcMainInvokeEvent, _password: string) => {
      ipcLog.debug('[Credential] ValidateUser - V3 uses OS keychain, always valid');
      // V3: OS keychain handles authentication, always return success
      return {
        success: true,
        sessionToken: 'v3-os-keychain',
      };
    }
  );

  // Set master password
  // TICKET_134: V3 uses OS keychain (safeStorage), no master password needed
  ipcMain.handle(
    CREDENTIAL_CHANNELS.SET_MASTER_PASSWORD,
    async (_event: IpcMainInvokeEvent, _password: string) => {
      ipcLog.debug('[Credential] SetMasterPassword - V3 uses OS keychain, no-op');
      // V3: OS keychain manages encryption, no master password concept
      return { success: true };
    }
  );

  // Execute with High Protection credential
  // TICKET_134: V3 does not support high-protection execution (was C++ Core feature)
  ipcMain.handle(
    CREDENTIAL_CHANNELS.EXECUTE_WITH,
    async (
      _event: IpcMainInvokeEvent,
      pluginId: string,
      key: string,
      operation: string,
      _params: string
    ) => {
      ipcLog.warn(
        `[Credential] ExecuteWith: ${pluginId}:${key} -> ${operation} - Not supported in V3`
      );
      return {
        success: false,
        errorCode: 501,
        errorMessage: 'ExecuteWith not supported in V3 architecture',
      };
    }
  );

  // Get audit log
  // TICKET_580_2: Wire to SecureCredentialService audit log
  ipcMain.handle(
    CREDENTIAL_CHANNELS.GET_AUDIT_LOG,
    async (_event: IpcMainInvokeEvent, pluginId?: string, maxEntries?: number) => {
      ipcLog.debug(`[Credential] GetAuditLog: ${pluginId || 'all'}`);
      try {
        const entries = credentialService.getAuditLog(pluginId, maxEntries);
        return { success: true, entries };
      } catch (error) {
        ipcLog.error(`[Credential] GetAuditLog failed: ${error}`);
        return {
          success: false,
          entries: [],
          errorMessage: error instanceof Error ? error.message : 'MSG_CREDENTIAL_ERROR',
        };
      }
    }
  );

  ipcMain.handle(CREDENTIAL_CHANNELS.LIFECYCLE_STATUS, async () => {
    try {
      return { success: true, status: await credentialService.lifecycleStatus() };
    } catch (error) {
      ipcLog.error(`[Credential] Lifecycle status failed: ${error}`);
      return {
        success: false,
        errorMessage: error instanceof Error ? error.message : 'MSG_CREDENTIAL_ERROR',
      };
    }
  });

  ipcMain.handle(CREDENTIAL_CHANNELS.RESET_UNREADABLE, async (_event, confirm: boolean) => {
    if (confirm !== true) {
      return { success: false, errorMessage: 'Explicit confirmation is required.' };
    }
    return credentialService.resetUnreadableCredentials();
  });

  ipcMain.handle(
    CREDENTIAL_CHANNELS.REPLACE_UNREADABLE,
    async (
      _event,
      pluginId: string,
      key: string,
      value: string,
      health: Exclude<CredentialHealth, { state: 'usable' | 'missing' }>,
      confirm: boolean,
    ) => {
      if (confirm !== true) {
        return { success: false, errorMessage: 'Explicit confirmation is required.' };
      }
      return credentialService.replaceUnreadableCredential(pluginId, key, value, health);
    },
  );

  ipcMain.handle(CREDENTIAL_CHANNELS.MIGRATE_LEGACY, async () =>
    credentialService.migrateLegacyCredentialStore());

  ipcMain.handle(CREDENTIAL_CHANNELS.ROTATE_MASTER_KEY, async () =>
    credentialService.rotateCredentialMasterKey());

  ipcMain.handle(
    CREDENTIAL_CHANNELS.EXPORT_RECOVERY_BUNDLE,
    async (_event, passphrase: string) => credentialService.exportCredentialRecoveryBundle(passphrase),
  );

  ipcMain.handle(
    CREDENTIAL_CHANNELS.IMPORT_RECOVERY_BUNDLE,
    async (_event, bundleBase64: string, passphrase: string) =>
      credentialService.importCredentialRecoveryBundle(bundleBase64, passphrase),
  );

  // TICKET_192: Validate API key for LLM providers
  // Key is validated directly from Desktop - never sent to backend server
  ipcMain.handle(
    CREDENTIAL_CHANNELS.VALIDATE_API_KEY,
    // TICKET_1266: optional `baseUrl` carries the OPENAI_COMPATIBLE endpoint.
    async (_event: IpcMainInvokeEvent, provider: string, apiKey: string, baseUrl?: string) => {
      ipcLog.debug(`[Credential] ValidateApiKey: ${provider}`);

      // Outer IPC-boundary timeout: belt-and-braces guard so the renderer
      // always receives a response, even if the inner validator+fetch hangs
      // (observed post-TICKET_809: undici fetch held a socket past both the
      // AbortController and Promise.race hard-timeout in the validator).
      let outerTimeoutId: NodeJS.Timeout | undefined;
      const outerTimeoutPromise = new Promise<never>((_, reject) => {
        outerTimeoutId = setTimeout(() => {
          reject(new Error('IPC_VALIDATION_TIMEOUT'));
        }, API_KEY_VALIDATION_IPC_TIMEOUT_MS);
      });

      try {
        const validator = getApiKeyValidator();
        const result = await Promise.race([
          validator.validateKey(provider, apiKey, baseUrl),
          outerTimeoutPromise,
        ]);

        // TICKET_646_1 Phase 3: After successful validation, invalidate stale
        // BYOK model cache and pre-fetch models from the provider's own API.
        // Fire-and-forget: do not block the validation response.
        if (result.valid) {
          const providerId = provider.toUpperCase();
          invalidateBYOKModelCache(providerId);
          fetchBYOKModels(providerId, true).catch((err) => {
            ipcLog.debug(`[Credential] BYOK model pre-fetch for ${providerId} failed: ${err instanceof Error ? err.message : String(err)}`);
          });
        }

        ipcLog.debug(`[Credential] ValidateApiKey done: ${provider} valid=${result.valid}`);
        return {
          success: true,
          data: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'IPC_VALIDATION_TIMEOUT') {
          ipcLog.error(`[Credential] ValidateApiKey hard-timeout: ${provider}`);
          return {
            success: true,
            data: {
              valid: false,
              error: mainT(getCurrentMainLocale(), 'errors', 'credential.validationTimedOut'),
              errorCode: 'TIMEOUT' as const,
              provider,
            },
          };
        }
        ipcLog.error(`[Credential] ValidateApiKey failed: ${error}`);
        return {
          success: false,
          errorMessage: error instanceof Error ? error.message : 'MSG_CREDENTIAL_ERROR',
        };
      } finally {
        if (outerTimeoutId) clearTimeout(outerTimeoutId);
      }
    }
  );

  // TICKET_580_4: Forward security events to renderer
  credentialService.on('keychain-unavailable', (data) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(SECURITY_CHANNELS.KEYCHAIN_UNAVAILABLE, data);
      }
    });
  });

  credentialService.on('t0-rejected', (data) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(SECURITY_CHANNELS.T0_REJECTED, data);
      }
    });
  });

  credentialService.on('t1-warning', (data) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(SECURITY_CHANNELS.T1_WARNING, data);
      }
    });
  });

  ipcLog.info('[Credential] IPC handlers registered');
}
