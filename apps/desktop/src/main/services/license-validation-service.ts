/**
 * LicenseValidationService - Third-party plugin license management
 *
 * TICKET_447_1: Paid Plugin Purchase and License Flow
 *
 * Singleton service for validating, storing, and querying license keys
 * for third-party paid plugins via external provider APIs (LemonSqueezy/Gumroad).
 *
 * Uses SecureCredentialService for secure key storage.
 */

import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';
import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from './locale-service';
import { getSecureCredentialService } from './secure-credential-service';
import { LICENSE_VALIDATION_CACHE_TTL_MS } from '../../shared/constants/timing';
import type {
  LicenseValidationConfig,
  LicenseValidationResult,
  LicenseStatusInfo,
} from '../../shared/types/marketplace';

const licenseLog = createLogger('LICENSE');

// =============================================================================
// Configuration
// =============================================================================

/** SecureCredentialService namespace for license keys */
const LICENSE_NAMESPACE_PREFIX = 'license';
const LICENSE_CREDENTIAL_KEY = 'license_key';

// Validation cache TTL imported from @shared/constants/timing

// =============================================================================
// Validation Cache Entry
// =============================================================================

interface ValidationCacheEntry {
  valid: boolean;
  expiresAt?: string;
  checkedAt: number;
}

// =============================================================================
// LicenseValidationService Class
// =============================================================================

export class LicenseValidationService extends EventEmitter {
  private static instance: LicenseValidationService | null = null;

  private initialized = false;
  private validationCache: Map<string, ValidationCacheEntry> = new Map();

  private constructor() {
    super();
  }

  static getInstance(): LicenseValidationService {
    if (!LicenseValidationService.instance) {
      LicenseValidationService.instance = new LicenseValidationService();
    }
    return LicenseValidationService.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      licenseLog.warn('LicenseValidationService already initialized');
      return;
    }

