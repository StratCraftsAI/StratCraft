/**
 * V3 Secure Credential Service
 *
 * TICKET_134: V3 Credential Service Implementation
 * TICKET_580_2: Credential Store Security Strategy - Tier enforcement + audit
 * TICKET_1276 P0: backend swapped from Electron-captive safeStorage +
 *   electron-store to the cross-process `@StratCraft/secure-store` (OS-keyring
 *   master key + AES-256-GCM over the shared main SQLite DB). The MCP standalone
 *   server now reads/writes the SAME credential rows without Electron, which is
 *   the root-cause fix for the bridge-captive LLM credential path.
 *
 * Public API (unchanged -- matches the historical CoreClient interface):
 * - getSecret(pluginId, key)
 * - setSecret(pluginId, key, value)
 * - deleteSecret(pluginId, key)
 * - hasCredential(pluginId, key)
 * - listCredentialKeys(pluginId)
 *
 * Security tiers (TICKET_580_2) are enforced INSIDE secure-store (single owner),
 * so a T0 write is refused without the keyring no matter which process writes.
 * The dev-mode T0 fallback flag (TICKET_587) is passed through from `!app.isPackaged`.
 */

import { EventEmitter } from 'events';
import { app, safeStorage } from 'electron';
import Store from 'electron-store';
import fs from 'fs';
import path from 'path';
import {
  SecureStore,
  createKeyringAdapter,
  type SecureStoreLogger,
  type MasterKeyProvider,
  type KeyringAdapter,
  type SqliteDatabase,
  type UnreadableCredential,
  type ResetUnreadableResult,
  type LifecycleMutationResponse,
  type SecureStoreLifecycleStatus,
  type RecoveryKeySelection,
} from '@StratCraft/secure-store';
import {
  AGENT_PERMISSION_AUTHORITY_NAMESPACE,
  LLM_CREDENTIAL_KEYS,
  SECURE_STORE_ERROR_CODES,
  type CredentialHealth,
  type SecureStoreErrorCode,
} from '@StratCraft/types'; // TICKET_1023_6
import { getDatabaseManager } from '../database/db-manager';
import { appLog } from '../utils/logger';
import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from './locale-service';
import {
  CredentialTier,
  inferCredentialTier,
  type CredentialAuditEntry,
} from '../../shared/constants/credential-tiers';

// =============================================================================
// Types (matching gRPC CoreClient interface)
// =============================================================================

/** Legacy electron-store schema -- read only, for the one-way P0 migration. */
interface LegacyCredentialStoreSchema {
  credentials: Record<string, Record<string, string>>; // pluginId -> key -> safeStorage-b64
}

export interface GetSecretResponse {
  success: boolean;
  value?: string;
  errorCode?: number | SecureStoreErrorCode;
  errorMessage?: string;
  health?: CredentialHealth;
}

export interface SetSecretResponse {
  success: boolean;
  errorCode?: number | SecureStoreErrorCode;
  errorMessage?: string;
  health?: Exclude<CredentialHealth, { state: 'usable' }>;
}

export interface DeleteSecretResponse {
  success: boolean;
  errorCode?: number | SecureStoreErrorCode;
  errorMessage?: string;
  health?: Exclude<CredentialHealth, { state: 'usable' }>;
}

// =============================================================================
// Constants
// =============================================================================

/** Maximum audit log entries (ring buffer) */
const AUDIT_LOG_MAX_ENTRIES = 500;

/** TICKET_588: Old plugin ID prefix from QuantNexus era */
const OLD_PLUGIN_PREFIX = 'com.quantnexus.';

/** TICKET_588: New plugin ID prefix for StratCraft */
const NEW_PLUGIN_PREFIX = 'com.stratcraft.';

/** TICKET_809_2: Synthetic pluginId for global credentials (LLM, OAuth). */
const HOST_PLUGIN_ID = 'host';

/** TICKET_809_2: Source pluginIds whose global-shape keys move to 'host'. */
const MIGRATION_809_2_SOURCES: readonly string[] = [
  'com.stratcraft.strategy-builder-nexus',
  'com.stratcraft.auth',
];

/**
 * TICKET_1276 P0: marker key (in the secure-store `credentials` table under the
 * synthetic `__migration__` plugin id) recording that the one-way
 * safeStorage -> secure-store migration completed. Its presence blocks re-runs.
 */
