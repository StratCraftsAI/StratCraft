/**
 * Shared credential operation for Electron and standalone MCP.
 *
 * The injected SQLite connection owns process ABI concerns; this module owns
 * all credential lifecycle, envelope, typed-health, and mutation decisions.
 */

import { randomUUID } from 'node:crypto';
import {
  CredentialTier,
  SECURE_STORE_ERROR_CODES,
  inferCredentialTier,
  type CredentialHealth,
  type SecureStoreErrorCode,
  type SecureStoreLifecycleMode,
  type SecureStoreLifecycleMutationResult,
  type SecureStoreLifecycleStatus,
} from '@StratCraft/types';
import {
  decodeInsecure,
  decryptGcm2,
  decryptLegacyValue,
  encodeInsecure,
  encryptGcm2,
  encryptLegacyValue,
  parseGcm2,
  schemeOf,
} from './crypto';
import {
  SecureStoreKeyManager,
  type SqliteDatabase,
  type SqliteStatement,
} from './key-manager';
import {
  createKeyringAdapter,
  fingerprintKey,
  type KeyringAdapter,
  type KeyringReadResult,
  type MasterKeyProvider,
} from './master-key';
import { SecureStoreLifecycleError, asLifecycleError } from './errors';
import {
  exportRecoveryBundle,
  importRecoveryBundle,
  type RecoveryKeyMaterial,
} from './recovery-bundle';

export type { SqliteDatabase, SqliteStatement } from './key-manager';

export interface SecureStoreLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}

/**
 * Compatibility injection used by existing tests and host adapters. It is not
 * used by production key discovery and cannot replace an OS-keyring account.
 */
function adapterFromProvider(provider: MasterKeyProvider): KeyringAdapter {
  const read = (): KeyringReadResult => {
    const value = provider.getKey();
    return value
      ? { kind: 'found', bytes: Buffer.from(value) }
      : { kind: 'unavailable', cause: provider.lastError() ?? 'injected key unavailable' };
  };
  return {
    read,
    createFresh(_account, bytes) {
      const result = read();
      if (result.kind === 'missing') {
        return { kind: 'unavailable', cause: 'injected key unavailable' };
      }
      if (result.kind !== 'found') return result;
      // The injection seam represents a pre-provisioned deterministic test
      // key. It never writes a real account.
      bytes.fill(0);
      return { kind: 'created', bytes: result.bytes };
    },
    delete() {
      return { kind: 'unavailable', cause: 'injected provider cannot delete keys' };
    },
  };
}

export interface SecureStoreOptions {
  db: SqliteDatabase;
  keyring?: KeyringAdapter;
  /** Existing host-test injection; production must use `keyring`. */
  masterKey?: MasterKeyProvider;
  allowInsecureT0Fallback: boolean;
  log: SecureStoreLogger;
  inferTier?: (pluginId: string, key: string) => CredentialTier;
  processKind?: string;
  buildId?: string;
  writerProtocol?: number;
}

const NO_EXPECTED_SECRET = Symbol('no-expected-secret');

export interface GetSecretResponse {
  success: boolean;
  value?: string;
  errorCode?: SecureStoreErrorCode | number;
  errorMessage?: string;
  health?: CredentialHealth;
}
export interface SetSecretResponse {
  success: boolean;
  errorCode?: SecureStoreErrorCode | number;
  errorMessage?: string;
  health?: Exclude<CredentialHealth, { state: 'usable' }>;
  warning?: 't0-dev-fallback' | 't1-fallback';
}
export interface DeleteSecretResponse {
  success: boolean;
  errorCode?: SecureStoreErrorCode | number;
  errorMessage?: string;
  health?: Exclude<CredentialHealth, { state: 'usable' }>;
}

export interface LifecycleMutationResponse extends SecureStoreLifecycleMutationResult {}

/** A stored credential the current key cannot decrypt. */
export interface UnreadableCredential {
  pluginId: string;
  key: string;
  tier: number;
  health: Exclude<CredentialHealth, { state: 'usable' | 'missing' }>;
}

export interface ResetUnreadableResult {
  success: boolean;
  /** Rows moved to `credential_recovery_archive` and cleared from `credentials`. */
  archived?: number;
  credentials?: Array<{ pluginId: string; key: string }>;
  errorCode?: SecureStoreErrorCode | number;
  errorMessage?: string;
}

export interface RecoveryExportResponse extends LifecycleMutationResponse {
  bundle?: Buffer;
}

export interface RecoveryKeySelection {
  storeId: string;
  keyIds: readonly string[];
}

type FailureResponse = Required<Pick<GetSecretResponse, 'success' | 'errorCode' | 'errorMessage'>>
  & { success: false; health?: Exclude<CredentialHealth, { state: 'usable' }> };

interface CredentialRow {
  plugin_id: string;
  key: string;
  value: string;
  tier: number;
  updated_at?: number;
}

function errorResponse(error: unknown, log: SecureStoreLogger, operation: string): FailureResponse {
  const lifecycle = asLifecycleError(error);
  log.error(`[SecureStore] ${operation} failed: ${lifecycle.code}`);
  return {
    success: false,
    errorCode: lifecycle.code,
    errorMessage: lifecycle.message,
    health: lifecycle.health,
  };
}

export class SecureStore {
  private readonly db: SqliteDatabase;
  private readonly allowInsecureT0Fallback: boolean;
  private readonly log: SecureStoreLogger;
  private readonly inferTier: (pluginId: string, key: string) => CredentialTier;
  private readonly keys: SecureStoreKeyManager;

  constructor(options: SecureStoreOptions) {
    this.db = options.db;
    this.allowInsecureT0Fallback = options.allowInsecureT0Fallback;
    this.log = options.log;
    this.inferTier = options.inferTier ?? inferCredentialTier;
    const keyring = options.keyring
      ?? (options.masterKey ? adapterFromProvider(options.masterKey) : createKeyringAdapter());
    this.keys = new SecureStoreKeyManager(
      this.db,
      keyring,
      this.log,
      options.processKind ?? 'shared',
      options.buildId ?? 'unknown',
      options.writerProtocol,
    );
  }

  private immediate<T>(fn: () => T): T {
    if (this.db.transactionImmediate) return this.db.transactionImmediate(fn)();
    if (this.db.transaction) {
      const transaction = this.db.transaction(fn);
      if (transaction.immediate) return transaction.immediate();
      return transaction();
    }
    throw new Error('SecureStore mutation requires an immediate SQLite transaction');
  }

