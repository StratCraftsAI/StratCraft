import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import { SECURE_STORE_ERROR_CODES } from '@StratCraft/types';
import {
  RECOVERY_BUNDLE_VERSION,
  RECOVERY_DERIVED_KEY_BYTES,
  RECOVERY_IV_BYTES,
  RECOVERY_KDF_VERSION,
  RECOVERY_MAX_BUNDLE_BYTES,
  RECOVERY_MAX_KEY_COUNT,
  RECOVERY_MAX_STRING_BYTES,
  RECOVERY_SALT_BYTES,
  RECOVERY_SCRYPT_MAXMEM,
  RECOVERY_SCRYPT_N,
  RECOVERY_SCRYPT_P,
  RECOVERY_SCRYPT_R,
  RECOVERY_TAG_BYTES,
} from './constants';
import { fingerprintKey } from './master-key';
import { SecureStoreLifecycleError } from './errors';

export interface RecoveryKeyMaterial {
  keyId: string;
  generation: number;
  fingerprint: string;
  bytes: Buffer;
}

interface RecoveryHeader {
  bundleVersion: number;
  kdfVersion: number;
  storeId: string;
  createdAt: number;
  keyIds: string[];
  generations: number[];
  fingerprints: string[];
  n: number;
  r: number;
  p: number;
  maxmem: number;
  outputLength: number;
  salt: string;
  iv: string;
}

interface SerializedRecoveryBundle {
  header: RecoveryHeader;
  ciphertext: string;
  tag: string;
}

export interface ImportedRecoveryBundle {
  storeId: string;
  createdAt: number;
  keys: RecoveryKeyMaterial[];
}

function invalid(message: string): never {
  throw new SecureStoreLifecycleError(
    SECURE_STORE_ERROR_CODES.RECOVERY_BUNDLE_INVALID,
    message,
    { state: 'credential_corrupt' },
  );
}

function boundedString(value: unknown, name: string): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > RECOVERY_MAX_STRING_BYTES) {
    invalid(`Recovery bundle ${name} is invalid`);
  }
  return value;
}

function boundedEncodedBinary(value: unknown, name: string, maxBytes: number): string {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > Math.ceil(maxBytes * 4 / 3)
    || !/^[A-Za-z0-9_-]+$/.test(value)) {
    invalid(`Recovery bundle ${name} is invalid`);
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length > maxBytes || decoded.toString('base64url') !== value) {
    decoded.fill(0);
    invalid(`Recovery bundle ${name} encoding is invalid`);
  }
  decoded.fill(0);
  return value;
}

function decodeCanonicalBase64Url(value: string, name: string, expectedBytes?: number): Buffer {
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value
    || (expectedBytes !== undefined && decoded.length !== expectedBytes)) {
    decoded.fill(0);
    invalid(`Recovery bundle ${name} is invalid`);
  }
  return decoded;
}

function canonicalHeader(header: RecoveryHeader): Buffer {
  return Buffer.from(JSON.stringify({
    bundleVersion: header.bundleVersion,
    kdfVersion: header.kdfVersion,
    storeId: header.storeId,
    createdAt: header.createdAt,
    keyIds: header.keyIds,
    generations: header.generations,
    fingerprints: header.fingerprints,
    n: header.n,
    r: header.r,
    p: header.p,
    maxmem: header.maxmem,
    outputLength: header.outputLength,
    salt: header.salt,
    iv: header.iv,
  }), 'utf8');
}

function derive(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(
    passphrase.normalize('NFC'),
    salt,
    RECOVERY_DERIVED_KEY_BYTES,
    {
      N: RECOVERY_SCRYPT_N,
      r: RECOVERY_SCRYPT_R,
      p: RECOVERY_SCRYPT_P,
      maxmem: RECOVERY_SCRYPT_MAXMEM,
    },
  );
}

