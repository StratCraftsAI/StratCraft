/**
 * SecureStore unit tests (TICKET_1276 P0).
 *
 * The package takes an INJECTED SqliteDatabase handle, so these tests supply a
 * minimal in-memory fake that implements exactly the structural slice the store
 * uses (prepare/exec/pragma over the single `credentials` table). This keeps
 * the pure-TS package free of the native better-sqlite3 dependency while still
 * exercising the real SQL shape the store emits.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { CredentialTier } from '@StratCraft/types';
import { SecureStore } from '../secure-store';
import type { MasterKeyProvider } from '../master-key';
import type { KeyringAdapter } from '../master-key';
import { encodeInsecure, encryptLegacyValue, schemeOf } from '../crypto';
import { createFakeDb } from './helpers/fake-db';

// =============================================================================
// In-memory SqliteDatabase fake
// =============================================================================

// =============================================================================
// Master key providers
// =============================================================================

function keyringUp(): MasterKeyProvider {
  const key = randomBytes(32);
  return { getKey: () => key, lastError: () => null };
}

function keyringDown(reason = 'no keyring daemon'): MasterKeyProvider {
  return { getKey: () => null, lastError: () => reason };
}

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

function makeStore(masterKey: MasterKeyProvider, allowInsecureT0Fallback = false) {
  const db = createFakeDb();
  const store = new SecureStore({ db, masterKey, allowInsecureT0Fallback, log: silentLog });
  return { db, store };
}

// oauth_tokens is a well-known T0 (critical) key in the shared SSOT.
// inferCredentialTier defaults UNKNOWN keys to T1_HIGH (not T2), so an unknown
// key exercises the T1 (non-refusing, upgrade-eligible) path.
const T0_PLUGIN = 'host';
const T0_KEY = 'oauth_tokens';
const T1_PLUGIN = 'com.example.plugin';
const T1_KEY = 'some_pref';

// =============================================================================
// Round-trip
// =============================================================================

describe('SecureStore round-trip (keyring available)', () => {
  it('set then get returns the plaintext, stored encrypted (gcm2)', async () => {
    const { db, store } = makeStore(keyringUp());
    const set = await store.setSecret('host', 'llm.openai.apiKey', 'sk-secret-123');
    expect(set.success).toBe(true);
    expect(set.warning).toBeUndefined();

    const stored = db._rows.get('host llm.openai.apiKey')!;
    expect(schemeOf(stored.value)).toBe('gcm2');
    expect(stored.value).not.toContain('sk-secret-123');

    const got = await store.getSecret('host', 'llm.openai.apiKey');
    expect(got.success).toBe(true);
    expect(got.value).toBe('sk-secret-123');
    expect(got.health?.state).toBe('usable');
  });

  it('getSecret on a missing row returns 404', async () => {
    const { store } = makeStore(keyringUp());
    const got = await store.getSecret('host', 'nope');
    expect(got.success).toBe(false);
    expect(got.errorCode).toBe(404);
  });

  it('overwrite (upsert) replaces the value', async () => {
    const { store } = makeStore(keyringUp());
    await store.setSecret('host', 'k', 'v1');
    await store.setSecret('host', 'k', 'v2');
    const got = await store.getSecret('host', 'k');
    expect(got.value).toBe('v2');
  });

  it('compare-and-swap commits only from the exact previously read value', async () => {
    const { store } = makeStore(keyringUp());
    expect((await store.compareAndSwapSecret('host', 'cas', null, 'v1')).success).toBe(true);
    expect((await store.compareAndSwapSecret('host', 'cas', 'v1', 'v2')).success).toBe(true);

    const stale = await store.compareAndSwapSecret('host', 'cas', 'v1', 'v3');
    expect(stale.success).toBe(false);
    expect(stale.errorCode).toBe('SECURE_STORE_ROTATION_CONFLICT');
    expect((await store.getSecret('host', 'cas')).value).toBe('v2');
  });

  it('compare-and-swap does not treat an existing row as missing', async () => {
    const { store } = makeStore(keyringUp());
    await store.setSecret('host', 'cas', 'v1');

    const staleCreate = await store.compareAndSwapSecret('host', 'cas', null, 'v2');
    expect(staleCreate.success).toBe(false);
    expect(staleCreate.errorCode).toBe('SECURE_STORE_ROTATION_CONFLICT');
    expect((await store.getSecret('host', 'cas')).value).toBe('v1');
  });

  it('compare-and-swap fences a stale writer from another store instance', async () => {
    const db = createFakeDb();
    const masterKey = keyringUp();
    const first = new SecureStore({
      db, masterKey, allowInsecureT0Fallback: false, log: silentLog,
    });
    const second = new SecureStore({
      db, masterKey, allowInsecureT0Fallback: false, log: silentLog,
    });
    await first.setSecret('host', 'cas', 'version-1');
    expect((await first.getSecret('host', 'cas')).value).toBe('version-1');
    expect((await second.getSecret('host', 'cas')).value).toBe('version-1');

    expect((await first.compareAndSwapSecret(
      'host', 'cas', 'version-1', 'version-2',
    )).success).toBe(true);
    const stale = await second.compareAndSwapSecret(
      'host', 'cas', 'version-1', 'stale-version-2',
    );

    expect(stale.success).toBe(false);
    expect(stale.errorCode).toBe('SECURE_STORE_ROTATION_CONFLICT');
    expect((await first.getSecret('host', 'cas')).value).toBe('version-2');
  });
});

// =============================================================================
// Tier policy without keyring
// =============================================================================

describe('SecureStore tier policy (keyring unavailable)', () => {
  it('T0 write is REFUSED (403) when fallback disallowed', async () => {
    const { db, store } = makeStore(keyringDown('libsecret missing'), /*allowInsecureT0Fallback*/ false);
    const res = await store.setSecret(T0_PLUGIN, T0_KEY, 'tok');
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('SECURE_STORE_KEYRING_UNAVAILABLE');
    expect(res.health?.state).toBe('keyring_unavailable');
    expect(db._rows.size).toBe(0);
  });

  it('T0 write DEGRADES to insecure b64 in dev fallback with a warning', async () => {
    const { db, store } = makeStore(keyringDown(), /*allowInsecureT0Fallback*/ true);
    const res = await store.setSecret(T0_PLUGIN, T0_KEY, 'tok');
    expect(res.success).toBe(true);
    expect(res.warning).toBe('t0-dev-fallback');
    const stored = db._rows.get(`${T0_PLUGIN} ${T0_KEY}`)!;
    expect(schemeOf(stored.value)).toBe('b64');
    // Readable back without a key (b64 is not encrypted).
    const got = await store.getSecret(T0_PLUGIN, T0_KEY);
    expect(got.value).toBe('tok');
  });

  it('non-T0 write stores insecure b64 without needing the fallback flag', async () => {
    const { db, store } = makeStore(keyringDown(), /*allowInsecureT0Fallback*/ false);
    const res = await store.setSecret(T1_PLUGIN, T1_KEY, 'pref-value');
    expect(res.success).toBe(true);
    const stored = db._rows.get(`${T1_PLUGIN} ${T1_KEY}`)!;
    expect(schemeOf(stored.value)).toBe('b64');
  });
});

