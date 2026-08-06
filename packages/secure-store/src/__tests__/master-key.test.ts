import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createKeyringAdapter,
  fingerprintKey,
  LEGACY_KEYRING_ACCOUNT,
  type KeyringAdapter,
  type KeyringEntryLike,
} from '../master-key';
import { encryptLegacyValue } from '../crypto';
import { SecureStore } from '../secure-store';
import { createFakeDb } from './helpers/fake-db';

const state: {
  stored: string | null;
  failGet: boolean;
  failSet: boolean;
  failureKind?: 'locked' | 'unavailable' | 'permission_denied';
  onSet?: (value: string) => void;
} = { stored: null, failGet: false, failSet: false };

const setPassword = vi.fn<[string], void>();

function fakeEntry(): KeyringEntryLike {
  return {
    getPassword() {
      if (state.failGet) {
        const error = new Error('user-specific backend text') as Error & { code: string };
        error.code = 'DBUS_DISCONNECTED';
        Object.assign(error, { secureStoreKind: state.failureKind });
        throw error;
      }
      return state.stored;
    },
    setPassword(value: string) {
      setPassword(value);
      if (state.failSet) throw new Error('write denied');
      state.stored = value;
      state.onSet?.(value);
    },
  };
}

describe('structured keyring adapter', () => {
  beforeEach(() => {
    state.stored = null;
    state.failGet = false;
    state.failSet = false;
    state.failureKind = undefined;
    state.onSet = undefined;
    setPassword.mockClear();
  });

  it('read_error_never_writes', () => {
    state.failGet = true;
    const adapter = createKeyringAdapter(() => fakeEntry());
    expect(adapter.read('account')).toEqual({
      kind: 'unavailable',
      cause: 'keyring operation failed',
      backendCode: 'DBUS_DISCONNECTED',
    });
    expect(adapter.createFresh('account', Buffer.alloc(32, 1)).kind).toBe('unavailable');
    expect(setPassword).not.toHaveBeenCalled();
  });

  it('malformed_key_never_replaces', () => {
    state.stored = 'not-a-key';
    const adapter = createKeyringAdapter(() => fakeEntry());
    expect(adapter.read('account').kind).toBe('malformed');
    expect(adapter.createFresh('account', Buffer.alloc(32, 1)).kind).toBe('malformed');
    expect(setPassword).not.toHaveBeenCalled();
  });

  it('creates only an explicitly missing random account and verifies read-back', () => {
    const candidate = Buffer.alloc(32, 7);
    const adapter = createKeyringAdapter(() => fakeEntry());
    const result = adapter.createFresh('unique-account', candidate);
    expect(result.kind).toBe('created');
    expect(setPassword).toHaveBeenCalledOnce();
    expect(state.stored).toBe(candidate.toString('hex'));
    if (result.kind === 'created') {
      expect(fingerprintKey(result.bytes)).toBe(fingerprintKey(candidate));
      result.bytes.fill(0);
    }
  });

  it('never overwrites an existing account', () => {
    state.stored = 'ab'.repeat(32);
    const adapter = createKeyringAdapter(() => fakeEntry());
    expect(adapter.createFresh('account', Buffer.alloc(32, 2))).toEqual({ kind: 'conflict' });
    expect(setPassword).not.toHaveBeenCalled();
  });

  it('detects a conflicting read-back identity', () => {
    state.onSet = () => { state.stored = 'cd'.repeat(32); };
    const adapter = createKeyringAdapter(() => fakeEntry());
    expect(adapter.createFresh('account', Buffer.alloc(32, 3))).toEqual({ kind: 'conflict' });
  });

  it.each([
    ['locked', 'locked'],
    ['permission_denied', 'permission_denied'],
  ] as const)('preserves structured %s failures without writing', (_label, failureKind) => {
    state.failGet = true;
    state.failureKind = failureKind;
    const adapter = createKeyringAdapter(() => fakeEntry());
    expect(adapter.read('account')).toMatchObject({ kind: failureKind });
    expect(adapter.createFresh('account', Buffer.alloc(32, 1))).toMatchObject({
      kind: failureKind,
    });
    expect(setPassword).not.toHaveBeenCalled();
  });
});

describe('database-aware master-key initialization', () => {
  const log = { info() {}, warn() {}, error() {}, debug() {} };

  function memoryKeyring(): KeyringAdapter & { accounts: Map<string, Buffer> } {
    const accounts = new Map<string, Buffer>();
    return {
      accounts,
      read(account) {
        const bytes = accounts.get(account);
        return bytes ? { kind: 'found', bytes: Buffer.from(bytes) } : { kind: 'missing' };
      },
      createFresh: vi.fn((account: string, bytes: Buffer) => {
        if (accounts.has(account)) return { kind: 'conflict' as const };
        accounts.set(account, Buffer.from(bytes));
        return { kind: 'created' as const, bytes: Buffer.from(bytes) };
      }),
      delete(account) {
        return accounts.delete(account) ? { kind: 'deleted' } : { kind: 'missing' };
      },
    };
  }

  it('missing_key_with_ciphertext_never_creates', () => {
    const db = createFakeDb();
    const keyring = memoryKeyring();
    const legacyKey = Buffer.alloc(32, 8);
    db._rows.set('host oauth_tokens', {
      plugin_id: 'host',
      key: 'oauth_tokens',
      value: encryptLegacyValue(legacyKey, 'preserved'),
      tier: 0,
      updated_at: Date.now(),
    });
    legacyKey.fill(0);
    const store = new SecureStore({ db, keyring, allowInsecureT0Fallback: false, log });

    expect(store.setSecretSync('host', 'new-key', 'new-value')).toMatchObject({
      success: false,
      errorCode: 'SECURE_STORE_MASTER_KEY_MISSING',
    });
    expect(keyring.createFresh).not.toHaveBeenCalled();
    expect(db._rows.get('host oauth_tokens')?.value).toMatch(/^gcm1:/);
  });

  it('empty_store_first_creation_is_atomic', () => {
    const db = createFakeDb();
    const original = db.transactionImmediate!;
    const transactionImmediate = vi.fn(
      <T>(fn: () => T) => original.call(db, fn),
    ) as typeof original;
    db.transactionImmediate = transactionImmediate;
    const keyring = memoryKeyring();
    const store = new SecureStore({ db, keyring, allowInsecureT0Fallback: false, log });

    expect(store.setSecretSync('host', 'oauth_tokens', 'first').success).toBe(true);
    expect(transactionImmediate).toHaveBeenCalled();
    expect(keyring.createFresh).toHaveBeenCalledOnce();
    expect(keyring.accounts.has(LEGACY_KEYRING_ACCOUNT)).toBe(false);
  });

  it('fresh_store_remains_usable_after_p0', () => {
    const db = createFakeDb();
    const keyring = memoryKeyring();
    const store = new SecureStore({ db, keyring, allowInsecureT0Fallback: false, log });

    expect(store.setSecretSync('host', 'oauth_tokens', 'round-trip').success).toBe(true);
    expect(store.getSecretSync('host', 'oauth_tokens')).toMatchObject({
      success: true,
      value: 'round-trip',
      health: { state: 'usable', scheme: 'gcm2' },
    });
    expect(store.lifecycleStatusSync()).toMatchObject({
      mode: 'gcm2',
      credentialCount: 1,
      unreadableCredentialCount: 0,
      capabilities: { rotateMasterKey: true, exportRecoveryBundle: true },
    });
  });
});
