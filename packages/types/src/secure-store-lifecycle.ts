import type { CredentialHealth, SecureStoreErrorCode } from './secure-store-health';

export type SecureStoreLifecycleMode =
  | 'empty'
  | 'legacy'
  | 'gcm2'
  | 'mixed'
  | 'recovery_required';

export interface SecureStoreLifecycleCapabilities {
  migrateLegacy: boolean;
  rotateMasterKey: boolean;
  exportRecoveryBundle: boolean;
  importRecoveryBundle: boolean;
  resetUnreadableCredentials: boolean;
}

/** Shared TICKET_1314 lifecycle projection consumed by every surface. */
export interface SecureStoreLifecycleStatus {
  mode: SecureStoreLifecycleMode;
  storeId?: string;
  envelopeVersion?: number;
  activeKeyId?: string;
  activeGeneration?: number;
  minimumWriterProtocol?: number;
  credentialCount: number;
  archivedCredentialCount: number;
  unreadableCredentialCount: number;
  retiredKeyCount: number;
  capabilities: SecureStoreLifecycleCapabilities;
}

export interface SecureStoreLifecycleMutationResult {
  success: boolean;
  keyId?: string;
  generation?: number;
  errorCode?: SecureStoreErrorCode | number;
  errorMessage?: string;
  health?: Exclude<CredentialHealth, { state: 'usable' }>;
}
