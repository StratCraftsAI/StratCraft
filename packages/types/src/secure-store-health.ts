/**
 * Cross-surface SecureStore health and stable error contracts.
 *
 * This module intentionally contains no ciphertext, key fingerprints, raw
 * keyring messages, or credential values. Electron, MCP, and Guide WebUI must
 * forward these shapes without reconstructing storage state.
 */

export const SECURE_STORE_ERROR_CODES = {
  KEYRING_LOCKED: 'SECURE_STORE_KEYRING_LOCKED',
  KEYRING_UNAVAILABLE: 'SECURE_STORE_KEYRING_UNAVAILABLE',
  KEYRING_PERMISSION_DENIED: 'SECURE_STORE_KEYRING_PERMISSION_DENIED',
  MASTER_KEY_MISSING: 'SECURE_STORE_MASTER_KEY_MISSING',
  MASTER_KEY_MALFORMED: 'SECURE_STORE_MASTER_KEY_MALFORMED',
  KEY_IDENTITY_MISMATCH: 'SECURE_STORE_KEY_IDENTITY_MISMATCH',
  CREDENTIAL_AUTH_FAILED: 'SECURE_STORE_CREDENTIAL_AUTH_FAILED',
  CREDENTIAL_CORRUPT: 'SECURE_STORE_CREDENTIAL_CORRUPT',
  MIGRATION_REQUIRED: 'SECURE_STORE_MIGRATION_REQUIRED',
  RECOVERY_REQUIRED: 'SECURE_STORE_RECOVERY_REQUIRED',
  ROTATION_CONFLICT: 'SECURE_STORE_ROTATION_CONFLICT',
  RECOVERY_BUNDLE_INVALID: 'SECURE_STORE_RECOVERY_BUNDLE_INVALID',
  WRITER_UPGRADE_REQUIRED: 'SECURE_STORE_WRITER_UPGRADE_REQUIRED',
} as const;

export type SecureStoreErrorCode =
  (typeof SECURE_STORE_ERROR_CODES)[keyof typeof SECURE_STORE_ERROR_CODES];

export type CredentialHealth =
  | { state: 'missing' }
  | { state: 'usable'; keyId: string; scheme: 'gcm2' | 'gcm1' }
  | { state: 'usable'; scheme: 'b64'; protection: 'insecure' }
  | { state: 'keyring_locked'; retryable: true }
  | { state: 'keyring_unavailable'; retryable: true; backendCode?: string }
  | { state: 'keyring_permission_denied'; retryable: false; backendCode?: string }
  | { state: 'master_key_missing'; keyId: string; recoverable: boolean }
  | { state: 'master_key_malformed'; keyId: string }
  | { state: 'key_identity_mismatch'; keyId: string }
  | { state: 'credential_auth_failed'; keyId: string }
  | { state: 'credential_corrupt'; scheme?: string }
  | { state: 'migration_required' }
  | { state: 'recovery_required'; recoveryId: string }
  | { state: 'writer_upgrade_required'; minimumProtocol: number };

export interface SecureStoreFailure {
  success: false;
  errorCode: SecureStoreErrorCode;
  errorMessage: string;
  health: Exclude<CredentialHealth, { state: 'usable' }>;
}
