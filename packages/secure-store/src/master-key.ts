/**
 * Structured OS-keyring adapter for SecureStore master keys.
 *
 * Discovery is read-only. In particular, a thrown read and malformed key
 * material are never interpreted as absence and never authorize a write.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

export const KEYRING_SERVICE = 'StratCraft';
export const LEGACY_KEYRING_ACCOUNT = 'secure-store-master-v1';
export const MASTER_KEY_BYTES = 32;

export type KeyringFailureKind =
  | 'locked'
  | 'unavailable'
  | 'permission_denied'
  | 'malformed';

export type KeyringReadResult =
  | { kind: 'found'; bytes: Buffer }
  | { kind: 'missing' }
  | { kind: KeyringFailureKind; cause: string; backendCode?: string };

export type KeyringWriteResult =
  | { kind: 'created'; bytes: Buffer }
  | { kind: 'conflict' }
  | { kind: Exclude<KeyringFailureKind, 'malformed'>; cause: string; backendCode?: string }
  | { kind: 'malformed'; cause: string };

export type KeyringDeleteResult =
  | { kind: 'deleted' }
  | { kind: 'missing' }
  | { kind: KeyringFailureKind; cause: string; backendCode?: string };

/** Deterministic legacy injection seam retained for host unit tests only. */
export interface MasterKeyProvider {
  getKey(): Buffer | null;
  lastError(): string | null;
}

export interface KeyringAdapter {
  read(account: string): KeyringReadResult;
  createFresh(account: string, bytes: Buffer): KeyringWriteResult;
  delete(account: string): KeyringDeleteResult;
}

/** Structural slice of a @napi-rs/keyring Entry (injection seam for tests). */
export interface KeyringEntryLike {
  getPassword(): string | null;
  setPassword(value: string): void;
  deletePassword?(): void;
}

export type KeyringEntryFactory = (account: string) => KeyringEntryLike;

interface ClassifiedKeyringError extends Error {
  code?: string;
  secureStoreKind?: 'locked' | 'unavailable' | 'permission_denied';
}

function defaultEntryFactory(account: string): KeyringEntryLike {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Entry } = require('@napi-rs/keyring') as typeof import('@napi-rs/keyring');
  return new Entry(KEYRING_SERVICE, account);
}

function classifyError(error: unknown): {
  kind: 'locked' | 'unavailable' | 'permission_denied';
  cause: string;
  backendCode?: string;
} {
  const candidate = error instanceof Error ? error as ClassifiedKeyringError : undefined;
  const kind = candidate?.secureStoreKind ?? 'unavailable';
  const backendCode = typeof candidate?.code === 'string'
    ? candidate.code.slice(0, 80)
    : undefined;
  // Do not forward backend messages: they may contain user/session data and
  // localized prose is not a stable state discriminator.
  const cause = candidate?.name && candidate.name !== 'Error'
    ? candidate.name.slice(0, 80)
    : 'keyring operation failed';
  return { kind, cause, ...(backendCode ? { backendCode } : {}) };
}

export function fingerprintKey(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseKey(value: string | null): KeyringReadResult {
  if (value === null) return { kind: 'missing' };
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    return { kind: 'malformed', cause: 'keyring value is not a 32-byte hexadecimal key' };
  }
  return { kind: 'found', bytes: Buffer.from(value, 'hex') };
}

export function createKeyringAdapter(
  entryFactory: KeyringEntryFactory = defaultEntryFactory,
): KeyringAdapter {
  return {
    read(account: string): KeyringReadResult {
      try {
        return parseKey(entryFactory(account).getPassword());
      } catch (error) {
        return classifyError(error);
      }
    },

    createFresh(account: string, bytes: Buffer): KeyringWriteResult {
      if (bytes.length !== MASTER_KEY_BYTES) {
        return { kind: 'malformed', cause: 'candidate master key must be 32 bytes' };
      }
      const before = this.read(account);
      if (before.kind === 'found') return { kind: 'conflict' };
      if (before.kind !== 'missing') return before;

      try {
        entryFactory(account).setPassword(bytes.toString('hex'));
      } catch (error) {
        return classifyError(error);
      }

      const after = this.read(account);
      if (after.kind !== 'found') {
        if (after.kind === 'missing') {
          return { kind: 'unavailable', cause: 'keyring write did not round-trip' };
        }
        return after;
      }
      const expected = Buffer.from(fingerprintKey(bytes), 'hex');
      const actual = Buffer.from(fingerprintKey(after.bytes), 'hex');
      if (!timingSafeEqual(expected, actual)) {
        after.bytes.fill(0);
        return { kind: 'conflict' };
      }
      return { kind: 'created', bytes: after.bytes };
    },

    delete(account: string): KeyringDeleteResult {
      const before = this.read(account);
      if (before.kind === 'missing') return before;
      if (before.kind !== 'found') return before;
      before.bytes.fill(0);
      try {
        const entry = entryFactory(account);
        if (!entry.deletePassword) {
          return { kind: 'unavailable', cause: 'keyring backend does not support deletion' };
        }
        entry.deletePassword();
        const after = this.read(account);
        if (after.kind === 'missing') return { kind: 'deleted' };
        if (after.kind === 'found') {
          after.bytes.fill(0);
          return { kind: 'unavailable', cause: 'keyring delete did not round-trip' };
        }
        return after;
      } catch (error) {
        return classifyError(error);
      }
    },
  };
}