  private row(pluginId: string, key: string): CredentialRow | undefined {
    return this.db.prepare(
      'SELECT plugin_id, key, value, tier, updated_at FROM credentials WHERE plugin_id = ? AND key = ?',
    ).get(pluginId, key) as CredentialRow | undefined;
  }

  lifecycleStatusSync(): SecureStoreLifecycleStatus {
    const state = this.keys.readState();
    const counts = this.db.prepare(
      `SELECT
         COUNT(*) AS credential_count,
         SUM(CASE WHEN value LIKE 'gcm1:%' THEN 1 ELSE 0 END) AS legacy_count,
         SUM(CASE WHEN value LIKE 'gcm2:%' THEN 1 ELSE 0 END) AS gcm2_count
       FROM credentials`,
    ).get() as {
      credential_count: number;
      legacy_count: number | null;
      gcm2_count: number | null;
    };
    const archived = this.db.prepare(
      'SELECT COUNT(*) AS count FROM credential_recovery_archive',
    ).get() as { count: number };
    const retired = this.db.prepare(
      "SELECT COUNT(*) AS count FROM secure_store_key WHERE lifecycle_status = 'retired'",
    ).get() as { count: number };
    const legacyCount = counts.legacy_count ?? 0;
    const gcm2Count = counts.gcm2_count ?? 0;
    const mode: SecureStoreLifecycleMode = state
      ? legacyCount > 0 ? 'mixed' : 'gcm2'
      : gcm2Count > 0 ? 'recovery_required'
        : legacyCount > 0 ? 'legacy' : 'empty';
    const unreadableCredentialCount = this.listUnreadableCredentialsSync().length;
    // Cohort reset is intentionally limited to the pre-lifecycle legacy store.
    // A GCM2 store retains key identity and recovery metadata; clearing only its
    // live rows would neither repair custody nor create a safe fresh store. It
    // would also turn a transient locked/unavailable keyring into a destructive
    // action. GCM2 recovery must use the recovery-bundle path instead.
    const canResetUnreadableCredentials = !state
      && mode === 'legacy'
      && unreadableCredentialCount > 0;
    return {
      mode,
      storeId: state?.storeId,
      envelopeVersion: state?.envelopeVersion,
      activeKeyId: state?.activeKeyId,
      activeGeneration: state?.activeGeneration,
      minimumWriterProtocol: state?.minimumWriterProtocol,
      credentialCount: counts.credential_count,
      archivedCredentialCount: archived.count,
      unreadableCredentialCount,
      retiredKeyCount: retired.count,
      capabilities: {
        migrateLegacy: mode === 'legacy' && legacyCount > 0 && unreadableCredentialCount === 0,
        rotateMasterKey: mode === 'gcm2',
        exportRecoveryBundle: mode === 'gcm2',
        importRecoveryBundle: mode === 'gcm2',
        resetUnreadableCredentials: canResetUnreadableCredentials,
      },
    };
  }

  credentialHealthSync(pluginId: string, key: string): CredentialHealth {
    const row = this.row(pluginId, key);
    if (!row) return { state: 'missing' };
    const scheme = schemeOf(row.value);
    if (scheme === 'b64') {
      try {
        decodeInsecure(row.value);
        return { state: 'usable', scheme: 'b64', protection: 'insecure' };
      } catch {
        return { state: 'credential_corrupt', scheme: 'b64' };
      }
    }
    if (scheme === 'gcm1') {
      try {
        const resolved = this.keys.resolveLegacyKey();
        try {
          decryptLegacyValue(resolved.bytes, row.value);
        } finally {
          resolved.bytes.fill(0);
        }
        return { state: 'usable', keyId: 'legacy-v1', scheme: 'gcm1' };
      } catch (error) {
        if (error instanceof SecureStoreLifecycleError) return error.health;
        return { state: 'credential_auth_failed', keyId: 'legacy-v1' };
      }
    }
    if (scheme === 'gcm2') {
      let keyId: string;
      try {
        keyId = parseGcm2(row.value).keyId;
      } catch {
        return { state: 'credential_corrupt', scheme: 'gcm2' };
      }
      try {
        const resolved = this.keys.resolveKey(keyId);
        try {
          decryptGcm2(resolved.bytes, row.value, {
            storeId: resolved.storeId,
            envelopeVersion: 2,
            pluginId,
            credentialKey: key,
            tier: row.tier,
          });
        } finally {
          resolved.bytes.fill(0);
        }
        return { state: 'usable', keyId, scheme: 'gcm2' };
      } catch (error) {
        if (error instanceof SecureStoreLifecycleError) return error.health;
        return { state: 'credential_auth_failed', keyId };
      }
    }
    return { state: 'credential_corrupt' };
  }

  async credentialHealth(pluginId: string, key: string): Promise<CredentialHealth> {
    return this.credentialHealthSync(pluginId, key);
  }

  isEncryptionAvailable(): boolean {
    return this.keys.isKeyringAvailable();
  }