    this.initialized = true;
    licenseLog.info('LicenseValidationService initialized');
  }

  // ===========================================================================
  // License Key Storage (SecureCredentialService wrapper)
  // ===========================================================================

  /**
   * Store a license key securely
   */
  async storeLicenseKey(pluginId: string, key: string): Promise<void> {
    const credentialService = getSecureCredentialService();
    const namespace = `${LICENSE_NAMESPACE_PREFIX}.${pluginId}`;

    const result = await credentialService.setSecret(namespace, LICENSE_CREDENTIAL_KEY, key);
    if (!result.success) {
      throw new Error(result.errorMessage || mainT(getCurrentMainLocale(), 'errors', 'license.storeFailed'));
    }

    licenseLog.info(`License key stored for plugin: ${pluginId}`);
  }

  /**
   * Get stored license key
   */
  async getLicenseKey(pluginId: string): Promise<string | null> {
    const credentialService = getSecureCredentialService();
    const namespace = `${LICENSE_NAMESPACE_PREFIX}.${pluginId}`;

    const result = await credentialService.getSecret(namespace, LICENSE_CREDENTIAL_KEY);
    if (result.success && result.value) {
      return result.value;
    }
    return null;
  }

  /**
   * Delete stored license key
   */
  async deleteLicenseKey(pluginId: string): Promise<void> {
    const credentialService = getSecureCredentialService();
    const namespace = `${LICENSE_NAMESPACE_PREFIX}.${pluginId}`;

    const result = await credentialService.deleteSecret(namespace, LICENSE_CREDENTIAL_KEY);
    if (!result.success) {
      throw new Error(result.errorMessage || 'Failed to delete license key');
    }

    // Clear cache
    this.validationCache.delete(pluginId);

    licenseLog.info(`License key removed for plugin: ${pluginId}`);

    this.emit('licenseStatusChanged', {
      pluginId,
      hasKey: false,
      valid: false,
      checkedAt: new Date().toISOString(),
    } satisfies LicenseStatusInfo);
  }

  /**
   * Check if a license key exists (without retrieving it)
   */
  async hasLicenseKey(pluginId: string): Promise<boolean> {
    const key = await this.getLicenseKey(pluginId);
    return key !== null;
  }

  // ===========================================================================
  // License Validation
  // ===========================================================================

  /**
   * Validate a license key against the provider's API
   */
  async validateLicense(
    pluginId: string,
    licenseKey: string,
    config: LicenseValidationConfig
  ): Promise<LicenseValidationResult> {
    licenseLog.info(`Validating license for plugin: ${pluginId}`);

    try {
      // Build request body with template substitution
      let requestBody: string | undefined;
      if (config.body) {
        const substituted: Record<string, string> = {};
        for (const [key, value] of Object.entries(config.body)) {
          substituted[key] = value
            .replace('{{LICENSE_KEY}}', licenseKey)
            .replace('{{PLUGIN_ID}}', pluginId);
        }
        requestBody = JSON.stringify(substituted);
      }

      const fetchOptions: RequestInit = {
        method: config.method,
        headers: { 'Content-Type': 'application/json' },
      };

      if (config.method === 'POST' && requestBody) {
        fetchOptions.body = requestBody;
      }

      // Build URL with query params for GET requests
      let url = config.url
        .replace('{{LICENSE_KEY}}', encodeURIComponent(licenseKey))
        .replace('{{PLUGIN_ID}}', encodeURIComponent(pluginId));

      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        return {
          valid: false,
          error: `Validation request failed: HTTP ${response.status}`,
        };
      }

      const data = await response.json() as Record<string, unknown>;

      // Extract success field using dot notation path
      const fieldValue = getNestedValue(data, config.successField);
      const expectedValue = config.successValue;
      const valid = String(fieldValue) === String(expectedValue);

      const result: LicenseValidationResult = {
        valid,
        error: valid ? undefined : 'License key is not valid',
        i18nKey: valid ? undefined : 'license.keyNotValid',
        expiresAt: String(data.expires_at ?? data.expiresAt ?? '') || undefined,
      };

      // Update cache
      this.validationCache.set(pluginId, {
        valid,
        expiresAt: result.expiresAt,
        checkedAt: Date.now(),
      });

      licenseLog.info(`License validation for ${pluginId}: ${valid ? 'valid' : 'invalid'}`);

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      licenseLog.error(`License validation failed for ${pluginId}:`, message);
      return { valid: false, error: message };
    }
  }

  /**
   * Validate and store a license key (activation flow)
   */
  async validateAndStore(
    pluginId: string,
    licenseKey: string,
    config: LicenseValidationConfig
  ): Promise<LicenseValidationResult> {
    const result = await this.validateLicense(pluginId, licenseKey, config);

    if (result.valid) {
      await this.storeLicenseKey(pluginId, licenseKey);

      this.emit('licenseStatusChanged', {
        pluginId,
        hasKey: true,
        valid: true,
        checkedAt: new Date().toISOString(),
        expiresAt: result.expiresAt,
      } satisfies LicenseStatusInfo);
    }

    return result;
  }

  // ===========================================================================
  // Bulk Status Query
  // ===========================================================================

  /**
   * Get license statuses for multiple plugins
   */
  async getLicenseStatuses(pluginIds: string[]): Promise<LicenseStatusInfo[]> {
    const statuses: LicenseStatusInfo[] = [];

    for (const pluginId of pluginIds) {
      const hasKey = await this.hasLicenseKey(pluginId);
      const cached = this.validationCache.get(pluginId);

      // Use cached validation if still fresh
      const isCacheFresh = cached && (Date.now() - cached.checkedAt) < LICENSE_VALIDATION_CACHE_TTL_MS;

      statuses.push({
        pluginId,
        hasKey,
        valid: isCacheFresh ? cached.valid : hasKey,
        checkedAt: isCacheFresh
          ? new Date(cached.checkedAt).toISOString()
          : new Date().toISOString(),
        expiresAt: cached?.expiresAt,
      });
    }

    return statuses;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  shutdown(): void {
    this.initialized = false;
    this.validationCache.clear();
    licenseLog.info('LicenseValidationService shutdown');
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get a nested value from an object using dot notation path
 * e.g., getNestedValue({ data: { valid: true } }, 'data.valid') => true
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

// =============================================================================
// Singleton Export
// =============================================================================

let licenseValidationServiceInstance: LicenseValidationService | null = null;

export function getLicenseValidationService(): LicenseValidationService {
  if (!licenseValidationServiceInstance) {
    licenseValidationServiceInstance = LicenseValidationService.getInstance();
  }
  return licenseValidationServiceInstance;
}

export async function initializeLicenseValidationService(): Promise<LicenseValidationService> {
  const service = getLicenseValidationService();
  await service.initialize();
  return service;
}

export default LicenseValidationService;
