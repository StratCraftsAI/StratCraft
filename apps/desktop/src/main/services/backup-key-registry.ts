import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { parseGcm2, schemeOf } from '@StratCraft/secure-store';

const MANIFEST_SUFFIX = '.secure-store-keys.json';
const DIGEST_CHUNK_BYTES = 1024 * 1024;

export interface BackupKeyManifest {
  version: 1;
  backupId: string;
  storeId: string;
  contentDigest: string;
  keyIds: string[];
  createdAt: number;
}

function tableExists(db: Database.Database, table: string): boolean {
  return db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
  ).get(table) !== undefined;
}

function digestFile(filePath: string): string {
  const hash = createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(DIGEST_CHUNK_BYTES);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    buffer.fill(0);
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

export function extractBackupKeyReferences(
  db: Database.Database,
): { storeId: string; keyIds: string[] } {
  const keyIds = new Set<string>();
  let storeId = 'legacy-v1';
  if (tableExists(db, 'secure_store_state')) {
    const state = db.prepare(
      'SELECT store_id, active_key_id FROM secure_store_state WHERE singleton_id = 1',
    ).get() as { store_id: string; active_key_id: string } | undefined;
    if (state) {
      storeId = state.store_id;
      keyIds.add(state.active_key_id);
    }
  }
  const collect = (table: string): void => {
    if (!tableExists(db, table)) return;
    const rows = db.prepare(`SELECT value FROM ${table}`).all() as Array<{ value: string }>;
    for (const row of rows) {
      const scheme = schemeOf(row.value);
      if (scheme === 'gcm1') keyIds.add('legacy-v1');
      if (scheme === 'gcm2') keyIds.add(parseGcm2(row.value).keyId);
    }
  };
  collect('credentials');
  collect('credential_recovery_archive');
  if (tableExists(db, 'secure_store_lifecycle_journal')) {
    const rows = db.prepare(
      'SELECT key_ids_json FROM secure_store_lifecycle_journal',
    ).all() as Array<{ key_ids_json: string }>;
    for (const row of rows) {
      const parsed = JSON.parse(row.key_ids_json) as unknown;
      if (!Array.isArray(parsed) || parsed.some(keyId => typeof keyId !== 'string')) {
        throw new Error('SecureStore lifecycle journal contains invalid key references');
      }
      for (const keyId of parsed) keyIds.add(keyId);
    }
  }
  return { storeId, keyIds: [...keyIds].sort() };
}

function writeManifest(filePath: string, manifest: BackupKeyManifest): void {
  const target = filePath + MANIFEST_SUFFIX;
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(manifest), {
    encoding: 'utf8',
    mode: process.platform === 'win32' ? undefined : 0o600,
    flag: 'wx',
  });
  const descriptor = fs.openSync(temporary, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, target);
}

function readManifest(filePath: string): BackupKeyManifest | null {
  const manifestPath = filePath + MANIFEST_SUFFIX;
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Partial<BackupKeyManifest>;
    if (manifest.version !== 1
      || typeof manifest.backupId !== 'string'
      || typeof manifest.storeId !== 'string'
      || typeof manifest.contentDigest !== 'string'
      || typeof manifest.createdAt !== 'number'
      || !Array.isArray(manifest.keyIds)
      || manifest.keyIds.some(keyId => typeof keyId !== 'string')) return null;
    return manifest as BackupKeyManifest;
  } catch {
    return null;
  }
}

export class BackupKeyRegistry {
  constructor(private readonly liveDb: Database.Database) {}

  registerBackup(backupPath: string): BackupKeyManifest {
    const digest = digestFile(backupPath);
    const snapshot = new (this.liveDb.constructor as typeof Database)(backupPath, {
      readonly: true,
      fileMustExist: true,
    });
    let references: { storeId: string; keyIds: string[] };
    try {
      const integrity = snapshot.pragma('quick_check') as Array<{ quick_check: string }>;
      if (integrity.length !== 1 || integrity[0].quick_check !== 'ok') {
        throw new Error('SecureStore backup registry refused an invalid SQLite snapshot');
      }
      references = extractBackupKeyReferences(snapshot);
    } finally {
      snapshot.close();
    }
    const existing = tableExists(this.liveDb, 'secure_store_backup')
      ? this.liveDb.prepare(
        'SELECT backup_id, created_at FROM secure_store_backup WHERE content_digest = ?',
      ).get(digest) as { backup_id: string; created_at: number } | undefined
      : undefined;
    const manifest: BackupKeyManifest = {
      version: 1,
      backupId: existing?.backup_id ?? randomUUID(),
      storeId: references.storeId,
      contentDigest: digest,
      keyIds: references.keyIds,
      createdAt: existing?.created_at ?? Date.now(),
    };
    writeManifest(backupPath, manifest);
    if (tableExists(this.liveDb, 'secure_store_backup')) {
      this.liveDb.transaction(() => {
        this.liveDb.prepare(
          `INSERT INTO secure_store_backup
             (backup_id, store_id, content_digest, created_at, status)
           VALUES (?, ?, ?, ?, 'retained')
           ON CONFLICT(content_digest) DO UPDATE SET status = 'retained'`,
        ).run(
          manifest.backupId,
          manifest.storeId,
          manifest.contentDigest,
          manifest.createdAt,
        );
        const registered = this.liveDb.prepare(
          'SELECT backup_id FROM secure_store_backup WHERE content_digest = ?',
        ).get(manifest.contentDigest) as { backup_id: string };
        if (registered.backup_id !== manifest.backupId) {
          throw new Error('SecureStore backup manifest identity does not match its registry row');
        }
        this.liveDb.prepare(
          'DELETE FROM secure_store_backup_key WHERE backup_id = ?',
        ).run(registered.backup_id);
        const insertKey = this.liveDb.prepare(
          'INSERT INTO secure_store_backup_key (backup_id, key_id) VALUES (?, ?)',
        );
        for (const keyId of manifest.keyIds) insertKey.run(registered.backup_id, keyId);
      })();
    }
    return manifest;
  }