const MIGRATION_PLUGIN_ID = '__migration__';
const SAFE_STORAGE_MIGRATION_KEY = 'safe_storage_to_secure_store_v1';
const PLUGIN_ID_CONSOLIDATION_KEY = 'plugin_id_consolidation_v1';

/**
 * TICKET_809_2: Pattern list determining which keys are global.
 *
 * Source-of-truth lock-in: union of all keys declared in credential-tiers.ts
 * TIER_REGISTRY with domain == 'llm' or starting with 'oauth_'. Any future
 * global credential MUST add a tier entry AND an entry here.
 */
const GLOBAL_KEY_PATTERNS: ReadonlyArray<RegExp | string> = [
  /^llm\.[a-z]+\.apiKey$/,
  /^llm\.validated\.[a-z]+$/,
  LLM_CREDENTIAL_KEYS.OLLAMA_BASE_URL,
  'oauth_tokens',
  'oauth_user',
];

/** TICKET_809_2: Match a credential key against the global pattern list. */
function isGlobalCredentialKey(key: string): boolean {
  for (const pat of GLOBAL_KEY_PATTERNS) {
    if (typeof pat === 'string') {
      if (pat === key) return true;
    } else {
      if (pat.test(key)) return true;
    }
  }
  return false;
}

export { HOST_PLUGIN_ID, isGlobalCredentialKey };

/**
 * TICKET_587: Development-mode T0 credential fallback.
 *
 * In headless/SSH environments where the OS keyring is unavailable, T0
 * credentials are normally rejected (TICKET_580_2). In dev mode, allow fallback
 * to unencrypted b64 storage so OAuth tokens can persist across restarts.
 * Production builds (`app.isPackaged`) always enforce strict T0 rejection.
 */
function isDevModeT0FallbackAllowed(): boolean {
  return !app.isPackaged;
}

/** Adapt the appLog surface to the secure-store logger contract. */
const secureStoreLog: SecureStoreLogger = {
  info: (m: string) => appLog.info(m),
  warn: (m: string) => appLog.warn(m),
  error: (m: string) => appLog.error(m),
  debug: (m: string) => appLog.debug(m),
};

// =============================================================================
// SecureCredentialService Class
// =============================================================================

/**
 * Optional constructor injection. Production passes nothing -- the DB is the
 * shared main SQLite handle and the master key comes from the OS keyring. Tests
 * (and, later, alternate host processes) can inject a fake DB / master key.
 */
export interface SecureCredentialServiceOptions {
  db?: SqliteDatabase;
  masterKey?: MasterKeyProvider;
  keyring?: KeyringAdapter;
  /** Overrides the `!app.isPackaged` dev-fallback detection. */
  allowInsecureT0Fallback?: boolean;
}

class SecureCredentialService extends EventEmitter {
  private store: SecureStore | null = null;
  private masterKey: MasterKeyProvider | null = null;
  private initialized = false;
  private auditLog: CredentialAuditEntry[] = [];
  private readonly options: SecureCredentialServiceOptions;

  constructor(options: SecureCredentialServiceOptions = {}) {
    super();
    this.options = options;
  }

  /**
   * Lazily construct the secure-store over the shared main DB handle. The
   * connection is INJECTED (not owned): better-sqlite3 is ABI-specific per
   * process, so each process opens the DB with its own build. secure-store's
   * Schema ownership remains in the shared migration engine; callers must
   * initialize the database before constructing this adapter.
   */
  private getStore(): SecureStore {
    if (this.store) return this.store;
    if (!this.options.db) {
      const dbm = getDatabaseManager();
      if (!dbm.isReady()) {
        throw new Error(
          'SecureCredentialService: database not initialized. '
          + 'Schema migration (v134) must complete before credential access.',
        );
      }
    }
    const db = this.options.db ?? getDatabaseManager().getDb();
    this.masterKey = this.options.masterKey
      ?? (process.env.NODE_ENV === 'test'
        ? { getKey: () => null, lastError: () => 'test mode - keyring bypassed' }
        : null);
    this.store = new SecureStore({
      db,
      ...(this.options.keyring
        ? { keyring: this.options.keyring }
        : this.masterKey
          ? { masterKey: this.masterKey }
          : { keyring: createKeyringAdapter() }),
      allowInsecureT0Fallback: this.options.allowInsecureT0Fallback ?? isDevModeT0FallbackAllowed(),
      log: secureStoreLog,
      processKind: 'electron',
      buildId: app.getVersion(),
    });
    return this.store;
  }