// =============================================================================
// isEncryptionAvailable / hasCredential / listCredentialKeys / delete
// =============================================================================

describe('SecureStore query + mutate helpers', () => {
  it('projects lifecycle capabilities from the authoritative store state', async () => {
    const { db, store } = makeStore(keyringUp());
    expect(await store.lifecycleStatus()).toMatchObject({
      mode: 'empty',
      credentialCount: 0,
      capabilities: {
        migrateLegacy: false,
        rotateMasterKey: false,
        exportRecoveryBundle: false,
        importRecoveryBundle: false,
        resetUnreadableCredentials: false,
      },
    });

    expect(store.setSecretSync('host', 'oauth_tokens', 'secret').success).toBe(true);
    expect(store.lifecycleStatusSync()).toMatchObject({
      mode: 'gcm2',
      activeGeneration: 1,
      credentialCount: 1,
      capabilities: {
        rotateMasterKey: true,
        exportRecoveryBundle: true,
        importRecoveryBundle: true,
      },
    });

    db._rows.set('host legacy', {
      plugin_id: 'host', key: 'legacy', value: 'gcm1:invalid', tier: 1, updated_at: Date.now(),
    });
    expect(store.lifecycleStatusSync()).toMatchObject({
      mode: 'mixed',
      unreadableCredentialCount: 1,
      capabilities: { rotateMasterKey: false, resetUnreadableCredentials: false },
    });
  });

  it('projects a readable legacy cohort as migratable', () => {
    const key = randomBytes(32);
    const db = createFakeDb();
    db._rows.set('host legacy', {
      plugin_id: 'host',
      key: 'legacy',
      value: encryptLegacyValue(key, 'legacy'),
      tier: 1,
      updated_at: Date.now(),
    });
    const keyring: KeyringAdapter = {
      read: account => account === 'secure-store-master-v1'
        ? { kind: 'found', bytes: Buffer.from(key) }
        : { kind: 'missing' },
      createFresh: () => ({ kind: 'conflict' }),
      delete: () => ({ kind: 'missing' }),
    };
    const store = new SecureStore({ db, keyring, allowInsecureT0Fallback: false, log: silentLog });
    expect(store.lifecycleStatusSync()).toMatchObject({
      mode: 'legacy',
      unreadableCredentialCount: 0,
      capabilities: { migrateLegacy: true },
    });
    key.fill(0);
  });

  it('isEncryptionAvailable reflects the keyring', () => {
    const available = makeStore(keyringUp());
    expect(available.store.isEncryptionAvailable()).toBe(true);
    expect(available.store.setSecretSync('host', 'k', 'v').success).toBe(true);
    expect(available.store.isEncryptionAvailable()).toBe(true);
    expect(makeStore(keyringDown()).store.isEncryptionAvailable()).toBe(false);
  });

  it('hasCredential is true only after a write and false after delete', async () => {
    const { store } = makeStore(keyringUp());
    expect(await store.hasCredential('host', 'k')).toBe(false);
    await store.setSecret('host', 'k', 'v');
    expect(await store.hasCredential('host', 'k')).toBe(true);
    await store.deleteSecret('host', 'k');
    expect(await store.hasCredential('host', 'k')).toBe(false);
  });

  it('listCredentialKeys returns sorted keys for the plugin only', async () => {
    const { store } = makeStore(keyringUp());
    await store.setSecret('host', 'b', '1');
    await store.setSecret('host', 'a', '2');
    await store.setSecret('other', 'z', '3');
    expect(await store.listCredentialKeys('host')).toEqual(['a', 'b']);
    expect(await store.listCredentialKeys('other')).toEqual(['z']);
  });

  it('sync methods mirror the async surface and back the migration paths', () => {
    const { store } = makeStore(keyringUp());
    expect(store.setSecretSync('p', 'k', 'v').success).toBe(true);
    expect(store.hasCredentialSync('p', 'k')).toBe(true);
    expect(store.getSecretSync('p', 'k').value).toBe('v');
    expect(store.listCredentialKeysSync('p')).toEqual(['k']);
    store.deleteSecretSync('p', 'k');
    expect(store.hasCredentialSync('p', 'k')).toBe(false);
  });

  it('isCredentialUsable is false for a missing row and true for a decodable one', async () => {
    const { store } = makeStore(keyringUp());
    expect(await store.isCredentialUsable('host', 'k')).toBe(false);
    await store.setSecret('host', 'k', 'v');
    expect(await store.isCredentialUsable('host', 'k')).toBe(true);
    await store.deleteSecret('host', 'k');
    expect(await store.isCredentialUsable('host', 'k')).toBe(false);
  });

  it(
    'TICKET_1313 AC11: after a keyring master-key rotation the row still exists '
    + 'but is no longer usable',
    async () => {
      // Write under one keyring key...
      const { db, store } = makeStore(keyringUp());
      await store.setSecret('host', 'llm.deepseek', 'sk-real-key');
      expect(store.hasCredentialSync('host', 'llm.deepseek')).toBe(true);
      expect(store.isCredentialUsableSync('host', 'llm.deepseek')).toBe(true);

      // ...then read the SAME rows through a store whose keyring returns a
      // DIFFERENT master key (daemon restart / session migration).
      const rotated = new SecureStore({
        db,
        masterKey: keyringUp(),
        allowInsecureT0Fallback: false,
        log: silentLog,
      });

      // Row existence: still true -- this is the false positive.
      expect(rotated.hasCredentialSync('host', 'llm.deepseek')).toBe(true);
      // Usability: false, because the GCM auth tag no longer verifies.
      expect(rotated.isCredentialUsableSync('host', 'llm.deepseek')).toBe(false);
      // And the runtime read that used to surface as `no_byok_key` agrees.
      expect(rotated.getSecretSync('host', 'llm.deepseek').success).toBe(false);
    },
  );

  it(
    'TICKET_1314: ordinary write cannot replace an unreadable encrypted row',
    async () => {
      const { db, store } = makeStore(keyringUp());
      await store.setSecret('host', 'llm.deepseek', 'sk-old-key');

      const rotated = new SecureStore({
        db,
        masterKey: keyringUp(),
        allowInsecureT0Fallback: false,
        log: silentLog,
      });
      expect(rotated.isCredentialUsableSync('host', 'llm.deepseek')).toBe(false);

      const result = await rotated.setSecret('host', 'llm.deepseek', 'sk-new-key');
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('SECURE_STORE_RECOVERY_REQUIRED');
      expect(rotated.isCredentialUsableSync('host', 'llm.deepseek')).toBe(false);
    },
  );

  it('unreadable_delete_requires_archive_or_reset', async () => {
    const { db, store } = makeStore(keyringUp());
    await store.setSecret('host', 'llm.deepseek', 'sk-old-key');
    const original = db._rows.get('host llm.deepseek')!.value;
    const unavailable = new SecureStore({
      db,
      masterKey: keyringDown(),
      allowInsecureT0Fallback: false,
      log: silentLog,
    });
    const health = unavailable.credentialHealthSync('host', 'llm.deepseek');
    expect(health).toEqual({ state: 'keyring_unavailable', retryable: true });

    expect(unavailable.deleteSecretSync('host', 'llm.deepseek')).toMatchObject({
      success: false,
      errorCode: 'SECURE_STORE_RECOVERY_REQUIRED',
    });
    expect(db._rows.get('host llm.deepseek')!.value).toBe(original);

    expect(unavailable.archiveAndDeleteUnreadableSync(
      'host',
      'llm.deepseek',
      health as Exclude<typeof health, { state: 'usable' | 'missing' }>,
    )).toEqual({ success: true });
    expect(db._rows.has('host llm.deepseek')).toBe(false);
    expect([...db._archives.values()]).toContain(original);
  });

  it('isCredentialUsable is false when an encrypted row outlives the keyring', async () => {
    const { db, store } = makeStore(keyringUp());
    await store.setSecret('host', 'k', 'v');

    // Keyring goes away entirely: decodeValue throws on the gcm1 payload.
    const noKeyring = new SecureStore({
      db,
      masterKey: keyringDown(),
      allowInsecureT0Fallback: false,
      log: silentLog,
    });
    expect(noKeyring.hasCredentialSync('host', 'k')).toBe(true);
    expect(noKeyring.isCredentialUsableSync('host', 'k')).toBe(false);
  });

  it('isCredentialUsable is true for an insecure b64 row with no keyring', async () => {
    // T2 rows written during a keyring outage are b64-encoded and remain
    // readable without a master key -- they must NOT be reported unusable.
    const { db, store } = makeStore(keyringDown());
    await store.setSecret('host', 'k', 'v');
    expect(schemeOf(db._rows.get('host k')!.value)).toBe('b64');
    expect(store.isCredentialUsableSync('host', 'k')).toBe(true);
  });

  it('listPluginIds returns the distinct owning plugin ids, sorted', async () => {
    const { store } = makeStore(keyringUp());
    await store.setSecret('com.b', 'k', '1');
    await store.setSecret('com.a', 'k', '2');
    await store.setSecret('com.a', 'k2', '3');
    expect(store.listPluginIds()).toEqual(['com.a', 'com.b']);
  });
});

