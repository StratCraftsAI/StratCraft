/**
 * Canonical SecureStore credential envelopes.
 *
 * gcm1 is retained as a read-only legacy format. gcm2 embeds the key identity
 * and authenticates the complete credential namespace as AES-GCM AAD.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const GCM1_PREFIX = 'gcm1:';
const GCM2_PREFIX = 'gcm2:';
const B64_PREFIX = 'b64:';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALGORITHM = 'aes-256-gcm';
const GCM2_BINARY_VERSION = 2;
const MAX_KEY_ID_BYTES = 128;

export type StoredScheme = 'gcm2' | 'gcm1' | 'b64';

export interface CredentialNamespace {
  storeId: string;
  envelopeVersion: 2;
  keyId: string;
  pluginId: string;
  credentialKey: string;
  tier: number;
}

export interface ParsedGcm2Envelope {
  keyId: string;
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

function lengthPrefixed(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

export function canonicalCredentialAad(namespace: CredentialNamespace): Buffer {
  const version = Buffer.allocUnsafe(4);
  version.writeUInt32BE(namespace.envelopeVersion);
  const tier = Buffer.allocUnsafe(4);
  tier.writeInt32BE(namespace.tier);
  return Buffer.concat([
    lengthPrefixed(namespace.storeId),
    version,
    lengthPrefixed(namespace.keyId),
    lengthPrefixed(namespace.pluginId),
    lengthPrefixed(namespace.credentialKey),
    tier,
  ]);
}

/** Legacy gcm1 writer, used only while a verified legacy cohort is active. */
export function encryptLegacyValue(masterKey: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return GCM1_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decryptLegacyValue(masterKey: Buffer, stored: string): string {
  if (!stored.startsWith(GCM1_PREFIX)) throw new Error('not a gcm1 envelope');
  const raw = Buffer.from(stored.slice(GCM1_PREFIX.length), 'base64');
  if (raw.length < IV_BYTES + TAG_BYTES) throw new Error('gcm1 envelope is truncated');
  const decipher = createDecipheriv(ALGORITHM, masterKey, raw.subarray(0, IV_BYTES), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([
    decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString('utf8');
}

export function encryptGcm2(
  masterKey: Buffer,
  plaintext: string,
  namespace: CredentialNamespace,
): string {
  const keyId = Buffer.from(namespace.keyId, 'utf8');
  if (keyId.length === 0 || keyId.length > MAX_KEY_ID_BYTES) {
    throw new Error('gcm2 key ID length is invalid');
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  cipher.setAAD(canonicalCredentialAad(namespace));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const keyLength = Buffer.allocUnsafe(2);
  keyLength.writeUInt16BE(keyId.length);
  const body = Buffer.concat([
    Buffer.from([GCM2_BINARY_VERSION]),
    keyLength,
    keyId,
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]);
  return GCM2_PREFIX + body.toString('base64url');
}

export function parseGcm2(stored: string): ParsedGcm2Envelope {
  if (!stored.startsWith(GCM2_PREFIX)) throw new Error('not a gcm2 envelope');
  const encoded = stored.slice(GCM2_PREFIX.length);
  if (encoded.length === 0 || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new Error('gcm2 envelope encoding is invalid');
  }
  let raw: Buffer;
  try {
    raw = Buffer.from(encoded, 'base64url');
  } catch {
    throw new Error('gcm2 envelope encoding is invalid');
  }
  if (raw.toString('base64url') !== encoded) throw new Error('gcm2 envelope encoding is invalid');
  if (raw.length < 1 + 2 + 1 + IV_BYTES + TAG_BYTES) {
    throw new Error('gcm2 envelope is truncated');
  }
  if (raw[0] !== GCM2_BINARY_VERSION) throw new Error('gcm2 envelope version is unsupported');
  const keyLength = raw.readUInt16BE(1);
  if (keyLength === 0 || keyLength > MAX_KEY_ID_BYTES) throw new Error('gcm2 key ID length is invalid');
  const fixedEnd = 3 + keyLength + IV_BYTES + TAG_BYTES;
  if (raw.length < fixedEnd) throw new Error('gcm2 envelope is truncated');
  const keyIdBytes = raw.subarray(3, 3 + keyLength);
  const keyId = keyIdBytes.toString('utf8');
  if (!Buffer.from(keyId, 'utf8').equals(keyIdBytes)) throw new Error('gcm2 key ID is invalid UTF-8');
  return {
    keyId,
    iv: raw.subarray(3 + keyLength, 3 + keyLength + IV_BYTES),
    tag: raw.subarray(3 + keyLength + IV_BYTES, fixedEnd),
    ciphertext: raw.subarray(fixedEnd),
  };
}

export function decryptGcm2(
  masterKey: Buffer,
  stored: string,
  namespace: Omit<CredentialNamespace, 'keyId'>,
): string {
  const envelope = parseGcm2(stored);
  const decipher = createDecipheriv(ALGORITHM, masterKey, envelope.iv, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(canonicalCredentialAad({ ...namespace, keyId: envelope.keyId }));
  decipher.setAuthTag(envelope.tag);
  return Buffer.concat([
    decipher.update(envelope.ciphertext),
    decipher.final(),
  ]).toString('utf8');
}

export function encodeInsecure(plaintext: string): string {
  return B64_PREFIX + Buffer.from(plaintext, 'utf8').toString('base64');
}

export function decodeInsecure(stored: string): string {
  if (!stored.startsWith(B64_PREFIX)) throw new Error('not a b64 envelope');
  return Buffer.from(stored.slice(B64_PREFIX.length), 'base64').toString('utf8');
}

export function schemeOf(stored: string): StoredScheme | null {
  if (stored.startsWith(GCM2_PREFIX)) return 'gcm2';
  if (stored.startsWith(GCM1_PREFIX)) return 'gcm1';
  if (stored.startsWith(B64_PREFIX)) return 'b64';
  return null;
}

// Compatibility names for legacy callers/tests. New writes must choose the
// lifecycle-specific writer explicitly.
export const encryptValue = encryptLegacyValue;
export function decodeValue(masterKey: Buffer | null, stored: string): string {
  const scheme = schemeOf(stored);
  if (scheme === 'b64') return decodeInsecure(stored);
  if (scheme === 'gcm1') {
    if (!masterKey) throw new Error('Encrypted credential present but OS keyring master key is unavailable');
    return decryptLegacyValue(masterKey, stored);
  }
  throw new Error('Stored credential has unknown encoding scheme or requires namespace context');
}