  /**
   * Initialize the credential service.
   *
   * Order:
   *  1. build the secure-store over the migrated shared database
   *  2. one-way migrate any legacy safeStorage blobs into it (Electron-only)
   *  3. consolidate legacy pluginIds (TICKET_588/589/809_2) inside the new store
   *  4. re-encrypt any insecure (dev-fallback) rows now the keyring is available
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    const store = this.getStore();

    if (!store.isEncryptionAvailable()) {
      appLog.warn('[SecureCredential] OS keyring unavailable on this system, using base64 fallback for non-critical tiers');
      this.emit('keychain-unavailable', {
        platform: process.platform,
        desktop: process.env.XDG_CURRENT_DESKTOP || 'unknown',
        instructions: this.getKeychainInstallInstructions(),
      });
    } else {
      appLog.info('[SecureCredential] Encryption available (OS keyring)');
    }

    // TICKET_1276 P0: one-way migration of legacy safeStorage blobs. Only
    // Electron can decrypt them, so it must run here (never in the MCP process).
    this.migrateSafeStorageToSecureStore();

    // TICKET_588/589/809_2: consolidate legacy pluginIds inside the new store.
    this.consolidatePluginIds();

    this.initialized = true;
    appLog.info('[SecureCredential] Service initialized');

    // TICKET_580_2: re-encrypt any insecure b64 rows now the keyring is available.
    store.upgradeInsecureRows().catch(err => {
      appLog.warn('[SecureCredential] upgradeInsecureRows failed:', err);
    });
  }

  // ===========================================================================
  // TICKET_1276 P0: one-way safeStorage -> secure-store migration
  // ===========================================================================

  /**
   * Decrypt every credential from the legacy electron-store
   * (`secure-credentials.json`, safeStorage-encrypted) and rewrite it through
   * secure-store. One-way and idempotent:
   *  - rows that migrate are immediately removed from the legacy file;
   *  - rows that fail (keyring down for a T0 write, unreadable blob) are the
   *    ONLY rows retained in the legacy file, and the completion marker is NOT
   *    written, so the next startup retries exactly those rows;
   *  - a retry never overwrites a key already present in secure-store (the
   *    user may have re-entered a fresh value there since) -- the stale legacy
   *    row is dropped instead.
   *
   * Runs only in Electron (safeStorage is Electron-only). Marker keys from the
   * legacy per-store migrations are NOT copied.
   */
  private migrateSafeStorageToSecureStore(): void {
    const store = this.getStore();
    if (this.markerPresent(SAFE_STORAGE_MIGRATION_KEY)) {
      return;
    }

    let legacyStore: Store<LegacyCredentialStoreSchema>;
    try {
      legacyStore = new Store<LegacyCredentialStoreSchema>({
        name: 'secure-credentials',
        defaults: { credentials: {} },
      });
    } catch (error) {
      appLog.warn('[SecureCredential] TICKET_1276: could not open legacy store (treating as empty):', error);
      this.setMarker(SAFE_STORAGE_MIGRATION_KEY);
      return;
    }

    const legacyPath = legacyStore.path;
    const credentials = legacyStore.get('credentials', {});
    const encryptionAvailable = safeStorage.isEncryptionAvailable();

    let migrated = 0;
    let failed = 0;
    // Rows still needing migration after this run; written back as the entire
    // legacy credential map so migrated rows cannot linger as plaintext-
    // decryptable duplicates.
    const retained: Record<string, Record<string, string>> = {};
    const retain = (pluginId: string, key: string, value: string): void => {
      (retained[pluginId] ??= {})[key] = value;
    };

    for (const pluginId of Object.keys(credentials)) {
      // Skip the legacy per-store migration markers (all shaped `__migration_*`).
      if (pluginId.startsWith('__migration_')) continue;
      const pluginCreds = credentials[pluginId];
      if (!pluginCreds || typeof pluginCreds !== 'object') continue;

      for (const key of Object.keys(pluginCreds)) {
        const storedBase64 = pluginCreds[key];

        // Retry run: the target may already hold this key (migrated on an
        // earlier run, or re-entered by the user through the new store).
        // setSecretSync is an upsert, so writing here would clobber the newer
        // value with the legacy one -- drop the legacy row instead.
        if (store.hasCredentialSync(pluginId, key)) {
          appLog.info(`[SecureCredential] TICKET_1276: ${pluginId}:${key} already in secure-store; dropping legacy row`);
          continue;
        }

        let plain: string | null = null;
        try {
          const buf = Buffer.from(storedBase64, 'base64');
          if (encryptionAvailable) {
            // Legacy values written with safeStorage: decrypt. A value stored as
            // plain b64 (keychain unavailable at write time) fails decrypt and
            // falls back to the raw utf-8 decode below.
            try {
              plain = safeStorage.decryptString(buf);
            } catch {
              plain = buf.toString('utf-8');
            }
          } else {
            plain = buf.toString('utf-8');
          }
        } catch (error) {
          appLog.warn(`[SecureCredential] TICKET_1276: failed to read legacy ${pluginId}:${key}, retaining for retry: ${error instanceof Error ? error.message : String(error)}`);
          failed++;
          retain(pluginId, key, storedBase64);
          continue;
        }

        // Rewrite through secure-store under the SAME pluginId. Tier policy is
        // re-applied here; a T0 value that cannot be re-secured (keyring down,
        // not dev) is refused, retained in the legacy store, and retried on the
        // next startup (the completion marker is only written on a clean run).
        const res = store.setSecretSync(pluginId, key, plain);
        if (res.success) {
          migrated++;
        } else {
          appLog.warn(`[SecureCredential] TICKET_1276: could not migrate ${pluginId}:${key}, retaining for retry: ${res.errorMessage ?? 'unknown'}`);
          failed++;
          retain(pluginId, key, storedBase64);
        }
      }
    }

    // One-way move: the legacy map now holds only the rows that still need a
    // retry (empty on a clean run).
    try {
      legacyStore.set('credentials', retained);
      this.enforceLegacyFilePermissions(legacyPath);
    } catch (error) {
      appLog.warn('[SecureCredential] TICKET_1276: failed to rewrite legacy store:', error);
    }

    if (failed === 0) {
      this.setMarker(SAFE_STORAGE_MIGRATION_KEY);
      appLog.info(`[SecureCredential] TICKET_1276: safeStorage -> secure-store migration complete: ${migrated} migrated`);
    } else {
      appLog.warn(`[SecureCredential] TICKET_1276: safeStorage migration incomplete: ${migrated} migrated, ${failed} retained for retry on next startup`);
    }
  }

