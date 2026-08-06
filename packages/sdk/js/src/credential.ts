/**
 * Credential Management SDK Client
 *
 * Part of TICKET_036_1: Module Authentication System Implementation
 * Provides secure credential storage and retrieval for plugins.
 *
 * Credentials are stored per-plugin in the system keychain or encrypted
 * file storage, ensuring isolation between plugins.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Credential entry
 */
export interface Credential {
  key: string;
  value: string;
  metadata?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

/**
 * Result of credential operation
 */
export interface CredentialResult {
  success: boolean;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Credential service interface
 */
export interface ICredentialService {
  /**
   * Store a credential
   * @param key Credential key (unique within plugin namespace)
   * @param value Credential value (encrypted in storage)
   * @param metadata Optional metadata
   */
  set(key: string, value: string, metadata?: Record<string, string>): Promise<CredentialResult>;

  /**
   * Retrieve a credential value
   * @param key Credential key
   * @returns Credential value or null if not found
   */
  get(key: string): Promise<string | null>;

  /**
   * Check if credential exists
   * @param key Credential key
   */
  has(key: string): Promise<boolean>;

  /**
   * Delete a credential
   * @param key Credential key
   */
  delete(key: string): Promise<CredentialResult>;

  /**
   * List all credential keys for this plugin
   */
  list(): Promise<string[]>;

  /**
   * Clear all credentials for this plugin
   */
  clear(): Promise<CredentialResult>;
}

/**
 * Transport interface for credential operations
 */
export interface ICredentialTransport {
  set(pluginId: string, key: string, value: string, metadata?: Record<string, string>): Promise<{
    success: boolean;
    errorCode?: string;
    errorMessage?: string;
  }>;

  get(pluginId: string, key: string): Promise<{
    success: boolean;
    value?: string;
    metadata?: Record<string, string>;
    errorCode?: string;
    errorMessage?: string;
  }>;

  has(pluginId: string, key: string): Promise<{
    success: boolean;
    exists: boolean;
    errorCode?: string;
    errorMessage?: string;
  }>;

  delete(pluginId: string, key: string): Promise<{
    success: boolean;
    errorCode?: string;
    errorMessage?: string;
  }>;

  list(pluginId: string): Promise<{
    success: boolean;
    keys?: string[];
    errorCode?: string;
    errorMessage?: string;
  }>;

  clear(pluginId: string): Promise<{
    success: boolean;
    errorCode?: string;
    errorMessage?: string;
  }>;
}

// =============================================================================
// CredentialService Implementation
// =============================================================================

/**
 * Credential service for plugins
 *
 * Usage:
 * ```typescript
 * const creds = new CredentialService('com.example.plugin', transport);
 *
 * // Store API key
 * await creds.set('api_key', 'sk-xxxxx', {
 *   provider: 'openai',
 *   created: new Date().toISOString()
 * });
 *
 * // Retrieve API key
 * const apiKey = await creds.get('api_key');
 * if (apiKey) {
 *   // Use API key
 * }
 *
 * // List all stored credentials
 * const keys = await creds.list();
 * console.log('Stored credentials:', keys);
 * ```
 */
export class CredentialService implements ICredentialService {
  private pluginId: string;
  private transport: ICredentialTransport;

  constructor(pluginId: string, transport: ICredentialTransport) {
    this.pluginId = pluginId;
    this.transport = transport;
  }

  async set(
    key: string,
    value: string,
    metadata?: Record<string, string>
  ): Promise<CredentialResult> {
    const response = await this.transport.set(this.pluginId, key, value, metadata);

    if (!response.success) {
      return {
        success: false,
        error: {
          code: response.errorCode || 'SET_FAILED',
          message: response.errorMessage || 'Failed to store credential'
        }
      };
    }

    return { success: true };
  }

  async get(key: string): Promise<string | null> {
    const response = await this.transport.get(this.pluginId, key);

    if (!response.success) {
      if (response.errorCode === 'NOT_FOUND') {
        return null;
      }
      throw new Error(response.errorMessage || 'Failed to get credential');
    }

    return response.value ?? null;
  }

  async has(key: string): Promise<boolean> {
    const response = await this.transport.has(this.pluginId, key);

    if (!response.success) {
      throw new Error(response.errorMessage || 'Failed to check credential');
    }

    return response.exists;
  }

  async delete(key: string): Promise<CredentialResult> {
    const response = await this.transport.delete(this.pluginId, key);

    if (!response.success) {
      return {
        success: false,
        error: {
          code: response.errorCode || 'DELETE_FAILED',
          message: response.errorMessage || 'Failed to delete credential'
        }
      };
    }

    return { success: true };
  }

  async list(): Promise<string[]> {
    const response = await this.transport.list(this.pluginId);

    if (!response.success) {
      throw new Error(response.errorMessage || 'Failed to list credentials');
    }

    return response.keys ?? [];
  }

  async clear(): Promise<CredentialResult> {
    const response = await this.transport.clear(this.pluginId);

    if (!response.success) {
      return {
        success: false,
        error: {
          code: response.errorCode || 'CLEAR_FAILED',
          message: response.errorMessage || 'Failed to clear credentials'
        }
      };
    }

    return { success: true };
  }

  /**
   * Get plugin ID
   */
  getPluginId(): string {
    return this.pluginId;
  }
}

// =============================================================================
// Electron Transport Implementation
// =============================================================================

/**
 * Transport implementation for Electron renderer process
 */
export class ElectronCredentialTransport implements ICredentialTransport {
  private getElectronAPI(): ElectronCredentialAPI {
    if (typeof window === 'undefined' || !window.electronAPI?.credential) {
      throw new Error(
        'Electron API not available. This transport only works in Electron renderer process.'
      );
    }
    return window.electronAPI.credential;
  }

  async set(
    pluginId: string,
    key: string,
    value: string,
    metadata?: Record<string, string>
  ) {
    return this.getElectronAPI().set(pluginId, key, value, metadata);
  }

  async get(pluginId: string, key: string) {
    return this.getElectronAPI().get(pluginId, key);
  }

  async has(pluginId: string, key: string) {
    return this.getElectronAPI().has(pluginId, key);
  }

  async delete(pluginId: string, key: string) {
    return this.getElectronAPI().delete(pluginId, key);
  }

  async list(pluginId: string) {
    return this.getElectronAPI().list(pluginId);
  }

  async clear(pluginId: string) {
    return this.getElectronAPI().clear(pluginId);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a CredentialService for Electron renderer process
 */
export function createCredentialService(pluginId: string): CredentialService {
  const transport = new ElectronCredentialTransport();
  return new CredentialService(pluginId, transport);
}

// =============================================================================
// Type Re-exports
// =============================================================================

// Types are defined in types.ts for global window augmentation
import type { ElectronCredentialAPI } from './types';
export type { ElectronCredentialAPI };
