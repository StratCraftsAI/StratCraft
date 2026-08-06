import { describe, expect, it, vi } from 'vitest';
import { fingerprintKey, type KeyringAdapter } from '../master-key';
import { SecureStore } from '../secure-store';
import { createFakeDb } from './helpers/fake-db';

const log = { info() {}, warn() {}, error() {}, debug() {} };

function memoryKeyring(): KeyringAdapter & {
  accounts: Map<string, Buffer>;
} {
  const accounts = new Map<string, Buffer>();
  const createFresh = vi.fn((account: string, bytes: Buffer) => {
    if (accounts.has(account)) return { kind: 'conflict' as const };
    accounts.set(account, Buffer.from(bytes));
    return { kind: 'created' as const, bytes: Buffer.from(bytes) };
  });
  return {
    accounts,
    createFresh,
    read(account) {
      const bytes = accounts.get(account);
      return bytes ? { kind: 'found', bytes: Buffer.from(bytes) } : { kind: 'missing' };
    },
    delete(account) {
      return accounts.delete(account) ? { kind: 'deleted' } : { kind: 'missing' };
    },
  } as KeyringAdapter & { accounts: Map<string, Buffer> };
}

describe('SecureStoreKeyManager', () => {
  it('concurrent_first_creation_converges', () => {
    const db = createFakeDb();
    const keyring = memoryKeyring();
    const electron = new SecureStore({
      db, keyring, allowInsecureT0Fallback: false, log, processKind: 'electron',
    });
    const mcp = new SecureStore({
      db, keyring, allowInsecureT0Fallback: false, log, processKind: 'mcp',
    });
    expect(electron.setSecretSync('host', 'a', 'one').success).toBe(true);
    expect(mcp.setSecretSync('host', 'b', 'two').success).toBe(true);
    expect(keyring.createFresh).toHaveBeenCalledTimes(1);
    const a = db._rows.get('host a')!.value;
    const b = db._rows.get('host b')!.value;
    expect(a.split(':')[0]).toBe('gcm2');
    expect(b.split(':')[0]).toBe('gcm2');
    expect(electron.getSecretSync('host', 'b').value).toBe('two');
    expect(mcp.getSecretSync('host', 'a').value).toBe('one');
  });

  it('envelope_key_id_selects_the_correct_key and identity drift is typed', () => {
    const db = createFakeDb();
    const keyring = memoryKeyring();
    const store = new SecureStore({ db, keyring, allowInsecureT0Fallback: false, log });
    expect(store.setSecretSync('host', 'a', 'one').success).toBe(true);
    const [account, bytes] = [...keyring.accounts.entries()][0];
    expect(fingerprintKey(bytes)).toHaveLength(64);
    keyring.accounts.set(account, Buffer.alloc(32, 9));
    expect(store.credentialHealthSync('host', 'a')).toMatchObject({
      state: 'key_identity_mismatch',
    });
    expect(store.setSecretSync('host', 'a', 'replacement')).toMatchObject({
      success: false,
      errorCode: 'SECURE_STORE_RECOVERY_REQUIRED',
    });
  });
});