  private enforceLegacyFilePermissions(filePath: string): void {
    if (process.platform === 'win32') return;
    try {
      if (fs.existsSync(filePath)) fs.chmodSync(filePath, 0o600);
    } catch {
      // best-effort
    }
  }

  // ===========================================================================
  // TICKET_588/589/809_2: legacy pluginId consolidation (inside secure-store)
  // ===========================================================================

  /**
   * Consolidate credentials stored under legacy pluginIds:
   *  - TICKET_588: `com.quantnexus.*` -> `com.stratcraft.*`
   *  - TICKET_809_2: global keys (LLM/OAuth) under Builder/Auth -> `host`
   *
   * (TICKET_589 cross-userData-store merge is subsumed: the safeStorage
   * migration reads whatever the legacy electron-store already merged in.)
   *
   * Value ciphertext is preserved across a pluginId rename because the master
   * key is unchanged; we move rows by decrypt-under-old / set-under-new so the
   * stored scheme stays consistent. Never overwrites an existing target
   * (preserves re-entered values); idempotent via a marker row.
   *
   * The marker is only written once the safeStorage migration has itself
   * completed: a legacy row that arrives on a later retry startup (keyring was
   * down on the first run) must still get its pluginId consolidated, so
   * consolidation re-runs -- it is idempotent by construction (skip-if-target-
   * exists + delete-source) -- until both migrations are clean.
   */
  private consolidatePluginIds(): void {
    const store = this.getStore();
    if (this.markerPresent(PLUGIN_ID_CONSOLIDATION_KEY)) {
      return;
    }

    let moved = 0;

    // TICKET_588: com.quantnexus.* -> com.stratcraft.*
    for (const oldPluginId of store.listPluginIds()) {
      if (!oldPluginId.startsWith(OLD_PLUGIN_PREFIX)) continue;
      const newPluginId = NEW_PLUGIN_PREFIX + oldPluginId.slice(OLD_PLUGIN_PREFIX.length);
      moved += this.moveAllKeys(oldPluginId, newPluginId, () => true);
    }

    // TICKET_809_2: global keys under Builder/Auth -> host
    for (const source of MIGRATION_809_2_SOURCES) {
      moved += this.moveAllKeys(source, HOST_PLUGIN_ID, isGlobalCredentialKey);
    }

    if (this.markerPresent(SAFE_STORAGE_MIGRATION_KEY)) {
      this.setMarker(PLUGIN_ID_CONSOLIDATION_KEY);
      appLog.info(`[SecureCredential] pluginId consolidation complete: ${moved} credential(s) moved`);
    } else {
      appLog.info(`[SecureCredential] pluginId consolidation pass: ${moved} moved; will re-run until safeStorage migration completes`);
    }
  }

