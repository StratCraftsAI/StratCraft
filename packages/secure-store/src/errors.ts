import {
  SECURE_STORE_ERROR_CODES,
  type CredentialHealth,
  type SecureStoreErrorCode,
} from '@StratCraft/types';
import type { KeyringReadResult } from './master-key';

export class SecureStoreLifecycleError extends Error {
  readonly code: SecureStoreErrorCode;
  readonly health: Exclude<CredentialHealth, { state: 'usable' }>;

  constructor(
    code: SecureStoreErrorCode,
    message: string,
    health: Exclude<CredentialHealth, { state: 'usable' }>,
  ) {
    super(message);
    this.name = 'SecureStoreLifecycleError';
    this.code = code;
    this.health = health;
  }
}

export function keyringFailure(error: Exclude<KeyringReadResult, { kind: 'found' | 'missing' }>): SecureStoreLifecycleError {
  switch (error.kind) {
    case 'locked':
      return new SecureStoreLifecycleError(
        SECURE_STORE_ERROR_CODES.KEYRING_LOCKED,
        'Unlock the system keyring, then retry.',
        { state: 'keyring_locked', retryable: true },
      );
    case 'permission_denied':
      return new SecureStoreLifecycleError(
        SECURE_STORE_ERROR_CODES.KEYRING_PERMISSION_DENIED,
        'StratCraft does not have permission to access the system credential service.',
        {
          state: 'keyring_permission_denied',
          retryable: false,
          ...(error.backendCode ? { backendCode: error.backendCode } : {}),
        },
      );
    case 'malformed':
      return new SecureStoreLifecycleError(
        SECURE_STORE_ERROR_CODES.MASTER_KEY_MALFORMED,
        'The recorded encryption key is malformed and was not replaced.',
        { state: 'master_key_malformed', keyId: 'legacy-v1' },
      );
    default:
      return new SecureStoreLifecycleError(
        SECURE_STORE_ERROR_CODES.KEYRING_UNAVAILABLE,
        'The system credential service is unavailable.',
        {
          state: 'keyring_unavailable',
          retryable: true,
          ...(error.backendCode ? { backendCode: error.backendCode } : {}),
        },
      );
  }
}

export function asLifecycleError(error: unknown): SecureStoreLifecycleError {
  if (error instanceof SecureStoreLifecycleError) return error;
  return new SecureStoreLifecycleError(
    SECURE_STORE_ERROR_CODES.CREDENTIAL_CORRUPT,
    error instanceof Error ? error.message : 'SecureStore operation failed',
    { state: 'credential_corrupt' },
  );
}
