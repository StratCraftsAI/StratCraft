/**
 * @StratCraft/secure-store -- cross-process credential storage.
 *
 * TICKET_1276 P0: OS-keyring master key + AES-256-GCM envelope over an
 * injected SQLite handle, usable identically from the Electron main process
 * and the MCP standalone server. See secure-store.ts for the design notes.
 */

export {
  SecureStore,
  type SecureStoreOptions,
  type SecureStoreLogger,
  type SqliteDatabase,
  type SqliteStatement,
  type GetSecretResponse,
  type SetSecretResponse,
  type DeleteSecretResponse,
  type LifecycleMutationResponse,
  type RecoveryExportResponse,
  type RecoveryKeySelection,
  type UnreadableCredential,
  type ResetUnreadableResult,
} from './secure-store';

export type {
  SecureStoreLifecycleMode,
  SecureStoreLifecycleStatus,
} from '@StratCraft/types';

export {
  createKeyringAdapter,
  KEYRING_SERVICE,
  LEGACY_KEYRING_ACCOUNT,
  MASTER_KEY_BYTES,
  fingerprintKey,
  type MasterKeyProvider,
  type KeyringAdapter,
  type KeyringReadResult,
  type KeyringWriteResult,
  type KeyringDeleteResult,
  type KeyringEntryLike,
  type KeyringEntryFactory,
} from './master-key';

export {
  encryptValue,
  encryptLegacyValue,
  decryptLegacyValue,
  encryptGcm2,
  decryptGcm2,
  parseGcm2,
  canonicalCredentialAad,
  encodeInsecure,
  decodeInsecure,
  decodeValue,
  schemeOf,
  type StoredScheme,
  type CredentialNamespace,
  type ParsedGcm2Envelope,
} from './crypto';
export { SecureStoreKeyManager } from './key-manager';
export { SecureStoreLifecycleError } from './errors';
export {
  exportRecoveryBundle,
  importRecoveryBundle,
  type RecoveryKeyMaterial,
  type ImportedRecoveryBundle,
} from './recovery-bundle';