export function exportRecoveryBundle(
  storeId: string,
  keys: readonly RecoveryKeyMaterial[],
  passphrase: string,
  createdAt = Date.now(),
): Buffer {
  if (keys.length === 0 || keys.length > RECOVERY_MAX_KEY_COUNT) {
    invalid('Recovery bundle key count is invalid');
  }
  boundedString(storeId, 'store ID');
  const salt = randomBytes(RECOVERY_SALT_BYTES);
  const iv = randomBytes(RECOVERY_IV_BYTES);
  const header: RecoveryHeader = {
    bundleVersion: RECOVERY_BUNDLE_VERSION,
    kdfVersion: RECOVERY_KDF_VERSION,
    storeId,
    createdAt,
    keyIds: keys.map(key => boundedString(key.keyId, 'key ID')),
    generations: keys.map(key => key.generation),
    fingerprints: keys.map(key => boundedString(key.fingerprint, 'fingerprint')),
    n: RECOVERY_SCRYPT_N,
    r: RECOVERY_SCRYPT_R,
    p: RECOVERY_SCRYPT_P,
    maxmem: RECOVERY_SCRYPT_MAXMEM,
    outputLength: RECOVERY_DERIVED_KEY_BYTES,
    salt: salt.toString('base64url'),
    iv: iv.toString('base64url'),
  };
  for (const key of keys) {
    if (key.bytes.length !== RECOVERY_DERIVED_KEY_BYTES
      || fingerprintKey(key.bytes) !== key.fingerprint) {
      invalid('Recovery export key identity is invalid');
    }
  }
  const plaintext = Buffer.from(JSON.stringify(
    keys.map(key => ({ keyId: key.keyId, bytes: key.bytes.toString('base64url') })),
  ), 'utf8');
  const wrappingKey = derive(passphrase, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', wrappingKey, iv);
    cipher.setAAD(canonicalHeader(header));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const serialized: SerializedRecoveryBundle = {
      header,
      ciphertext: ciphertext.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
    };
    const output = Buffer.from(JSON.stringify(serialized), 'utf8');
    if (output.length > RECOVERY_MAX_BUNDLE_BYTES) invalid('Recovery bundle exceeds size limit');
    // Verify before reporting success.
    importRecoveryBundle(output, storeId, passphrase);
    return output;
  } finally {
    wrappingKey.fill(0);
    plaintext.fill(0);
  }
}

function validateHeader(value: unknown): RecoveryHeader {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Recovery bundle header is invalid');
  const header = value as Partial<RecoveryHeader>;
  if (
    header.bundleVersion !== RECOVERY_BUNDLE_VERSION
    || header.kdfVersion !== RECOVERY_KDF_VERSION
    || header.n !== RECOVERY_SCRYPT_N
    || header.r !== RECOVERY_SCRYPT_R
    || header.p !== RECOVERY_SCRYPT_P
    || header.maxmem !== RECOVERY_SCRYPT_MAXMEM
    || header.outputLength !== RECOVERY_DERIVED_KEY_BYTES
  ) invalid('Recovery bundle KDF policy is unsupported');
  const storeId = boundedString(header.storeId, 'store ID');
  if (!Number.isSafeInteger(header.createdAt)) invalid('Recovery bundle timestamp is invalid');
  if (!Array.isArray(header.keyIds) || !Array.isArray(header.generations)
    || !Array.isArray(header.fingerprints)
    || header.keyIds.length === 0 || header.keyIds.length > RECOVERY_MAX_KEY_COUNT
    || header.generations.length !== header.keyIds.length
    || header.fingerprints.length !== header.keyIds.length) {
    invalid('Recovery bundle key metadata is invalid');
  }
  const keyIds = header.keyIds.map(value => boundedString(value, 'key ID'));
  const fingerprints = header.fingerprints.map(value => boundedString(value, 'fingerprint'));
  const generations = header.generations.map(value => {
    if (!Number.isSafeInteger(value) || value < 0) invalid('Recovery bundle generation is invalid');
    return value;
  });
  const salt = boundedEncodedBinary(header.salt, 'salt', RECOVERY_SALT_BYTES);
  const iv = boundedEncodedBinary(header.iv, 'IV', RECOVERY_IV_BYTES);
  decodeCanonicalBase64Url(salt, 'salt', RECOVERY_SALT_BYTES).fill(0);
  decodeCanonicalBase64Url(iv, 'IV', RECOVERY_IV_BYTES).fill(0);
  return {
    bundleVersion: RECOVERY_BUNDLE_VERSION,
    kdfVersion: RECOVERY_KDF_VERSION,
    storeId,
    createdAt: header.createdAt as number,
    keyIds,
    generations,
    fingerprints,
    n: RECOVERY_SCRYPT_N,
    r: RECOVERY_SCRYPT_R,
    p: RECOVERY_SCRYPT_P,
    maxmem: RECOVERY_SCRYPT_MAXMEM,
    outputLength: RECOVERY_DERIVED_KEY_BYTES,
    salt,
    iv,
  };
}

