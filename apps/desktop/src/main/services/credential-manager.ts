/**
 * CredentialManager - ClickHouse Credential Storage
 *
 * Part of TICKET_130: ClickHouse Direct Connection - Frontend Implementation
 * Manages ClickHouse credentials using Electron safeStorage (SecureCredentialService).
 *
 * Credentials stored:
 * - CLICKHOUSE_URL
 * - CLICKHOUSE_USERNAME
 * - CLICKHOUSE_PASSWORD
 * - CLICKHOUSE_EXPIRES_AT
 */

import { getSecureCredentialService } from './secure-credential-service';
import { appLog } from '../utils/logger';

// =============================================================================
// Types
// =============================================================================

export interface ClickHouseCredentials {
  url: string;
  username: string;
  password: string;
  expires_at: string; // ISO 8601 format
}

// =============================================================================
// Constants
// =============================================================================

const PLUGIN_ID = 'com.stratcraft.back-test-nexus';

const CREDENTIAL_KEYS = {
  URL: 'CLICKHOUSE_URL',
  USERNAME: 'CLICKHOUSE_USERNAME',
  PASSWORD: 'CLICKHOUSE_PASSWORD',
  EXPIRES_AT: 'CLICKHOUSE_EXPIRES_AT',
} as const;

// =============================================================================
// CredentialManager Class
// =============================================================================

export class CredentialManager {
  private static instance: CredentialManager | null = null;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): CredentialManager {
    if (!CredentialManager.instance) {
      CredentialManager.instance = new CredentialManager();
    }
    return CredentialManager.instance;
  }

  /**
   * Store ClickHouse credentials to SecureCredentialService
   */
  async storeClickHouseCredentials(credentials: ClickHouseCredentials): Promise<void> {
    try {
      const credentialService = getSecureCredentialService();

      // Store all credential fields
      await credentialService.setSecret(PLUGIN_ID, CREDENTIAL_KEYS.URL, credentials.url);
      await credentialService.setSecret(PLUGIN_ID, CREDENTIAL_KEYS.USERNAME, credentials.username);
      await credentialService.setSecret(PLUGIN_ID, CREDENTIAL_KEYS.PASSWORD, credentials.password);
      await credentialService.setSecret(PLUGIN_ID, CREDENTIAL_KEYS.EXPIRES_AT, credentials.expires_at);

      appLog.info('[CredentialManager] ClickHouse credentials stored successfully');
    } catch (error) {
      appLog.error('[CredentialManager] Failed to store credentials', { error });
      throw error;
    }
  }

  /**
   * Load ClickHouse credentials from SecureCredentialService
   * Returns null if credentials not found or incomplete
   */
  async loadClickHouseCredentials(): Promise<ClickHouseCredentials | null> {
    try {
      const credentialService = getSecureCredentialService();

      // Retrieve all credential fields
      const urlResponse = await credentialService.getSecret(PLUGIN_ID, CREDENTIAL_KEYS.URL);
      const usernameResponse = await credentialService.getSecret(PLUGIN_ID, CREDENTIAL_KEYS.USERNAME);
      const passwordResponse = await credentialService.getSecret(PLUGIN_ID, CREDENTIAL_KEYS.PASSWORD);
      const expiresAtResponse = await credentialService.getSecret(PLUGIN_ID, CREDENTIAL_KEYS.EXPIRES_AT);

      // Check if all fields are present
      if (!urlResponse.value || !usernameResponse.value || !passwordResponse.value || !expiresAtResponse.value) {
        appLog.warn('[CredentialManager] Incomplete ClickHouse credentials');
        return null;
      }

      const credentials: ClickHouseCredentials = {
        url: urlResponse.value,
        username: usernameResponse.value,
        password: passwordResponse.value,
        expires_at: expiresAtResponse.value,
      };

      appLog.info('[CredentialManager] ClickHouse credentials loaded successfully');
      return credentials;
    } catch (error) {
      appLog.error('[CredentialManager] Failed to load credentials', { error });
      return null;
    }
  }

  /**
   * Clear ClickHouse credentials from SecureCredentialService
   */
  async clearClickHouseCredentials(): Promise<void> {
    try {
      const credentialService = getSecureCredentialService();

      // Delete all credential fields
      await credentialService.deleteSecret(PLUGIN_ID, CREDENTIAL_KEYS.URL);
      await credentialService.deleteSecret(PLUGIN_ID, CREDENTIAL_KEYS.USERNAME);
      await credentialService.deleteSecret(PLUGIN_ID, CREDENTIAL_KEYS.PASSWORD);
      await credentialService.deleteSecret(PLUGIN_ID, CREDENTIAL_KEYS.EXPIRES_AT);

      appLog.info('[CredentialManager] ClickHouse credentials cleared');
    } catch (error) {
      appLog.error('[CredentialManager] Failed to clear credentials', { error });
      throw error;
    }
  }

  /**
   * Check if credentials are expired
   */
  isExpired(expiresAt: string): boolean {
    const expirationTime = new Date(expiresAt).getTime();
    const now = Date.now();
    return now >= expirationTime;
  }

  /**
   * Check if credentials exist
   */
  async hasCredentials(): Promise<boolean> {
    try {
      const credentialService = getSecureCredentialService();
      const exists = await credentialService.hasCredential(PLUGIN_ID, CREDENTIAL_KEYS.PASSWORD);
      return exists;
    } catch (error) {
      appLog.error('[CredentialManager] Failed to check credentials', { error });
      return false;
    }
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export function getCredentialManager(): CredentialManager {
  return CredentialManager.getInstance();
}