  getSecretSync(pluginId: string, key: string): GetSecretResponse {
    const row = this.row(pluginId, key);
    if (!row) {
      return { success: false, errorCode: 404, errorMessage: 'Credential not found' };
    }
    const scheme = schemeOf(row.value);
    try {
      if (scheme === 'b64') {
        return {
          success: true,
          value: decodeInsecure(row.value),
          health: { state: 'usable', scheme: 'b64', protection: 'insecure' },
        };
      }
      if (scheme === 'gcm1') {
        const resolved = this.keys.resolveLegacyKey();
        try {
          return {
            success: true,
            value: decryptLegacyValue(resolved.bytes, row.value),
            health: { state: 'usable', keyId: 'legacy-v1', scheme: 'gcm1' },
          };
        } finally {
          resolved.bytes.fill(0);
        }
      }
      if (scheme === 'gcm2') {
        const keyId = parseGcm2(row.value).keyId;
        const resolved = this.keys.resolveKey(keyId);
        try {
          return {
            success: true,
            value: decryptGcm2(resolved.bytes, row.value, {
              storeId: resolved.storeId,
              envelopeVersion: 2,
              pluginId,
              credentialKey: key,
              tier: row.tier,
            }),
            health: { state: 'usable', keyId, scheme: 'gcm2' },
          };
        } finally {
          resolved.bytes.fill(0);
        }
      }
      throw new SecureStoreLifecycleError(
        SECURE_STORE_ERROR_CODES.CREDENTIAL_CORRUPT,
        'Stored credential has an unknown encoding scheme.',
        { state: 'credential_corrupt' },
      );
    } catch (error) {
      if (!(error instanceof SecureStoreLifecycleError) && scheme === 'gcm1') {
        return errorResponse(
          new SecureStoreLifecycleError(
            SECURE_STORE_ERROR_CODES.CREDENTIAL_AUTH_FAILED,
            'This credential cannot be authenticated with its recorded key.',
            { state: 'credential_auth_failed', keyId: 'legacy-v1' },
          ),
          this.log,
          `getSecret(${pluginId}:${key})`,
        );
      }
      if (!(error instanceof SecureStoreLifecycleError) && scheme === 'gcm2') {
        let keyId = 'unknown';
        try { keyId = parseGcm2(row.value).keyId; } catch { /* corrupt envelope */ }
        return errorResponse(
          new SecureStoreLifecycleError(
            keyId === 'unknown'
              ? SECURE_STORE_ERROR_CODES.CREDENTIAL_CORRUPT
              : SECURE_STORE_ERROR_CODES.CREDENTIAL_AUTH_FAILED,
            keyId === 'unknown'
              ? 'Stored credential envelope is corrupt.'
              : 'This credential cannot be authenticated with its recorded key.',
            keyId === 'unknown'
              ? { state: 'credential_corrupt', scheme: 'gcm2' }
              : { state: 'credential_auth_failed', keyId },
          ),
          this.log,
          `getSecret(${pluginId}:${key})`,
        );
      }
      return errorResponse(error, this.log, `getSecret(${pluginId}:${key})`);
    }
  }

  private setSecretSyncInternal(
    pluginId: string,
    key: string,
    value: string,
    expectedValue: string | null | typeof NO_EXPECTED_SECRET,
  ): SetSecretResponse {
    const before = this.row(pluginId, key);
    if (expectedValue !== NO_EXPECTED_SECRET) {
      const current = this.getSecretSync(pluginId, key);
      const matches = expectedValue === null
        ? !current.success && current.errorCode === 404
        : current.success && current.value === expectedValue;
      if (!matches) {
        return errorResponse(
          new SecureStoreLifecycleError(
            SECURE_STORE_ERROR_CODES.ROTATION_CONFLICT,
            'Credential changed before compare-and-swap commit.',
            { state: 'credential_corrupt' },
          ),
          this.log,
          `compareAndSwapSecret(${pluginId}:${key})`,
        );
      }
    }
    const existingHealth = this.credentialHealthSync(pluginId, key);
    if (existingHealth.state !== 'missing' && existingHealth.state !== 'usable') {
      return errorResponse(
        new SecureStoreLifecycleError(
          SECURE_STORE_ERROR_CODES.RECOVERY_REQUIRED,
          'The existing unreadable credential must be explicitly replaced or recovered.',
          existingHealth,
        ),
        this.log,
        `setSecret(${pluginId}:${key})`,
      );
    }

    const tier = this.inferTier(pluginId, key);
    let active: ReturnType<SecureStoreKeyManager['activeKeyForWrite']>;
    try {
      active = this.keys.activeKeyForWrite();
    } catch (error) {
      const lifecycle = asLifecycleError(error);
      const isAvailabilityFailure =
        lifecycle.code === SECURE_STORE_ERROR_CODES.KEYRING_UNAVAILABLE;
      // Availability is tested FIRST, on every tier and in every build. The
      // insecure fallback exists for one condition only -- the OS keyring is
      // unreachable -- and must never absorb a lifecycle state that merely
      // reports the store needs recovery or migration. Ordering this after the
      // dev-install T0 bypass let a RECOVERY_REQUIRED (raised because an
      // unreadable cohort was present) reach encodeInsecure() and write a T0
      // OAuth session as cleartext on a dev install (TICKET_1314_3).
      if (!isAvailabilityFailure) {
        return errorResponse(lifecycle, this.log, `setSecret(${pluginId}:${key})`);
      }
      if (tier === CredentialTier.T0_CRITICAL && !this.allowInsecureT0Fallback) {
        return errorResponse(lifecycle, this.log, `setSecret(${pluginId}:${key})`);
      }
      try {
        this.writeEncoded(pluginId, key, encodeInsecure(value), tier, before);
        if (tier === CredentialTier.T0_CRITICAL) {
          return { success: true, warning: 't0-dev-fallback' };
        }
        return tier === CredentialTier.T1_HIGH
          ? { success: true, warning: 't1-fallback' }
          : { success: true };
      } catch (error) {
        return errorResponse(error, this.log, `setSecret(${pluginId}:${key})`);
      }
    }

    try {
      const encoded = active.mode === 'gcm2'
        ? encryptGcm2(active.bytes, value, {
          storeId: active.storeId,
          envelopeVersion: 2,
          keyId: active.keyId,
          pluginId,
          credentialKey: key,
          tier,
        })
        : encryptLegacyValue(active.bytes, value);

      this.immediate(() => {
        if (active.mode === 'gcm2') this.keys.assertGenerationForWrite(active.generation);
        else this.keys.verifyLegacyCohort().bytes.fill(0);
        this.assertRowUnchanged(pluginId, key, before, 'credential write');
        this.upsert(pluginId, key, encoded, tier);
      });
      this.log.debug(`[SecureStore] setSecret: ${pluginId}:${key}`);
      return { success: true };
    } catch (error) {
      return errorResponse(error, this.log, `setSecret(${pluginId}:${key})`);
    } finally {
      active.bytes.fill(0);
    }
  }

  setSecretSync(pluginId: string, key: string, value: string): SetSecretResponse {
    return this.setSecretSyncInternal(pluginId, key, value, NO_EXPECTED_SECRET);
  }

  /**
   * Atomically replaces one decrypted value only when it still equals the
   * caller's previously read value. The encrypted-row snapshot is captured
   * before comparison and fenced again inside SecureStore's IMMEDIATE
   * transaction, so another process cannot commit between comparison and
   * write without producing ROTATION_CONFLICT.
   */
  compareAndSwapSecretSync(
    pluginId: string,
    key: string,
    expectedValue: string | null,
    value: string,
  ): SetSecretResponse {
    return this.setSecretSyncInternal(pluginId, key, value, expectedValue);
  }

