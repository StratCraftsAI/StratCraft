/**
 * AES-256-GCM envelope crypto tests (TICKET_1276 P0).
 */
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  decryptGcm2,
  encryptGcm2,
  encryptValue,
  encodeInsecure,
  decodeValue,
  parseGcm2,
  schemeOf,
} from '../crypto';

const KEY = randomBytes(32);

describe('crypto envelope', () => {
  it('encrypt -> decrypt round-trips arbitrary UTF-8', () => {
    const samples = ['sk-abc123', '', 'unicode: éü中文', 'a'.repeat(10_000)];
    for (const plain of samples) {
      const enc = encryptValue(KEY, plain);
      expect(schemeOf(enc)).toBe('gcm1');
      expect(decodeValue(KEY, enc)).toBe(plain);
    }
  });

  it('each encryption uses a fresh IV (ciphertext differs for same plaintext)', () => {
    const a = encryptValue(KEY, 'same');
    const b = encryptValue(KEY, 'same');
    expect(a).not.toBe(b);
    expect(decodeValue(KEY, a)).toBe('same');
    expect(decodeValue(KEY, b)).toBe('same');
  });

  it('b64 insecure encoding round-trips and needs no key', () => {
    const enc = encodeInsecure('plain-value');
    expect(schemeOf(enc)).toBe('b64');
    expect(decodeValue(null, enc)).toBe('plain-value');
  });

  it('decoding gcm1 without a master key throws (fail fast)', () => {
    const enc = encryptValue(KEY, 'x');
    expect(() => decodeValue(null, enc)).toThrow(/master key is unavailable/);
  });

  it('decoding with the WRONG key throws (auth-tag failure, tamper evident)', () => {
    const enc = encryptValue(KEY, 'x');
    expect(() => decodeValue(randomBytes(32), enc)).toThrow();
  });

  it('tampered ciphertext throws', () => {
    const enc = encryptValue(KEY, 'sensitive');
    // Flip a byte inside the base64 body.
    const body = enc.slice('gcm1:'.length);
    const buf = Buffer.from(body, 'base64');
    buf[buf.length - 1] ^= 0xff;
    const tampered = 'gcm1:' + buf.toString('base64');
    expect(() => decodeValue(KEY, tampered)).toThrow();
  });

  it('rejects non-canonical base64url envelopes', () => {
    expect(() => parseGcm2('gcm2:AA=')).toThrow(/encoding is invalid/);
    expect(() => parseGcm2('gcm2:AA+')).toThrow(/encoding is invalid/);
  });

  it('unknown scheme throws', () => {
    expect(() => decodeValue(KEY, 'plaintext-no-prefix')).toThrow(/unknown encoding scheme/);
  });

  it('truncated gcm1 payload throws', () => {
    const tiny = 'gcm1:' + Buffer.from([1, 2, 3]).toString('base64');
    expect(() => decodeValue(KEY, tiny)).toThrow(/truncated/);
  });

  it('schemeOf returns null for an unrecognized prefix', () => {
    expect(schemeOf('nope')).toBeNull();
  });

  it('gcm2 authenticates store, key identity, plugin, credential key, and tier', () => {
    const namespace = {
      storeId: 'store-a',
      envelopeVersion: 2 as const,
      keyId: 'key-a',
      pluginId: 'plugin-a',
      credentialKey: 'secret-a',
      tier: 0,
    };
    const encoded = encryptGcm2(KEY, 'secret', namespace);
    expect(schemeOf(encoded)).toBe('gcm2');
    expect(parseGcm2(encoded).keyId).toBe('key-a');
    expect(decryptGcm2(KEY, encoded, namespace)).toBe('secret');
    for (const mutation of [
      { storeId: 'store-b' },
      { pluginId: 'plugin-b' },
      { credentialKey: 'secret-b' },
      { tier: 1 },
    ]) {
      expect(() => decryptGcm2(KEY, encoded, { ...namespace, ...mutation })).toThrow();
    }
  });

  it('gcm2 rejects truncation and unknown binary versions', () => {
    expect(() => parseGcm2('gcm2:AQ')).toThrow(/truncated/);
    const encoded = encryptGcm2(KEY, 'secret', {
      storeId: 's',
      envelopeVersion: 2,
      keyId: 'k',
      pluginId: 'p',
      credentialKey: 'c',
      tier: 0,
    });
    const bytes = Buffer.from(encoded.slice(5), 'base64url');
    bytes[0] = 99;
    expect(() => parseGcm2(`gcm2:${bytes.toString('base64url')}`)).toThrow(/unsupported/);
  });
});