  /**
   * Cheap inventory-only reconciliation. A matching manifest and live registry
   * row are a scheduling hint, never authority for recovery or key deletion.
   * Missing or inconsistent inventory is rebuilt with the full verifier.
   */
  reconcileInventory(backupPath: string): BackupKeyManifest {
    const manifest = readManifest(backupPath);
    if (manifest && tableExists(this.liveDb, 'secure_store_backup')) {
      const retained = this.liveDb.prepare(
        `SELECT 1 FROM secure_store_backup
          WHERE backup_id = ? AND content_digest = ? AND status = 'retained'`,
      ).get(manifest.backupId, manifest.contentDigest);
      const keyCount = this.liveDb.prepare(
        'SELECT COUNT(*) AS count FROM secure_store_backup_key WHERE backup_id = ?',
      ).get(manifest.backupId) as { count: number };
      if (retained && keyCount.count === new Set(manifest.keyIds).size) return manifest;
    }
    return this.registerBackup(backupPath);
  }

  verifiedRecoverySelection(
    backupPath: string,
  ): { storeId: string; keyIds: string[] } {
    const manifestPath = backupPath + MANIFEST_SUFFIX;
    if (!fs.existsSync(manifestPath)) {
      throw new Error('SecureStore backup manifest is missing');
    }
    const manifest = readManifest(backupPath);
    if (!manifest) {
      throw new Error('SecureStore backup manifest is invalid');
    }
    if (digestFile(backupPath) !== manifest.contentDigest) {
      throw new Error('SecureStore backup content does not match its manifest');
    }
    const snapshot = new (this.liveDb.constructor as typeof Database)(backupPath, {
      readonly: true,
      fileMustExist: true,
    });
    let references: { storeId: string; keyIds: string[] };
    try {
      references = extractBackupKeyReferences(snapshot);
    } finally {
      snapshot.close();
    }
    const manifestKeys = [...new Set(manifest.keyIds)].sort();
    if (references.storeId !== manifest.storeId
      || references.keyIds.length !== manifestKeys.length
      || references.keyIds.some((keyId, index) => keyId !== manifestKeys[index])) {
      throw new Error('SecureStore backup key references do not match its manifest');
    }
    if (!tableExists(this.liveDb, 'secure_store_backup')) {
      throw new Error('SecureStore backup registry completeness cannot be proven');
    }
    const retained = this.liveDb.prepare(
      `SELECT 1 FROM secure_store_backup
        WHERE backup_id = ? AND content_digest = ? AND status = 'retained'`,
    ).get(manifest.backupId, manifest.contentDigest);
    if (!retained) throw new Error('SecureStore backup is not retained in the live registry');
    return references;
  }

  markRemoved(backupPath: string): void {
    const manifestPath = backupPath + MANIFEST_SUFFIX;
    if (!fs.existsSync(manifestPath)) return;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupKeyManifest;
    fs.unlinkSync(manifestPath);
    if (tableExists(this.liveDb, 'secure_store_backup')) {
      this.liveDb.prepare(
        `UPDATE secure_store_backup SET status = 'removed' WHERE content_digest = ?`,
      ).run(manifest.contentDigest);
    }
  }

  assertKeyPrunable(keyId: string, retainedBackupPaths: readonly string[]): void {
    if (!tableExists(this.liveDb, 'secure_store_backup')) {
      throw new Error('SecureStore backup reference completeness cannot be proven');
    }
    for (const backupPath of retainedBackupPaths) {
      const selection = this.verifiedRecoverySelection(backupPath);
      if (selection.keyIds.includes(keyId)) {
        throw new Error(`SecureStore key ${keyId} is referenced by a retained backup`);
      }
    }
    const retained = this.liveDb.prepare(
      `SELECT 1 FROM secure_store_backup_key bk
        JOIN secure_store_backup b ON b.backup_id = bk.backup_id
       WHERE bk.key_id = ? AND b.status = 'retained' LIMIT 1`,
    ).get(keyId);
    if (retained) throw new Error(`SecureStore key ${keyId} is referenced by a retained backup`);
  }
}

export const BACKUP_KEY_MANIFEST_SUFFIX = MANIFEST_SUFFIX;