  /**
   * Move every key of `fromPluginId` matching `predicate` to `toPluginId`,
   * skipping keys that already exist at the target. Returns the count moved.
   */
  private moveAllKeys(fromPluginId: string, toPluginId: string, predicate: (key: string) => boolean): number {
    if (fromPluginId === toPluginId) return 0;
    const store = this.getStore();
    let moved = 0;
    for (const key of store.listCredentialKeysSync(fromPluginId)) {
      if (!predicate(key)) continue;
      if (store.hasCredentialSync(toPluginId, key)) {
        // Target already has it (re-entered value): drop the old, keep the new.
        store.deleteSecretSync(fromPluginId, key);
        appLog.info(`[SecureCredential] Dropped duplicate ${fromPluginId}:${key} (exists at ${toPluginId})`);
        continue;
      }
      const got = store.getSecretSync(fromPluginId, key);
      if (!got.success || got.value === undefined) {
        appLog.warn(`[SecureCredential] Could not read ${fromPluginId}:${key} during consolidation; leaving in place`);
        continue;
      }
      const set = store.setSecretSync(toPluginId, key, got.value);
      if (!set.success) {
        appLog.warn(`[SecureCredential] Could not write ${toPluginId}:${key} during consolidation; leaving source in place`);
        continue;
      }
      store.deleteSecretSync(fromPluginId, key);
      moved++;
      appLog.info(`[SecureCredential] Moved ${fromPluginId}:${key} -> ${toPluginId}:${key}`);
    }
    return moved;
  }

  private markerPresent(key: string): boolean {
    return this.getStore().hasCredentialSync(MIGRATION_PLUGIN_ID, key);
  }

  private setMarker(key: string): void {
    // Marker rows are metadata (T3): stored as-is; never gate on the keyring.
    this.getStore().setSecretSync(MIGRATION_PLUGIN_ID, key, '1');
  }

  // ===========================================================================
  // TICKET_580_4: Platform-specific keychain install instructions
  // ===========================================================================

  private getKeychainInstallInstructions(): string {
    switch (process.platform) {
      case 'linux': {
        const desktop = (process.env.XDG_CURRENT_DESKTOP || '').toLowerCase();
        if (desktop.includes('kde') || desktop.includes('plasma')) {
          return 'sudo pacman -S kwallet (Arch) or sudo apt install kwalletmanager (Debian/Ubuntu)';
        }
        return 'sudo apt install gnome-keyring (Debian/Ubuntu), sudo dnf install gnome-keyring (Fedora), sudo pacman -S gnome-keyring (Arch)';
      }
      case 'darwin':
        return 'macOS Keychain should be available by default. Check System Preferences > Security.';
      case 'win32':
        return 'Windows Credential Vault should be available by default. Ensure your user profile is not corrupted.';
      default:
        return mainT(getCurrentMainLocale(), 'errors', 'main.secureCredential.installKeyring');
    }
  }

  // ===========================================================================
  // TICKET_580_2: Audit Log
  // ===========================================================================