  private upsert(pluginId: string, key: string, encoded: string, tier: number): void {
    this.db.prepare(
      `INSERT INTO credentials (plugin_id, key, value, tier, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (plugin_id, key) DO UPDATE SET
         value = excluded.value, tier = excluded.tier, updated_at = excluded.updated_at`,
    ).run(pluginId, key, encoded, tier, Date.now());
  }

  private assertRowUnchanged(
    pluginId: string,
    key: string,
    before: CredentialRow | undefined,
    operation: string,
  ): void {
    const locked = this.row(pluginId, key);
    const unchanged = before
      ? Boolean(locked && locked.value === before.value && locked.tier === before.tier
        && locked.updated_at === before.updated_at)
      : locked === undefined;
    if (!unchanged) {
      throw new SecureStoreLifecycleError(
        SECURE_STORE_ERROR_CODES.ROTATION_CONFLICT,
        `Credential changed during ${operation}.`,
        { state: 'credential_corrupt' },
      );
    }
  }

  private writeEncoded(
    pluginId: string,
    key: string,
    encoded: string,
    tier: number,
    before: CredentialRow | undefined,
  ): void {
    this.immediate(() => {
      this.assertRowUnchanged(pluginId, key, before, 'credential write');
      this.upsert(pluginId, key, encoded, tier);
    });
  }

  deleteSecretSync(pluginId: string, key: string): DeleteSecretResponse {
    const before = this.row(pluginId, key);
    const health = this.credentialHealthSync(pluginId, key);
    if (health.state === 'missing') return { success: true };
    if (health.state !== 'usable') {
      return errorResponse(
        new SecureStoreLifecycleError(
          SECURE_STORE_ERROR_CODES.RECOVERY_REQUIRED,
          'Unreadable credentials require archive-and-delete or confirmed reset.',
          health,
        ),
        this.log,
        `deleteSecret(${pluginId}:${key})`,
      );
    }
    try {
      this.immediate(() => {
        this.assertRowUnchanged(pluginId, key, before, 'credential deletion');
        this.db.prepare('DELETE FROM credentials WHERE plugin_id = ? AND key = ?')
          .run(pluginId, key);
      });
      return { success: true };
    } catch (error) {
      return errorResponse(error, this.log, `deleteSecret(${pluginId}:${key})`);
    }
  }

