import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { SECURE_STORE_ERROR_CODES, type CredentialHealth } from '@StratCraft/types';
import {
  LEGACY_KEYRING_ACCOUNT,
  MASTER_KEY_BYTES,
  fingerprintKey,
  type KeyringAdapter,
  type KeyringReadResult,
} from './master-key';
import {
  SECURE_STORE_CUSTODY_LOCATOR_BYTES,
  SECURE_STORE_ENVELOPE_VERSION,
  SECURE_STORE_KEY_ACCOUNT_PREFIX,
  SECURE_STORE_KEY_ID_BYTES,
  SECURE_STORE_MAX_ACCOUNT_CREATE_ATTEMPTS,
  SECURE_STORE_STORE_ID_BYTES,
  SECURE_STORE_WRITER_LEASE_MS,
  SECURE_STORE_WRITER_PROTOCOL,
} from './constants';
import { decryptLegacyValue, schemeOf } from './crypto';
import { SecureStoreLifecycleError, keyringFailure } from './errors';

export interface SqliteStatement {
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): { changes?: number; lastInsertRowid?: number | bigint } | unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteTransaction<T> {
  (): T;
  immediate?: () => T;
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): unknown;
  pragma(sql: string, options?: { simple?: boolean }): unknown;
  transaction?<T>(fn: () => T): SqliteTransaction<T>;
  transactionImmediate?<T>(fn: () => T): () => T;
}

export interface SecureStoreKeyMetadata {
  keyId: string;
  account: string;
  fingerprint: string;
  generation: number;
  lifecycleStatus: 'available' | 'retired';
}

export interface SecureStoreState {
  storeId: string;
  envelopeVersion: number;
  activeKeyId: string;
  activeGeneration: number;
  minimumWriterProtocol: number;
}

export interface ResolvedMasterKey {
  bytes: Buffer;
  keyId: string;
  generation: number;
  storeId: string;
  mode: 'gcm2' | 'gcm1';
}

export interface KeyManagerLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

interface CredentialRow {
  plugin_id: string;
  key: string;
  value: string;
  tier: number;
}