// =============================================================================
// upgradeInsecureRows (re-encrypt on keyring recovery)
// =============================================================================

describe('SecureStore.upgradeInsecureRows', () => {
  it('re-encrypts b64 rows of tier <= T1 once the keyring becomes available', async () => {
    // Seed a b64 T0 row directly (simulating a prior dev-fallback write) plus
    // a b64 T3 (metadata) row that must be LEFT ALONE -- only tier <= T1 upgrades.
    const db = createFakeDb();
    db._rows.set(`${T0_PLUGIN} ${T0_KEY}`, {
      plugin_id: T0_PLUGIN, key: T0_KEY, value: encodeInsecure('tok'),
      tier: CredentialTier.T0_CRITICAL, updated_at: 1,
    });
    db._rows.set(`${T1_PLUGIN} ${T1_KEY}`, {
      plugin_id: T1_PLUGIN, key: T1_KEY, value: encodeInsecure('pref'),
      tier: CredentialTier.T3_METADATA, updated_at: 1,
    });

    const master = keyringUp();
    const store = new SecureStore({ db, masterKey: master, allowInsecureT0Fallback: false, log: silentLog });

    const upgraded = await store.upgradeInsecureRows();
    expect(upgraded).toBe(1);

    // T0 row is now gcm2 and still decrypts to the same plaintext.
    const t0 = db._rows.get(`${T0_PLUGIN} ${T0_KEY}`)!;
    expect(schemeOf(t0.value)).toBe('gcm2');
    expect((await store.getSecret(T0_PLUGIN, T0_KEY)).value).toBe('tok');

    // T3 metadata row untouched (tier > T1).
    const t3 = db._rows.get(`${T1_PLUGIN} ${T1_KEY}`)!;
    expect(schemeOf(t3.value)).toBe('b64');
  });

  it('is a no-op when the keyring is unavailable', async () => {
    const db = createFakeDb();
    db._rows.set(`${T0_PLUGIN} ${T0_KEY}`, {
      plugin_id: T0_PLUGIN, key: T0_KEY, value: encodeInsecure('tok'),
      tier: CredentialTier.T0_CRITICAL, updated_at: 1,
    });
    const store = new SecureStore({ db, masterKey: keyringDown(), allowInsecureT0Fallback: true, log: silentLog });
    expect(await store.upgradeInsecureRows()).toBe(0);
    expect(schemeOf(db._rows.get(`${T0_PLUGIN} ${T0_KEY}`)!.value)).toBe('b64');
  });
});