  /**
   * Record a T0 credential access in the audit ring buffer.
   * Only T0 (critical) operations are audited to avoid noise.
   */
  private recordAudit(
    operation: CredentialAuditEntry['operation'],
    pluginId: string,
    key: string,
    tier: CredentialTier
  ): void {
    if (tier !== CredentialTier.T0_CRITICAL) return;

    const entry: CredentialAuditEntry = {
      timestamp: Date.now(),
      operation,
      pluginId,
      key,
      tier,
    };

    this.auditLog.push(entry);

    if (this.auditLog.length > AUDIT_LOG_MAX_ENTRIES) {
      this.auditLog = this.auditLog.slice(-AUDIT_LOG_MAX_ENTRIES);
    }
  }

  /**
   * Retrieve audit log entries.
   * @param pluginId - Optional filter by plugin ID
   * @param maxEntries - Maximum entries to return (default 100)
   */
  getAuditLog(pluginId?: string, maxEntries = 100): CredentialAuditEntry[] {
    let entries = this.auditLog;
    if (pluginId) {
      entries = entries.filter(e => e.pluginId === pluginId);
    }
    return entries.slice(-maxEntries);
  }

  // ===========================================================================
  // Public API (matching gRPC CoreClient interface)
  // ===========================================================================

  async getSecret(pluginId: string, key: string): Promise<GetSecretResponse> {
    const tier = inferCredentialTier(pluginId, key);
    this.recordAudit('get', pluginId, key, tier);
    return this.getStore().getSecret(pluginId, key);
  }

  /**
   * TICKET_580_2: Tier-based storage policy enforcement (owned by secure-store).
   * - T0: refused without keyring encryption (dev fallback per TICKET_587)
   * - T1: warning logged on fallback
   * - T2/T3: unchanged behavior
   *
   * Preserves the legacy event surface (t0-rejected / t0-dev-fallback /
   * t1-warning) by mapping secure-store's response.
   */
  async setSecret(pluginId: string, key: string, value: string): Promise<SetSecretResponse> {
    const tier = inferCredentialTier(pluginId, key);
    const res = await this.getStore().setSecret(pluginId, key, value);

    if (!res.success && tier === CredentialTier.T0_CRITICAL) {
      this.emit('t0-rejected', { pluginId, key, errorMessage: res.errorMessage });
    } else if (res.warning === 't0-dev-fallback') {
      this.emit('t0-dev-fallback', { pluginId, key });
    } else if (res.warning === 't1-fallback') {
      this.emit('t1-warning', { pluginId, key });
    }

    if (res.success) {
      this.recordAudit('set', pluginId, key, tier);
    }

    return {
      success: res.success,
      errorCode: res.errorCode,
      errorMessage: res.errorMessage,
      health: res.health,
    };
  }

  async deleteSecret(pluginId: string, key: string): Promise<DeleteSecretResponse> {
    const tier = inferCredentialTier(pluginId, key);
    const existed = await this.getStore().hasCredential(pluginId, key);
    if (existed) {
      this.recordAudit('delete', pluginId, key, tier);
    }
    return this.getStore().deleteSecret(pluginId, key);
  }

  async hasCredential(pluginId: string, key: string): Promise<boolean> {
    return this.getStore().hasCredential(pluginId, key);
  }

  async readAgentPermissionAuthorityRecord(key: string): Promise<string | null> {
    const result = await this.getStore().getSecret(
      AGENT_PERMISSION_AUTHORITY_NAMESPACE,
      key,
    );
    if (!result.success) {
      throw new Error(
        result.errorMessage ?? 'Agent permission authority secure-store read failed',
      );
    }
    return result.value ?? null;
  }

  async compareAndSwapAgentPermissionAuthorityRecord(
    key: string,
    expectedValue: string | null,
    value: string,
  ): Promise<boolean> {
    const result = await this.getStore().compareAndSwapSecret(
      AGENT_PERMISSION_AUTHORITY_NAMESPACE,
      key,
      expectedValue,
      value,
    );
    if (result.success) return true;
    if (result.errorCode === SECURE_STORE_ERROR_CODES.ROTATION_CONFLICT) {
      return false;
    }
    throw new Error(
      result.errorMessage ?? 'Agent permission authority secure-store CAS failed',
    );
  }

  /**
   * TICKET_1313 Phase 4: whether the credential exists AND decodes under the
   * current OS keyring master key. Availability gating must use this; row
   * existence alone is a false positive after a keyring master-key rotation.
   */
  async isCredentialUsable(pluginId: string, key: string): Promise<boolean> {
    return this.getStore().isCredentialUsable(pluginId, key);
  }