export function importRecoveryBundle(
  input: Buffer,
  expectedStoreId: string,
  passphrase: string,
): ImportedRecoveryBundle {
  if (input.length === 0 || input.length > RECOVERY_MAX_BUNDLE_BYTES) {
    invalid('Recovery bundle size is invalid');
  }
  let serialized: Partial<SerializedRecoveryBundle>;
  try {
    serialized = JSON.parse(input.toString('utf8')) as Partial<SerializedRecoveryBundle>;
  } catch {
    invalid('Recovery bundle JSON is invalid');
  }
  const header = validateHeader(serialized.header);
  if (header.storeId !== expectedStoreId) invalid('Recovery bundle store ID does not match');
  const ciphertextText = boundedEncodedBinary(
    serialized.ciphertext,
    'ciphertext',
    RECOVERY_MAX_BUNDLE_BYTES,
  );
  const tagText = boundedEncodedBinary(
    serialized.tag,
    'authentication tag',
    RECOVERY_TAG_BYTES,
  );
  const ciphertext = decodeCanonicalBase64Url(ciphertextText, 'ciphertext');
  const tag = decodeCanonicalBase64Url(tagText, 'authentication tag', RECOVERY_TAG_BYTES);

  const salt = decodeCanonicalBase64Url(header.salt, 'salt', RECOVERY_SALT_BYTES);
  const iv = decodeCanonicalBase64Url(header.iv, 'IV', RECOVERY_IV_BYTES);
  const wrappingKey = derive(passphrase, salt);
  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv('aes-256-gcm', wrappingKey, iv, {
      authTagLength: RECOVERY_TAG_BYTES,
    });
    decipher.setAAD(canonicalHeader(header));
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    invalid('Recovery bundle authentication failed');
  } finally {
    wrappingKey.fill(0);
  }
  try {
    const records = JSON.parse(plaintext.toString('utf8')) as unknown;
    if (!Array.isArray(records) || records.length !== header.keyIds.length) {
      invalid('Recovery bundle key material is invalid');
    }
    const keys = records.map((record, index): RecoveryKeyMaterial => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        invalid('Recovery bundle key record is invalid');
      }
      const item = record as { keyId?: unknown; bytes?: unknown };
      const keyId = boundedString(item.keyId, 'key ID');
      const bytesText = boundedEncodedBinary(item.bytes, 'wrapped key', RECOVERY_DERIVED_KEY_BYTES);
      if (keyId !== header.keyIds[index]) invalid('Recovery bundle key order is invalid');
      const bytes = decodeCanonicalBase64Url(
        bytesText,
        'wrapped key',
        RECOVERY_DERIVED_KEY_BYTES,
      );
      if (fingerprintKey(bytes) !== header.fingerprints[index]) {
        bytes.fill(0);
        invalid('Recovery bundle key fingerprint is invalid');
      }
      return {
        keyId,
        generation: header.generations[index],
        fingerprint: header.fingerprints[index],
        bytes,
      };
    });
    return { storeId: header.storeId, createdAt: header.createdAt, keys };
  } finally {
    plaintext.fill(0);
  }
}