// =============================================================================
// TICKET_1314 R2: T1 degradation narrowing
// =============================================================================

describe('TICKET_1314: T1 degradation only on keyring_unavailable', () => {
  function lockedKeyring(): KeyringAdapter {
    return {
      read: () => ({ kind: 'locked', cause: 'collection locked' }),
      createFresh: () => ({ kind: 'locked', cause: 'collection locked' }),
      delete: () => ({ kind: 'locked', cause: 'collection locked' }),
    };
  }

  function permissionDeniedKeyring(): KeyringAdapter {
    return {
      read: () => ({ kind: 'permission_denied', cause: 'access denied' }),
      createFresh: () => ({ kind: 'permission_denied', cause: 'access denied' }),
      delete: () => ({ kind: 'permission_denied', cause: 'access denied' }),
    };
  }

  it('T1 write FAILS CLOSED on keyring_locked (no base64 degradation)', async () => {
    const db = createFakeDb();
    const store = new SecureStore({
      db, keyring: lockedKeyring(), allowInsecureT0Fallback: false, log: silentLog,
    });
    const res = await store.setSecret(T1_PLUGIN, T1_KEY, 'secret');
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('SECURE_STORE_KEYRING_LOCKED');
    expect(db._rows.size).toBe(0);
  });

  it('T1 write FAILS CLOSED on keyring_permission_denied (no base64 degradation)', async () => {
    const db = createFakeDb();
    const store = new SecureStore({
      db, keyring: permissionDeniedKeyring(), allowInsecureT0Fallback: false, log: silentLog,
    });
    const res = await store.setSecret(T1_PLUGIN, T1_KEY, 'secret');
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('SECURE_STORE_KEYRING_PERMISSION_DENIED');
    expect(db._rows.size).toBe(0);
  });

  it('T1 write DEGRADES to b64 on keyring_unavailable (TICKET_580_2 policy)', async () => {
    const { db, store } = makeStore(keyringDown(), false);
    const res = await store.setSecret(T1_PLUGIN, T1_KEY, 'pref-value');
    expect(res.success).toBe(true);
    expect(res.warning).toBe('t1-fallback');
    const stored = db._rows.get(`${T1_PLUGIN} ${T1_KEY}`)!;
    expect(schemeOf(stored.value)).toBe('b64');
  });
});