  /** Shared TICKET_1314 health contract; no surface may reinterpret it. */
  async credentialHealth(pluginId: string, key: string): Promise<CredentialHealth> {
    return this.getStore().credentialHealth(pluginId, key);
  }

  /**
   * TICKET_1314_3: every credential the current master key cannot read.
   *
   * Surfaces call this to show the user what is broken before asking them to
   * authorize a reset.
   */
  async listUnreadableCredentials(): Promise<UnreadableCredential[]> {
    return this.getStore().listUnreadableCredentialsSync();
  }

  /**
   * TICKET_1314_3: archive and clear the unreadable cohort.
   *
   * DESTRUCTIVE to live credentials -- the caller MUST have obtained explicit
   * user confirmation first. Ciphertext is preserved in
   * `credential_recovery_archive` and is never deleted. This is the only route
   * out of a store whose OS keyring master key was lost; without it the
   * unreadable rows block their own replacement forever.
   */
  async resetUnreadableCredentials(): Promise<ResetUnreadableResult> {
    const result = this.getStore().resetUnreadableCredentialsSync();
    if (result.success) {
      secureStoreLog.warn(
        `[SecureCredentialService] unreadable cohort reset: archived ${result.archived ?? 0} credential(s)`,
      );
    }
    return result;
  }

  async replaceUnreadableCredential(
    pluginId: string,
    key: string,
    value: string,
    expectedHealth: Exclude<CredentialHealth, { state: 'usable' | 'missing' }>,
  ): Promise<SetSecretResponse> {
    return this.getStore().replaceUnreadableSecretSync(
      pluginId,
      key,
      value,
      expectedHealth,
    );
  }

  /** Authoritative TICKET_1314 lifecycle projection for renderer adapters. */
  async lifecycleStatus(): Promise<SecureStoreLifecycleStatus> {
    return this.getStore().lifecycleStatusSync();
  }

  async migrateLegacyCredentialStore(): Promise<LifecycleMutationResponse> {
    return this.getStore().migrateLegacyToGcm2Sync();
  }

  async rotateCredentialMasterKey(): Promise<LifecycleMutationResponse> {
    return this.getStore().rotateMasterKeySync();
  }

  async exportCredentialRecoveryBundle(passphrase: string): Promise<
    LifecycleMutationResponse & { bundleBase64?: string }
  > {
    const result = this.getStore().exportRecoveryBundleSync(passphrase);
    const { bundle, ...response } = result;
    return {
      ...response,
      bundleBase64: bundle?.toString('base64'),
    };
  }

  /** Export a key selection already verified by the backup owning adapter. */
  async exportBackupRecoveryBundle(
    selection: RecoveryKeySelection,
    passphrase: string,
  ): Promise<LifecycleMutationResponse & { bundleBase64?: string }> {
    const result = this.getStore().exportRecoverySelectionSync(selection, passphrase);
    const { bundle, ...response } = result;
    return { ...response, bundleBase64: bundle?.toString('base64') };
  }

  async importCredentialRecoveryBundle(
    bundleBase64: string,
    passphrase: string,
  ): Promise<LifecycleMutationResponse> {
    return this.getStore().importRecoveryBundleSync(Buffer.from(bundleBase64, 'base64'), passphrase);
  }

  async listCredentialKeys(pluginId: string): Promise<string[]> {
    return this.getStore().listCredentialKeys(pluginId);
  }

  /** Whether real (keyring-backed) encryption is available. */
  isEncryptionAvailable(): boolean {
    return this.getStore().isEncryptionAvailable();
  }

  /** V3 compatibility: the store is always connected once constructed. */
  isConnected(): boolean {
    return true;
  }

  /** V3 compatibility: the credential service is always available. */
  hasCredentialService(): boolean {
    return true;
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

let secureCredentialService: SecureCredentialService | null = null;

export function getSecureCredentialService(): SecureCredentialService {
  if (!secureCredentialService) {
    secureCredentialService = new SecureCredentialService();
    secureCredentialService.initialize();
  }
  return secureCredentialService;
}

export function initializeSecureCredentialService(): void {
  getSecureCredentialService();
}

export { SecureCredentialService };