  /**
   * Explicit replacement protocol. Provider validation must be completed by
   * the owning provider operation before this method is called.
   */
  replaceUnreadableSecretSync(
    pluginId: string,
    key: string,
    value: string,
    expectedHealth: Exclude<CredentialHealth, { state: 'usable' | 'missing' }>,
  ): SetSecretResponse {
    const before = this.row(pluginId, key);
    if (!before) return { success: false, errorCode: 404, errorMessage: 'Credential not found' };
    const currentHealth = this.credentialHealthSync(pluginId, key);
    if (currentHealth.state !== expectedHealth.state) {
      return errorResponse(
        new SecureStoreLifecycleError(
          SECURE_STORE_ERROR_CODES.ROTATION_CONFLICT,
          'Credential state changed before explicit replacement.',
          { state: 'credential_corrupt' },
        ),
        this.log,
        `replaceSecret(${pluginId}:${key})`,
      );
    }

    const tier = this.inferTier(pluginId, key);
    let active: ReturnType<SecureStoreKeyManager['activeKeyForWrite']>;
    try {
      active = this.keys.activeKeyForWrite();
    } catch (error) {
      return errorResponse(error, this.log, `replaceSecret(${pluginId}:${key})`);
    }
    if (active.mode !== 'gcm2') {
      active.bytes.fill(0);
      return errorResponse(
        new SecureStoreLifecycleError(
          SECURE_STORE_ERROR_CODES.MIGRATION_REQUIRED,
          'Explicit replacement requires an initialized gcm2 store.',
          { state: 'migration_required' },
        ),
        this.log,
        `replaceSecret(${pluginId}:${key})`,
      );
    }
    try {
      const encoded = encryptGcm2(active.bytes, value, {
        storeId: active.storeId,
        envelopeVersion: 2,
        keyId: active.keyId,
        pluginId,
        credentialKey: key,
        tier,
      });
      this.immediate(() => {
        this.keys.assertGenerationForWrite(active.generation);
        const locked = this.row(pluginId, key);
        if (!locked || locked.value !== before.value || locked.updated_at !== before.updated_at) {
          throw new SecureStoreLifecycleError(
            SECURE_STORE_ERROR_CODES.ROTATION_CONFLICT,
            'Credential changed during explicit replacement.',
            { state: 'credential_corrupt' },
          );
        }
        const recoveryId = randomUUID();
        this.db.prepare(
          `INSERT INTO credential_recovery_archive
             (recovery_id, plugin_id, key, value, tier, health_state, archived_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          recoveryId,
          pluginId,
          key,
          before.value,
          before.tier,
          expectedHealth.state,
          Date.now(),
        );
        this.upsert(pluginId, key, encoded, tier);
        const writtenRow = this.row(pluginId, key);
        if (!writtenRow || writtenRow.value !== encoded) {
          throw new Error('replacement verification failed: row not persisted');
        }
        const roundTripped = decryptGcm2(active.bytes, encoded, {
          storeId: active.storeId,
          envelopeVersion: 2,
          pluginId,
          credentialKey: key,
          tier,
        });
        if (roundTripped !== value) {
          throw new Error('replacement verification failed: decrypted value mismatch');
        }
        this.db.prepare(
          `INSERT INTO secure_store_audit
             (audit_id, event_type, key_id, generation, detail, created_at)
           VALUES (?, 'credential_replacement', ?, ?, ?, ?)`,
        ).run(
          randomUUID(),
          active.keyId,
          active.generation,
          JSON.stringify({ pluginId, key }),
          Date.now(),
        );
      });
      return { success: true };
    } catch (error) {
      return errorResponse(error, this.log, `replaceSecret(${pluginId}:${key})`);
    } finally {
      active.bytes.fill(0);
    }
  }

  archiveAndDeleteUnreadableSync(
    pluginId: string,
    key: string,
    expectedHealth: Exclude<CredentialHealth, { state: 'usable' | 'missing' }>,
  ): DeleteSecretResponse {
    try {
      this.immediate(() => {
        const row = this.row(pluginId, key);
        if (!row) return;
        const health = this.credentialHealthSync(pluginId, key);
        if (health.state !== expectedHealth.state) {
          throw new SecureStoreLifecycleError(
            SECURE_STORE_ERROR_CODES.ROTATION_CONFLICT,
            'Credential state changed before archive-and-delete.',
            { state: 'credential_corrupt' },
          );
        }
        const recoveryId = randomUUID();
        this.db.prepare(
          `INSERT INTO credential_recovery_archive
             (recovery_id, plugin_id, key, value, tier, health_state, archived_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(recoveryId, pluginId, key, row.value, row.tier, health.state, Date.now());
        const archived = this.db.prepare(
          'SELECT value FROM credential_recovery_archive WHERE recovery_id = ?',
        ).get(recoveryId) as { value: string } | undefined;
        if (!archived || archived.value !== row.value) throw new Error('recovery archive verification failed');
        this.db.prepare('DELETE FROM credentials WHERE plugin_id = ? AND key = ?').run(pluginId, key);
        const state = this.keys.readState();
        this.db.prepare(
          `INSERT INTO secure_store_audit
             (audit_id, event_type, key_id, generation, detail, created_at)
           VALUES (?, 'credential_archive_delete', ?, ?, ?, ?)`,
        ).run(
          randomUUID(),
          state?.activeKeyId ?? null,
          state?.activeGeneration ?? null,
          JSON.stringify({ pluginId, key }),
          Date.now(),
        );
      });
      return { success: true };
    } catch (error) {
      return errorResponse(error, this.log, `archiveAndDelete(${pluginId}:${key})`);
    }
  }

  /**
   * Enumerate every credential the store cannot currently read.
   *
   * Surfaces need this to tell the user *what* is broken before asking them to
   * authorize a reset; without it the only signal is a per-credential error
   * discovered one dialog at a time (TICKET_1314_3).
   */
  listUnreadableCredentialsSync(): UnreadableCredential[] {
    const rows = this.db.prepare(
      'SELECT plugin_id, key, tier FROM credentials ORDER BY plugin_id, key',
    ).all() as Array<{ plugin_id: string; key: string; tier: number }>;
    const unreadable: UnreadableCredential[] = [];
    for (const row of rows) {
      const health = this.credentialHealthSync(row.plugin_id, row.key);
      if (health.state === 'usable' || health.state === 'missing') continue;
      unreadable.push({
        pluginId: row.plugin_id,
        key: row.key,
        tier: row.tier,
        health,
      });
    }
    return unreadable;
  }

  /**
   * Archive and clear the entire unreadable cohort in one transaction.
   *
   * This is the escape hatch from an unrecoverable store. When the OS keyring
   * loses the master key (rebuilt keyring, new machine, changed login
   * password), every row written under the old key is permanently undecryptable
   * -- the plaintext is gone and no amount of retrying recovers it. Before
   * TICKET_1314_3 those rows still blocked their own replacement
   * (`setSecretSync` refuses a non-usable row) while the store simultaneously
   * refused to initialize a new key over them, leaving the user with no route
   * back to a working store from any surface.
   *
   * Ciphertext is preserved in `credential_recovery_archive`, never deleted, so
   * a future recovery path is not foreclosed. Callers MUST have obtained
   * explicit user confirmation: this is destructive to live credentials and the
   * user must re-enter them afterwards.
   */
  resetUnreadableCredentialsSync(): ResetUnreadableResult {
    const targets = this.listUnreadableCredentialsSync();
    if (targets.length === 0) return { success: true, archived: 0, credentials: [] };
    if (this.keys.readState()) {
      return errorResponse(
        new SecureStoreLifecycleError(
          SECURE_STORE_ERROR_CODES.RECOVERY_REQUIRED,
          'GCM2 credentials cannot be reset in place; import a matching recovery bundle.',
          { state: 'recovery_required', recoveryId: 'gcm2-store' },
        ),
        this.log,
        'resetUnreadableCredentials',
      );
    }
    try {
      this.immediate(() => {
        const now = Date.now();
        const state = this.keys.readState();
        for (const target of targets) {
          const row = this.row(target.pluginId, target.key);
          if (!row) continue;
          const recoveryId = randomUUID();
          this.db.prepare(
            `INSERT INTO credential_recovery_archive
               (recovery_id, plugin_id, key, value, tier, health_state, archived_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            recoveryId, target.pluginId, target.key, row.value, row.tier,
            target.health.state, now,
          );
          const archived = this.db.prepare(
            'SELECT value FROM credential_recovery_archive WHERE recovery_id = ?',
          ).get(recoveryId) as { value: string } | undefined;
          if (!archived || archived.value !== row.value) {
            throw new Error('recovery archive verification failed');
          }
          this.db.prepare('DELETE FROM credentials WHERE plugin_id = ? AND key = ?')
            .run(target.pluginId, target.key);
        }
        this.db.prepare(
          `INSERT INTO secure_store_audit
             (audit_id, event_type, key_id, generation, detail, created_at)
           VALUES (?, 'unreadable_cohort_reset', ?, ?, ?, ?)`,
        ).run(
          randomUUID(),
          state?.activeKeyId ?? null,
          state?.activeGeneration ?? null,
          JSON.stringify({
            count: targets.length,
            credentials: targets.map(t => `${t.pluginId}:${t.key}`),
          }),
          now,
        );
      });
    } catch (error) {
      return errorResponse(error, this.log, 'resetUnreadableCredentials');
    }
    return {
      success: true,
      archived: targets.length,
      credentials: targets.map(t => ({ pluginId: t.pluginId, key: t.key })),
    };
  }

  hasCredentialSync(pluginId: string, key: string): boolean {
    return this.row(pluginId, key) !== undefined;
  }

  isCredentialUsableSync(pluginId: string, key: string): boolean {
    return this.credentialHealthSync(pluginId, key).state === 'usable';
  }

  listCredentialKeysSync(pluginId: string): string[] {
    return (this.db.prepare(
      'SELECT key FROM credentials WHERE plugin_id = ? ORDER BY key',
    ).all(pluginId) as Array<{ key: string }>).map(row => row.key);
  }

  listPluginIds(): string[] {
    return (this.db.prepare(
      'SELECT DISTINCT plugin_id FROM credentials ORDER BY plugin_id',
    ).all() as Array<{ plugin_id: string }>).map(row => row.plugin_id);
  }

  async getSecret(pluginId: string, key: string): Promise<GetSecretResponse> {
    return this.getSecretSync(pluginId, key);
  }
  async setSecret(pluginId: string, key: string, value: string): Promise<SetSecretResponse> {
    return this.setSecretSync(pluginId, key, value);
  }

  async compareAndSwapSecret(
    pluginId: string,
    key: string,
    expectedValue: string | null,
    value: string,
  ): Promise<SetSecretResponse> {
    return this.compareAndSwapSecretSync(pluginId, key, expectedValue, value);
  }
  async deleteSecret(pluginId: string, key: string): Promise<DeleteSecretResponse> {
    return this.deleteSecretSync(pluginId, key);
  }
  async hasCredential(pluginId: string, key: string): Promise<boolean> {
    return this.hasCredentialSync(pluginId, key);
  }
  async isCredentialUsable(pluginId: string, key: string): Promise<boolean> {
    return this.isCredentialUsableSync(pluginId, key);
  }
  async listCredentialKeys(pluginId: string): Promise<string[]> {
    return this.listCredentialKeysSync(pluginId);
  }
  async lifecycleStatus(): Promise<SecureStoreLifecycleStatus> {
    return this.lifecycleStatusSync();
  }

  dispose(): void {
    this.keys.dispose();
  }

  async upgradeInsecureRows(): Promise<number> {
    let active: ReturnType<SecureStoreKeyManager['activeKeyForWrite']>;
    try {
      active = this.keys.activeKeyForWrite();
    } catch {
      return 0;
    }
    if (active.mode !== 'gcm2') {
      active.bytes.fill(0);
      return 0;
    }
    try {
      let upgraded = 0;
      this.immediate(() => {
        this.keys.assertGenerationForWrite(active.generation);
        const rows = this.db.prepare(
          `SELECT plugin_id, key, value, tier FROM credentials
            WHERE value LIKE 'b64:%'`,
        ).all() as CredentialRow[];
        for (const row of rows) {
          if (row.tier > CredentialTier.T1_HIGH) continue;
          const plaintext = decodeInsecure(row.value);
          const encoded = encryptGcm2(active.bytes, plaintext, {
            storeId: active.storeId,
            envelopeVersion: 2,
            keyId: active.keyId,
            pluginId: row.plugin_id,
            credentialKey: row.key,
            tier: row.tier,
          });
          this.upsert(row.plugin_id, row.key, encoded, row.tier);
          upgraded++;
        }
      });
      return upgraded;
    } finally {
      active.bytes.fill(0);
    }
  }

  migrateLegacyToGcm2Sync(): LifecycleMutationResponse {
    let legacy: ReturnType<SecureStoreKeyManager['verifyLegacyCohort']>;
    try {
      legacy = this.keys.verifyLegacyCohort();
    } catch (error) {
      const failure = errorResponse(error, this.log, 'migrateLegacy');
      return failure;
    }
    const rows = this.db.prepare(
      `SELECT plugin_id, key, value, tier FROM credentials
        WHERE value LIKE 'gcm1:%' ORDER BY plugin_id, key`,
    ).all() as CredentialRow[];
    const plaintext = new Map<string, string>();
    try {
      for (const row of rows) {
        plaintext.set(`${row.plugin_id}\0${row.key}`, decryptLegacyValue(legacy.bytes, row.value));
      }
      let result: { keyId: string; generation: number } | null = null;
      this.immediate(() => {
        if (this.keys.readState()) {
          throw new SecureStoreLifecycleError(
            SECURE_STORE_ERROR_CODES.ROTATION_CONFLICT,
            'SecureStore state changed before legacy migration acquired the lock.',
            { state: 'credential_corrupt' },
          );
        }
        this.keys.assertProtocol2ActivationAllowed();
        // Recheck the exact cohort after all pre-transaction crypto work.
        const lockedRows = this.db.prepare(
          `SELECT plugin_id, key, value, tier FROM credentials
            WHERE value LIKE 'gcm1:%' ORDER BY plugin_id, key`,
        ).all() as CredentialRow[];
        if (lockedRows.length !== rows.length
          || lockedRows.some((row, index) => row.value !== rows[index]?.value
            || row.plugin_id !== rows[index]?.plugin_id || row.key !== rows[index]?.key)) {
          throw new SecureStoreLifecycleError(
            SECURE_STORE_ERROR_CODES.ROTATION_CONFLICT,
            'Legacy credential cohort changed during migration preparation.',
            { state: 'credential_corrupt' },
          );
        }

        const storeId = randomUUID().replaceAll('-', '');
        const keyId = randomUUID().replaceAll('-', '');
        const created = this.keys.createUniqueCustodyKey(storeId, keyId);
        try {
          const now = Date.now();
          this.db.prepare(
            `INSERT INTO secure_store_key
               (key_id, keyring_account, key_fingerprint, generation,
                lifecycle_status, created_at, activated_at, retired_at)
             VALUES (?, ?, ?, 0, 'retired', ?, ?, ?)`,
          ).run(
            'legacy-v1',
            'secure-store-master-v1',
            // The legacy fingerprint is recorded only after every row proved
            // that this exact key authenticates the complete cohort.
            fingerprintKey(legacy.bytes),
            now,
            now,
            now,
          );
          this.db.prepare(
            `INSERT INTO secure_store_key
               (key_id, keyring_account, key_fingerprint, generation,
                lifecycle_status, created_at, activated_at, retired_at)
             VALUES (?, ?, ?, 1, 'available', ?, ?, NULL)`,
          ).run(keyId, created.account, created.fingerprint, now, now);
          for (const row of lockedRows) {
            const plain = plaintext.get(`${row.plugin_id}\0${row.key}`);
            if (plain === undefined) throw new Error('legacy migration plaintext is missing');
            const encoded = encryptGcm2(created.bytes, plain, {
              storeId,
              envelopeVersion: 2,
              keyId,
              pluginId: row.plugin_id,
              credentialKey: row.key,
              tier: row.tier,
            });
            this.upsert(row.plugin_id, row.key, encoded, row.tier);
            const verified = decryptGcm2(created.bytes, encoded, {
              storeId,
              envelopeVersion: 2,
              pluginId: row.plugin_id,
              credentialKey: row.key,
              tier: row.tier,
            });
            if (verified !== plain) throw new Error('legacy migration verification failed');
          }
          this.db.prepare(
            `INSERT INTO secure_store_state
               (singleton_id, store_id, envelope_version, active_key_id,
                active_generation, minimum_writer_protocol, updated_at)
             VALUES (1, ?, 2, ?, 1, 2, ?)`,
          ).run(storeId, keyId, now);
          this.db.prepare(
            `INSERT INTO secure_store_audit
               (audit_id, event_type, key_id, generation, detail, created_at)
             VALUES (?, 'legacy_migration_commit', ?, 1, NULL, ?)`,
          ).run(randomUUID(), keyId, now);
          result = { keyId, generation: 1 };
        } finally {
          created.bytes.fill(0);
        }
      });
      return { success: true, ...result! };
    } catch (error) {
      const failure = errorResponse(error, this.log, 'migrateLegacy');
      return failure;
    } finally {
      legacy.bytes.fill(0);
      plaintext.clear();
    }
  }

  rotateMasterKeySync(): LifecycleMutationResponse {
    const state = this.keys.readState();
    if (!state) {
      return {
        success: false,
        errorCode: SECURE_STORE_ERROR_CODES.MIGRATION_REQUIRED,
        errorMessage: 'SecureStore must be initialized or migrated before rotation.',
        health: { state: 'migration_required' },
      };
    }
    const rows = this.db.prepare(
      `SELECT plugin_id, key, value, tier FROM credentials
        WHERE value LIKE 'gcm2:%' ORDER BY plugin_id, key`,
    ).all() as CredentialRow[];
    const plaintext = new Map<string, string>();
    try {
      for (const row of rows) {
        const keyId = parseGcm2(row.value).keyId;
        const resolved = this.keys.resolveKey(keyId);
        try {
          plaintext.set(
            `${row.plugin_id}\0${row.key}`,
            decryptGcm2(resolved.bytes, row.value, {
              storeId: resolved.storeId,
              envelopeVersion: 2,
              pluginId: row.plugin_id,
              credentialKey: row.key,
              tier: row.tier,
            }),
          );
        } finally {
          resolved.bytes.fill(0);
        }
      }
      let result: { keyId: string; generation: number } | null = null;
      this.immediate(() => {
        const lockedState = this.keys.assertGenerationForWrite(state.activeGeneration);
        const lockedRows = this.db.prepare(
          `SELECT plugin_id, key, value, tier FROM credentials
            WHERE value LIKE 'gcm2:%' ORDER BY plugin_id, key`,
        ).all() as CredentialRow[];
        if (lockedRows.length !== rows.length
          || lockedRows.some((row, index) => row.value !== rows[index]?.value
            || row.plugin_id !== rows[index]?.plugin_id || row.key !== rows[index]?.key)) {
          throw new SecureStoreLifecycleError(
            SECURE_STORE_ERROR_CODES.ROTATION_CONFLICT,
            'Credential cohort changed during rotation preparation.',
            { state: 'credential_corrupt' },
          );
        }
        const generation = lockedState.activeGeneration + 1;
        const keyId = randomUUID().replaceAll('-', '');
        const created = this.keys.createUniqueCustodyKey(lockedState.storeId, keyId);
        try {
          const now = Date.now();
          this.db.prepare(
            `INSERT INTO secure_store_key
               (key_id, keyring_account, key_fingerprint, generation,
                lifecycle_status, created_at, activated_at, retired_at)
             VALUES (?, ?, ?, ?, 'available', ?, ?, NULL)`,
          ).run(keyId, created.account, created.fingerprint, generation, now, now);
          for (const row of lockedRows) {
            const plain = plaintext.get(`${row.plugin_id}\0${row.key}`);
            if (plain === undefined) throw new Error('rotation plaintext is missing');
            const encoded = encryptGcm2(created.bytes, plain, {
              storeId: lockedState.storeId,
              envelopeVersion: 2,
              keyId,
              pluginId: row.plugin_id,
              credentialKey: row.key,
              tier: row.tier,
            });
            this.upsert(row.plugin_id, row.key, encoded, row.tier);
            if (decryptGcm2(created.bytes, encoded, {
              storeId: lockedState.storeId,
              envelopeVersion: 2,
              pluginId: row.plugin_id,
              credentialKey: row.key,
              tier: row.tier,
            }) !== plain) throw new Error('rotation verification failed');
          }
          this.db.prepare(
            `UPDATE secure_store_state
                SET active_key_id = ?, active_generation = ?, updated_at = ?
              WHERE singleton_id = 1 AND active_generation = ?`,
          ).run(keyId, generation, now, lockedState.activeGeneration);
          this.db.prepare(
            `UPDATE secure_store_key
                SET lifecycle_status = 'retired', retired_at = ?
              WHERE key_id = ?`,
          ).run(now, lockedState.activeKeyId);
          this.db.prepare(
            `INSERT INTO secure_store_audit
               (audit_id, event_type, key_id, generation, detail, created_at)
             VALUES (?, 'rotation_commit', ?, ?, NULL, ?)`,
          ).run(randomUUID(), keyId, generation, now);
          result = { keyId, generation };
        } finally {
          created.bytes.fill(0);
        }
      });
      return { success: true, ...result! };
    } catch (error) {
      const failure = errorResponse(error, this.log, 'rotateMasterKey');
      return failure;
    } finally {
      plaintext.clear();
    }
  }

  exportRecoveryBundleSync(passphrase: string): RecoveryExportResponse {
    const state = this.keys.readState();
    if (!state) {
      return {
        success: false,
        errorCode: SECURE_STORE_ERROR_CODES.MIGRATION_REQUIRED,
        errorMessage: 'SecureStore must be migrated before recovery export.',
        health: { state: 'migration_required' },
      };
    }
    const keyIds = new Set<string>([state.activeKeyId]);
    const collect = (table: string): void => {
      const rows = this.db.prepare(`SELECT value FROM ${table}`).all() as Array<{ value: string }>;
      for (const row of rows) {
        const scheme = schemeOf(row.value);
        if (scheme === 'gcm1') keyIds.add('legacy-v1');
        if (scheme === 'gcm2') keyIds.add(parseGcm2(row.value).keyId);
      }
    };
    collect('credentials');
    collect('credential_recovery_archive');
    return this.exportRecoverySelectionSync(
      { storeId: state.storeId, keyIds: [...keyIds] },
      passphrase,
    );
  }

  /**
   * Export exactly a verified snapshot/manifest key selection. Backup content
   * verification belongs to the backup registry; this operation owns custody
   * resolution and the encrypted bundle contract.
   */
  exportRecoverySelectionSync(
    selection: RecoveryKeySelection,
    passphrase: string,
  ): RecoveryExportResponse {
    const state = this.keys.readState();
    if (!state || selection.storeId !== state.storeId) {
      return errorResponse(
        new SecureStoreLifecycleError(
          SECURE_STORE_ERROR_CODES.RECOVERY_BUNDLE_INVALID,
          'Recovery key selection store ID does not match this SecureStore.',
          { state: 'credential_corrupt' },
        ),
        this.log,
        'exportRecoverySelection',
      );
    }
    const keyIds = [...new Set(selection.keyIds)].sort();
    if (keyIds.length === 0) {
      return errorResponse(
        new SecureStoreLifecycleError(
          SECURE_STORE_ERROR_CODES.RECOVERY_BUNDLE_INVALID,
          'Recovery key selection is empty.',
          { state: 'credential_corrupt' },
        ),
        this.log,
        'exportRecoverySelection',
      );
    }
    const materials: RecoveryKeyMaterial[] = [];
    try {
      for (const keyId of keyIds) {
        const metadata = this.keys.readMetadata(keyId);
        if (!metadata) throw new Error(`SecureStore metadata for key ${keyId} is missing`);
        const resolved = this.keys.resolveKey(keyId);
        materials.push({
          keyId,
          generation: metadata.generation,
          fingerprint: metadata.fingerprint,
          bytes: resolved.bytes,
        });
      }
      const bundle = exportRecoveryBundle(selection.storeId, materials, passphrase);
      return { success: true, bundle };
    } catch (error) {
      return errorResponse(error, this.log, 'exportRecoverySelection');
    } finally {
      for (const material of materials) material.bytes.fill(0);
    }
  }

  importRecoveryBundleSync(bundle: Buffer, passphrase: string): LifecycleMutationResponse {
    const state = this.keys.readState();
    if (!state) {
      return {
        success: false,
        errorCode: SECURE_STORE_ERROR_CODES.MIGRATION_REQUIRED,
        errorMessage: 'SecureStore state is required before recovery import.',
        health: { state: 'migration_required' },
      };
    }
    let imported: ReturnType<typeof importRecoveryBundle>;
    try {
      // Parsing, KDF work, and authentication happen before the lifecycle
      // transaction. The transaction rechecks every depended-on value below.
      imported = importRecoveryBundle(bundle, state.storeId, passphrase);
    } catch (error) {
      return errorResponse(error, this.log, 'importRecoveryBundle');
    }
    const importedById = new Map(imported.keys.map(key => [key.keyId, key]));
    const rows = [
      ...(this.db.prepare(
        `SELECT plugin_id, key, value, tier FROM credentials
          WHERE value LIKE 'gcm2:%' ORDER BY plugin_id, key`,
      ).all() as CredentialRow[]),
      ...(this.db.prepare(
        `SELECT plugin_id, key, value, tier FROM credential_recovery_archive
          WHERE value LIKE 'gcm2:%' ORDER BY plugin_id, key, recovery_id`,
      ).all() as CredentialRow[]),
    ];
    try {
      for (const row of rows) {
        const keyId = parseGcm2(row.value).keyId;
        const material = importedById.get(keyId);
        if (!material) continue;
        decryptGcm2(material.bytes, row.value, {
          storeId: state.storeId,
          envelopeVersion: 2,
          pluginId: row.plugin_id,
          credentialKey: row.key,
          tier: row.tier,
        });
      }

      this.immediate(() => {
        const lockedState = this.keys.readState();
        if (!lockedState || lockedState.storeId !== state.storeId
          || lockedState.activeGeneration !== state.activeGeneration
          || lockedState.minimumWriterProtocol !== state.minimumWriterProtocol) {
          throw new SecureStoreLifecycleError(
            SECURE_STORE_ERROR_CODES.ROTATION_CONFLICT,
            'SecureStore state changed during recovery preparation.',
            { state: 'credential_corrupt' },
          );
        }
        const lockedRows = [
          ...(this.db.prepare(
            `SELECT plugin_id, key, value, tier FROM credentials
              WHERE value LIKE 'gcm2:%' ORDER BY plugin_id, key`,
          ).all() as CredentialRow[]),
          ...(this.db.prepare(
            `SELECT plugin_id, key, value, tier FROM credential_recovery_archive
              WHERE value LIKE 'gcm2:%' ORDER BY plugin_id, key, recovery_id`,
          ).all() as CredentialRow[]),
        ];
        if (lockedRows.length !== rows.length
          || lockedRows.some((row, index) => row.value !== rows[index]?.value
            || row.plugin_id !== rows[index]?.plugin_id || row.key !== rows[index]?.key)) {
          throw new SecureStoreLifecycleError(
            SECURE_STORE_ERROR_CODES.ROTATION_CONFLICT,
            'Credential cohort changed during recovery preparation.',
            { state: 'credential_corrupt' },
          );
        }

        for (const material of imported.keys) {
          const metadata = this.keys.readMetadata(material.keyId);
          if (!metadata || metadata.fingerprint !== material.fingerprint
            || metadata.generation !== material.generation) {
            throw new SecureStoreLifecycleError(
              SECURE_STORE_ERROR_CODES.KEY_IDENTITY_MISMATCH,
              'Recovery key metadata conflicts with this SecureStore.',
              { state: 'key_identity_mismatch', keyId: material.keyId },
            );
          }
          let needsBinding = false;
          try {
            const existing = this.keys.resolveKey(material.keyId);
            existing.bytes.fill(0);
          } catch (error) {
            if (error instanceof SecureStoreLifecycleError
              && error.health.state === 'master_key_missing') {
              needsBinding = true;
            } else {
              throw error;
            }
          }
          if (!needsBinding) continue;
          const created = this.keys.createUniqueCustodyAccount(
            state.storeId,
            material.keyId,
            () => Buffer.from(material.bytes),
          );
          try {
            this.db.prepare(
              `UPDATE secure_store_key SET keyring_account = ? WHERE key_id = ?`,
            ).run(created.account, material.keyId);
          } finally {
            created.bytes.fill(0);
          }
        }
        this.db.prepare(
          `INSERT INTO secure_store_audit
             (audit_id, event_type, key_id, generation, detail, created_at)
           VALUES (?, 'recovery_import_commit', ?, ?, NULL, ?)`,
        ).run(randomUUID(), state.activeKeyId, state.activeGeneration, Date.now());
      });
      return {
        success: true,
        keyId: state.activeKeyId,
        generation: state.activeGeneration,
      };
    } catch (error) {
      return errorResponse(error, this.log, 'importRecoveryBundle');
    } finally {
      for (const material of imported.keys) material.bytes.fill(0);
    }
  }
}