// =============================================================================
// TICKET_1314_3: unreadable-cohort deadlock + insecure-fallback ordering
// =============================================================================

describe('TICKET_1314_3: recovery from a lost master key', () => {
  /** A keyring that holds no key at all -- the host collection was rebuilt. */
  function emptyKeyring(): KeyringAdapter {
    const held = new Map<string, Buffer>();
    return {
      read: (account: string) => {
        const bytes = held.get(account);
        return bytes ? { kind: 'found', bytes: Buffer.from(bytes) } : { kind: 'missing' };
      },
      createFresh: (account: string, bytes: Buffer) => {
        if (held.has(account)) return { kind: 'conflict' };
        held.set(account, Buffer.from(bytes));
        return { kind: 'created', bytes: Buffer.from(bytes) };
      },
      delete: (account: string) => (
        held.delete(account) ? { kind: 'deleted' } : { kind: 'missing' }
      ),
    };
  }

  /** Seed an orphaned gcm1 row: ciphertext whose key no longer exists. */
  function seedOrphan(db: ReturnType<typeof createFakeDb>, pluginId: string, key: string): void {
    db._rows.set(`${pluginId} ${key}`, {
      plugin_id: pluginId,
      key,
      value: `gcm1:${randomBytes(48).toString('base64')}`,
      tier: CredentialTier.T0_CRITICAL,
      updated_at: Date.now(),
    });
  }

  function orphanedStore(allowInsecureT0Fallback = false) {
    const db = createFakeDb();
    const store = new SecureStore({
      db, keyring: emptyKeyring(), allowInsecureT0Fallback, log: silentLog,
    });
    seedOrphan(db, 'host', 'llm.deepseek.apiKey');
    seedOrphan(db, 'host', 'llm.openai.apiKey');
    return { db, store };
  }

  it('reproduces the deadlock: an unreadable row blocks its own replacement', async () => {
    const { store } = orphanedStore();
    const res = await store.setSecret('host', 'llm.deepseek.apiKey', 'sk-new');
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('SECURE_STORE_RECOVERY_REQUIRED');
  });

  it('enumerates the unreadable cohort', () => {
    const { store } = orphanedStore();
    const unreadable = store.listUnreadableCredentialsSync();
    expect(unreadable).toHaveLength(2);
    expect(unreadable.map(entry => entry.key).sort())
      .toEqual(['llm.deepseek.apiKey', 'llm.openai.apiKey']);
    expect(unreadable.map(entry => entry.health.state)).not.toContain('usable');
  });

  it('excludes readable rows from the cohort', async () => {
    const { db, store } = orphanedStore();
    db._rows.set('host readable', {
      plugin_id: 'host',
      key: 'readable',
      value: encodeInsecure('plain'),
      tier: CredentialTier.T2_LOW,
      updated_at: Date.now(),
    });
    expect(store.listUnreadableCredentialsSync().some(entry => entry.key === 'readable'))
      .toBe(false);
  });

  it('reset archives the ciphertext and clears the live rows', () => {
    const { db, store } = orphanedStore();
    const before = [...db._rows.values()].map(row => row.value);
    const result = store.resetUnreadableCredentialsSync();
    expect(result.success).toBe(true);
    expect(result.archived).toBe(2);
    expect(db._rows.size).toBe(0);
    // ciphertext preserved verbatim -- never deleted (TICKET_1314 retention)
    expect([...db._archives.values()].sort()).toEqual([...before].sort());
  });

  it('reset is a no-op when nothing is unreadable', () => {
    const db = createFakeDb();
    const store = new SecureStore({
      db, keyring: emptyKeyring(), allowInsecureT0Fallback: false, log: silentLog,
    });
    const result = store.resetUnreadableCredentialsSync();
    expect(result.success).toBe(true);
    expect(result.archived).toBe(0);
  });

  it('never resets a GCM2 cohort when custody is temporarily unavailable', async () => {
    const db = createFakeDb();
    const held = new Map<string, Buffer>();
    let unavailable = false;
    const keyring: KeyringAdapter = {
      read: account => {
        if (unavailable) return { kind: 'unavailable', cause: 'temporary outage' };
        const bytes = held.get(account);
        return bytes ? { kind: 'found', bytes: Buffer.from(bytes) } : { kind: 'missing' };
      },
      createFresh: (account, bytes) => {
        if (held.has(account)) return { kind: 'conflict' };
        held.set(account, Buffer.from(bytes));
        return { kind: 'created', bytes: Buffer.from(bytes) };
      },
      delete: account => (held.delete(account) ? { kind: 'deleted' } : { kind: 'missing' }),
    };
    const writable = new SecureStore({
      db, keyring, allowInsecureT0Fallback: false, log: silentLog,
    });
    expect((await writable.setSecret('host', 'llm.openai.apiKey', 'sk-old')).success).toBe(true);
    const before = db._rows.get('host llm.openai.apiKey')?.value;

    unavailable = true;
    const unavailableStore = new SecureStore({
      db, keyring, allowInsecureT0Fallback: false, log: silentLog,
    });
    expect(unavailableStore.lifecycleStatusSync().capabilities.resetUnreadableCredentials).toBe(false);
    const result = unavailableStore.resetUnreadableCredentialsSync();

    expect(result).toMatchObject({
      success: false,
      errorCode: 'SECURE_STORE_RECOVERY_REQUIRED',
    });
    expect(db._rows.get('host llm.openai.apiKey')?.value).toBe(before);
    expect(db._archives.size).toBe(0);
  });

  it('AFTER reset the store initializes and the credential is writable (deadlock broken)', async () => {
    const { db, store } = orphanedStore();
    expect((await store.setSecret('host', 'llm.deepseek.apiKey', 'sk-new')).success).toBe(false);

    store.resetUnreadableCredentialsSync();

    const after = await store.setSecret('host', 'llm.deepseek.apiKey', 'sk-new');
    expect(after.success).toBe(true);
    expect(after.warning).toBeUndefined();
    expect(schemeOf(db._rows.get('host llm.deepseek.apiKey')!.value)).toBe('gcm2');
    const got = await store.getSecret('host', 'llm.deepseek.apiKey');
    expect(got.value).toBe('sk-new');
  });

  it('archive retention does not block initialization (no one-way door)', async () => {
    const { db, store } = orphanedStore();
    store.resetUnreadableCredentialsSync();
    expect(db._archives.size).toBe(2); // archive is non-empty...
    // ...and initialization must still succeed over it.
    expect((await store.setSecret('host', 'llm.openai.apiKey', 'sk-2')).success).toBe(true);
  });

  it('a cleartext b64 row upgrades to gcm2 on the next write', async () => {
    const db = createFakeDb();
    const store = new SecureStore({
      db, keyring: emptyKeyring(), allowInsecureT0Fallback: false, log: silentLog,
    });
    db._rows.set('host browser_oauth_session:abc', {
      plugin_id: 'host',
      key: 'browser_oauth_session:abc',
      value: encodeInsecure('session'),
      tier: CredentialTier.T0_CRITICAL,
      updated_at: Date.now(),
    });
    const res = await store.setSecret('host', 'browser_oauth_session:abc', 'session-2');
    expect(res.success).toBe(true);
    expect(schemeOf(db._rows.get('host browser_oauth_session:abc')!.value)).toBe('gcm2');
  });

  it('a dev install must NOT downgrade a T0 write to cleartext on a non-availability failure', async () => {
    // The 2026-07-28 defect: allowInsecureT0Fallback bypassed the T0 guard
    // BEFORE the availability check, so RECOVERY_REQUIRED reached encodeInsecure().
    const { db, store } = orphanedStore(true);
    const res = await store.setSecret('host', 'llm.deepseek.apiKey', 'sk-new');
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('SECURE_STORE_RECOVERY_REQUIRED');
    expect([...db._rows.values()].some(row => schemeOf(row.value) === 'b64')).toBe(false);
  });
});
