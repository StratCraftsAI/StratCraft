import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fingerprintKey } from '../master-key';
import { exportRecoveryBundle, importRecoveryBundle } from '../recovery-bundle';

function material() {
  const bytes = randomBytes(32);
  return {
    keyId: 'key-1',
    generation: 1,
    fingerprint: fingerprintKey(bytes),
    bytes,
  };
}

describe('encrypted recovery bundle', () => {
  it('export_contains_no_plaintext_key', () => {
    const key = material();
    const bundle = exportRecoveryBundle('store-1', [key], 'correct horse battery staple');
    const text = bundle.toString('utf8');
    expect(text).not.toContain(key.bytes.toString('hex'));
    expect(text).not.toContain(key.bytes.toString('base64url'));
    expect(text).not.toContain('application credential');
    const imported = importRecoveryBundle(bundle, 'store-1', 'correct horse battery staple');
    expect(imported.keys[0].bytes.equals(key.bytes)).toBe(true);
    imported.keys[0].bytes.fill(0);
    key.bytes.fill(0);
  });

  it('wrong_passphrase_fails_authentication', () => {
    const key = material();
    const bundle = exportRecoveryBundle('store-1', [key], 'right');
    expect(() => importRecoveryBundle(bundle, 'store-1', 'wrong'))
      .toThrow(/authentication failed/);
    key.bytes.fill(0);
  });

  it('store_id_mismatch_never_imports', () => {
    const key = material();
    const bundle = exportRecoveryBundle('store-1', [key], 'passphrase');
    expect(() => importRecoveryBundle(bundle, 'store-2', 'passphrase'))
      .toThrow(/store ID does not match/);
    key.bytes.fill(0);
  });

  it('untrusted_kdf_parameters_are_bounded before derivation', () => {
    const key = material();
    const bundle = exportRecoveryBundle('store-1', [key], 'passphrase');
    const parsed = JSON.parse(bundle.toString('utf8')) as {
      header: { n: number; maxmem: number };
    };
    parsed.header.n = 2 ** 30;
    parsed.header.maxmem = Number.MAX_SAFE_INTEGER;
    expect(() => importRecoveryBundle(
      Buffer.from(JSON.stringify(parsed)),
      'store-1',
      'passphrase',
    )).toThrow(/KDF policy is unsupported/);
    key.bytes.fill(0);
  });

  it('import is pure and cannot overwrite a conflicting keyring account', () => {
    const key = material();
    const bundle = exportRecoveryBundle('store-1', [key], 'passphrase');
    const imported = importRecoveryBundle(bundle, 'store-1', 'passphrase');
    expect(imported.keys).toHaveLength(1);
    expect(imported.keys[0].keyId).toBe('key-1');
    imported.keys[0].bytes.fill(0);
    key.bytes.fill(0);
  });

  it('supports the maximum key cohort without applying metadata string limits to ciphertext', () => {
    const keys = Array.from({ length: 64 }, (_, index) => {
      const bytes = randomBytes(32);
      return {
        keyId: `key-${index}`,
        generation: index + 1,
        fingerprint: fingerprintKey(bytes),
        bytes,
      };
    });
    const bundle = exportRecoveryBundle('store-1', keys, 'passphrase');
    const imported = importRecoveryBundle(bundle, 'store-1', 'passphrase');
    expect(imported.keys).toHaveLength(keys.length);
    for (const key of keys) key.bytes.fill(0);
    for (const key of imported.keys) key.bytes.fill(0);
  });

  it('rejects non-canonical base64url before key derivation', () => {
    const key = material();
    const bundle = exportRecoveryBundle('store-1', [key], 'passphrase');
    const parsed = JSON.parse(bundle.toString('utf8')) as {
      header: { salt: string };
    };
    parsed.header.salt += '=';
    expect(() => importRecoveryBundle(
      Buffer.from(JSON.stringify(parsed)),
      'store-1',
      'passphrase',
    )).toThrow(/salt is invalid/);
    key.bytes.fill(0);
  });
});