function randomIdentity(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export class SecureStoreKeyManager {
  private readonly writerId = randomUUID();
  private readonly startedAt = Date.now();

  constructor(
    private readonly db: SqliteDatabase,
    private readonly keyring: KeyringAdapter,
    private readonly log: KeyManagerLogger,
    private readonly processKind: string,
    private readonly buildId: string,
    private readonly writerProtocol = SECURE_STORE_WRITER_PROTOCOL,
  ) {}

  private immediate<T>(fn: () => T): T {
    if (this.db.transactionImmediate) return this.db.transactionImmediate(fn)();
    if (this.db.transaction) {
      const transaction = this.db.transaction(fn);
      if (transaction.immediate) return transaction.immediate();
      return transaction();
    }
    throw new Error('SecureStore lifecycle requires an immediate SQLite transaction');
  }

  readState(): SecureStoreState | null {
    const row = this.db.prepare(
      `SELECT store_id, envelope_version, active_key_id, active_generation,
              minimum_writer_protocol
         FROM secure_store_state WHERE singleton_id = 1`,
    ).get() as {
      store_id: string;
      envelope_version: number;
      active_key_id: string;
      active_generation: number;
      minimum_writer_protocol: number;
    } | undefined;
    return row ? {
      storeId: row.store_id,
      envelopeVersion: row.envelope_version,
      activeKeyId: row.active_key_id,
      activeGeneration: row.active_generation,
      minimumWriterProtocol: row.minimum_writer_protocol,
    } : null;
  }

  readMetadata(keyId: string): SecureStoreKeyMetadata | null {
    const row = this.db.prepare(
      `SELECT key_id, keyring_account, key_fingerprint, generation, lifecycle_status
         FROM secure_store_key WHERE key_id = ?`,
    ).get(keyId) as {
      key_id: string;
      keyring_account: string;
      key_fingerprint: string;
      generation: number;
      lifecycle_status: 'available' | 'retired';
    } | undefined;
    return row ? {
      keyId: row.key_id,
      account: row.keyring_account,
      fingerprint: row.key_fingerprint,
      generation: row.generation,
      lifecycleStatus: row.lifecycle_status,
    } : null;
  }

  private missingKey(keyId: string): SecureStoreLifecycleError {
    return new SecureStoreLifecycleError(
      SECURE_STORE_ERROR_CODES.MASTER_KEY_MISSING,
      'Encrypted credentials exist, but their encryption key is missing.',
      { state: 'master_key_missing', keyId, recoverable: true },
    );
  }

  private resolveReadResult(
    keyId: string,
    expectedFingerprint: string,
    result: KeyringReadResult,
  ): Buffer {
    if (result.kind === 'missing') throw this.missingKey(keyId);
    if (result.kind !== 'found') {
      const failure = keyringFailure(result);
      if (result.kind === 'malformed') {
        throw new SecureStoreLifecycleError(
          SECURE_STORE_ERROR_CODES.MASTER_KEY_MALFORMED,
          failure.message,
          { state: 'master_key_malformed', keyId },
        );
      }
      throw failure;
    }
    const expected = Buffer.from(expectedFingerprint, 'hex');
    const actual = Buffer.from(fingerprintKey(result.bytes), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      result.bytes.fill(0);
      throw new SecureStoreLifecycleError(
        SECURE_STORE_ERROR_CODES.KEY_IDENTITY_MISMATCH,
        'The system key does not match the recorded SecureStore key identity.',
        { state: 'key_identity_mismatch', keyId },
      );
    }
    return result.bytes;
  }

  resolveKey(keyId: string): ResolvedMasterKey {
    const state = this.readState();
    const metadata = this.readMetadata(keyId);
    if (!state || !metadata) throw this.missingKey(keyId);
    const bytes = this.resolveReadResult(
      keyId,
      metadata.fingerprint,
      this.keyring.read(metadata.account),
    );
    return {
      bytes,
      keyId,
      generation: metadata.generation,
      storeId: state.storeId,
      mode: 'gcm2',
    };
  }

  resolveLegacyKey(): ResolvedMasterKey {
    const result = this.keyring.read(LEGACY_KEYRING_ACCOUNT);
    if (result.kind === 'missing') throw this.missingKey('legacy-v1');
    if (result.kind !== 'found') throw keyringFailure(result);
    return {
      bytes: result.bytes,
      keyId: 'legacy-v1',
      generation: 0,
      storeId: 'legacy-v1',
      mode: 'gcm1',
    };
  }

  /**
   * Probe custody without creating or replacing a key. A missing account is a
   * successful backend response and therefore means the keyring is reachable.
   */
  isKeyringAvailable(): boolean {
    const state = this.readState();
    if (state) {
      const metadata = this.readMetadata(state.activeKeyId);
      if (!metadata) return false;
      const result = this.keyring.read(metadata.account);
      if (result.kind !== 'found') return false;
      try {
        const expected = Buffer.from(metadata.fingerprint, 'hex');
        const actual = Buffer.from(fingerprintKey(result.bytes), 'hex');
        return expected.length === actual.length && timingSafeEqual(expected, actual);
      } finally {
        result.bytes.fill(0);
      }
    }
    const probe = this.keyring.read(LEGACY_KEYRING_ACCOUNT);
    if (probe.kind === 'found') probe.bytes.fill(0);
    return probe.kind === 'found' || probe.kind === 'missing';
  }

  private encryptedRows(): CredentialRow[] {
    return this.db.prepare(
      `SELECT plugin_id, key, value, tier FROM credentials
        WHERE value LIKE 'gcm1:%' OR value LIKE 'gcm2:%'`,
    ).all() as CredentialRow[];
  }

  verifyLegacyCohort(): ResolvedMasterKey {
    const rows = this.encryptedRows().filter(row => schemeOf(row.value) === 'gcm1');
    const key = this.resolveLegacyKey();
    try {
      for (const row of rows) decryptLegacyValue(key.bytes, row.value);
      return key;
    } catch {
      key.bytes.fill(0);
      throw new SecureStoreLifecycleError(
        SECURE_STORE_ERROR_CODES.RECOVERY_REQUIRED,
        'The legacy encrypted credential cohort cannot be authenticated.',
        { state: 'recovery_required', recoveryId: 'legacy-v1' },
      );
    }
  }

  createUniqueCustodyKey(storeId: string, keyId: string): {
    account: string;
    bytes: Buffer;
    fingerprint: string;
  } {
    return this.createUniqueCustodyAccount(storeId, keyId, () => randomBytes(MASTER_KEY_BYTES));
  }

  createUniqueCustodyAccount(
    storeId: string,
    keyId: string,
    keyFactory: () => Buffer,
  ): { account: string; bytes: Buffer; fingerprint: string } {
    for (let attempt = 0; attempt < SECURE_STORE_MAX_ACCOUNT_CREATE_ATTEMPTS; attempt++) {
      const locator = randomIdentity(SECURE_STORE_CUSTODY_LOCATOR_BYTES);
      const account = `${SECURE_STORE_KEY_ACCOUNT_PREFIX}:${storeId}:${keyId}:${locator}`;
      const candidate = keyFactory();
      if (candidate.length !== MASTER_KEY_BYTES) {
        candidate.fill(0);
        throw new Error('SecureStore custody key must be 32 bytes');
      }
      const created = this.keyring.createFresh(account, candidate);
      candidate.fill(0);
      if (created.kind === 'conflict') continue;
      if (created.kind !== 'created') {
        if (created.kind === 'malformed') {
          throw new SecureStoreLifecycleError(
            SECURE_STORE_ERROR_CODES.MASTER_KEY_MALFORMED,
            created.cause,
            { state: 'master_key_malformed', keyId },
          );
        }
        throw keyringFailure(created);
      }
      return {
        account,
        bytes: created.bytes,
        fingerprint: fingerprintKey(created.bytes),
      };
    }
    throw new SecureStoreLifecycleError(
      SECURE_STORE_ERROR_CODES.ROTATION_CONFLICT,
      'Could not allocate a unique keyring custody account.',
      { state: 'credential_corrupt' },
    );
  }

  /**
   * Guard fresh (generation 1) initialization.
   *
   * Live encrypted rows, an existing key registry, and an in-flight lifecycle
   * journal all mean the store is not fresh and must be migrated or recovered
   * instead.
   *
   * `credential_recovery_archive` is deliberately NOT part of this test.
   * Archived rows are ciphertext that has already been *resolved* -- explicitly
   * replaced or archive-deleted -- and retained only so a future recovery path
   * is not foreclosed. Counting them here made archiving a one-way door: a host
   * that lost its keyring could archive its unreadable cohort and still be
   * unable to initialize, leaving no route back to a working store
   * (TICKET_1314_3). Archive retention must never block initialization.
   */
  private assertFreshInitializationAllowed(): void {
    if (this.readState()) throw new Error('SecureStore state already exists');
    const keyCount = this.db.prepare('SELECT COUNT(*) AS count FROM secure_store_key')
      .get() as { count: number };
    const encryptedCount = this.db.prepare(
      `SELECT COUNT(*) AS count FROM credentials
        WHERE value LIKE 'gcm1:%' OR value LIKE 'gcm2:%'`,
    ).get() as { count: number };
    const journalCount = this.db.prepare(
      'SELECT COUNT(*) AS count FROM secure_store_lifecycle_journal',
    ).get() as { count: number };
    if (keyCount.count !== 0 || encryptedCount.count !== 0 || journalCount.count !== 0) {
      throw new SecureStoreLifecycleError(
        SECURE_STORE_ERROR_CODES.MIGRATION_REQUIRED,
        'Existing encrypted or lifecycle state must be recovered or migrated before initialization.',
        { state: 'migration_required' },
      );
    }
  }

  private registerWriter(state: SecureStoreState): void {
    if (this.writerProtocol < state.minimumWriterProtocol) {
      throw new SecureStoreLifecycleError(
        SECURE_STORE_ERROR_CODES.WRITER_UPGRADE_REQUIRED,
        `SecureStore writer protocol ${state.minimumWriterProtocol} is required.`,
        { state: 'writer_upgrade_required', minimumProtocol: state.minimumWriterProtocol },
      );
    }
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO secure_store_writer_lease
         (writer_id, process_kind, protocol_version, build_id, started_at,
          heartbeat_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(writer_id) DO UPDATE SET
         heartbeat_at = excluded.heartbeat_at,
         expires_at = excluded.expires_at`,
    ).run(
      this.writerId,
      this.processKind,
      this.writerProtocol,
      this.buildId,
      this.startedAt,
      now,
      now + SECURE_STORE_WRITER_LEASE_MS,
    );
  }

  registerLegacyWriter(): void {
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO secure_store_writer_lease
         (writer_id, process_kind, protocol_version, build_id, started_at,
          heartbeat_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(writer_id) DO UPDATE SET
         heartbeat_at = excluded.heartbeat_at,
         expires_at = excluded.expires_at`,
    ).run(
      this.writerId,
      this.processKind,
      this.writerProtocol,
      this.buildId,
      this.startedAt,
      now,
      now + SECURE_STORE_WRITER_LEASE_MS,
    );
  }

  assertProtocol2ActivationAllowed(): void {
    if (this.writerProtocol < 2) {
      throw new SecureStoreLifecycleError(
        SECURE_STORE_ERROR_CODES.WRITER_UPGRADE_REQUIRED,
        'Protocol-2 activation requires a protocol-2 migration host.',
        { state: 'writer_upgrade_required', minimumProtocol: 2 },
      );
    }
    const liveLegacy = this.db.prepare(
      `SELECT writer_id FROM secure_store_writer_lease
        WHERE writer_id <> ? AND protocol_version < 2 AND expires_at > ?
        LIMIT 1`,
    ).get(this.writerId, Date.now());
    if (liveLegacy) {
      throw new SecureStoreLifecycleError(
        SECURE_STORE_ERROR_CODES.WRITER_UPGRADE_REQUIRED,
        'A live protocol-1 SecureStore writer blocks protocol-2 activation.',
        { state: 'writer_upgrade_required', minimumProtocol: 2 },
      );
    }
  }

  activeKeyForWrite(): ResolvedMasterKey {
    return this.immediate(() => {
      let state = this.readState();
      if (!state) {
        const encrypted = this.encryptedRows();
        const hasGcm2 = encrypted.some(row => schemeOf(row.value) === 'gcm2');
        const hasGcm1 = encrypted.some(row => schemeOf(row.value) === 'gcm1');
        if (hasGcm2) {
          throw new SecureStoreLifecycleError(
            SECURE_STORE_ERROR_CODES.MIGRATION_REQUIRED,
            'gcm2 credentials exist without SecureStore key metadata.',
            { state: 'migration_required' },
          );
        }
        if (hasGcm1) {
          const legacy = this.verifyLegacyCohort();
          this.registerLegacyWriter();
          return legacy;
        }

        this.assertFreshInitializationAllowed();
        const storeId = randomIdentity(SECURE_STORE_STORE_ID_BYTES);
        const keyId = randomIdentity(SECURE_STORE_KEY_ID_BYTES);
        const created = this.createUniqueCustodyKey(storeId, keyId);
        const now = Date.now();
        this.db.prepare(
          `INSERT INTO secure_store_key
             (key_id, keyring_account, key_fingerprint, generation,
              lifecycle_status, created_at, activated_at, retired_at)
           VALUES (?, ?, ?, 1, 'available', ?, ?, NULL)`,
        ).run(keyId, created.account, created.fingerprint, now, now);
        this.db.prepare(
          `INSERT INTO secure_store_state
             (singleton_id, store_id, envelope_version, active_key_id,
              active_generation, minimum_writer_protocol, updated_at)
           VALUES (1, ?, ?, ?, 1, ?, ?)`,
        ).run(
          storeId,
          SECURE_STORE_ENVELOPE_VERSION,
          keyId,
          this.writerProtocol,
          now,
        );
        state = this.readState();
        if (!state) {
          created.bytes.fill(0);
          throw new Error('SecureStore state creation did not round-trip');
        }
        this.registerWriter(state);
        this.log.info(`[SecureStore] initialized generation 1 key ${keyId}`);
        return {
          bytes: created.bytes,
          keyId,
          generation: 1,
          storeId,
          mode: 'gcm2',
        };
      }

      this.registerWriter(state);
      const metadata = this.readMetadata(state.activeKeyId);
      if (!metadata || metadata.generation !== state.activeGeneration) {
        throw new SecureStoreLifecycleError(
          SECURE_STORE_ERROR_CODES.KEY_IDENTITY_MISMATCH,
          'SecureStore active-key metadata is inconsistent.',
          { state: 'key_identity_mismatch', keyId: state.activeKeyId },
        );
      }
      const bytes = this.resolveReadResult(
        metadata.keyId,
        metadata.fingerprint,
        this.keyring.read(metadata.account),
      );
      return {
        bytes,
        keyId: metadata.keyId,
        generation: metadata.generation,
        storeId: state.storeId,
        mode: 'gcm2',
      };
    });
  }

  assertGenerationForWrite(expectedGeneration: number): SecureStoreState {
    const state = this.readState();
    if (!state || state.activeGeneration !== expectedGeneration) {
      throw new SecureStoreLifecycleError(
        SECURE_STORE_ERROR_CODES.ROTATION_CONFLICT,
        'The SecureStore active generation changed during the credential write.',
        { state: 'credential_corrupt' },
      );
    }
    this.registerWriter(state);
    return state;
  }

  credentialHealthFromError(error: unknown): Exclude<CredentialHealth, { state: 'usable' }> {
    if (error instanceof SecureStoreLifecycleError) return error.health;
    return { state: 'credential_corrupt' };
  }

  dispose(): void {
    try {
      this.db.prepare(
        'DELETE FROM secure_store_writer_lease WHERE writer_id = ?',
      ).run(this.writerId);
      this.db.prepare(
        'DELETE FROM secure_store_writer_lease WHERE expires_at < ?',
      ).run(Date.now());
    } catch {
      // Best-effort cleanup; the DB may already be closed.
    }
  }
}
