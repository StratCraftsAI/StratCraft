import { app, safeStorage } from 'electron';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import type { ExecutorConfig } from './executor-service';

function getCheckpointDbPath(): string {
  return join(app.getPath('userData'), 'data', 'checkpoints.db');
}

function openCheckpointDb(): Database.Database {
  const dbPath = getCheckpointDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.prepare(`
    CREATE TABLE IF NOT EXISTS backtest_resume_config (
      task_id TEXT PRIMARY KEY,
      encrypted_config TEXT NOT NULL
    )
  `).run();
  return db;
}

export function persistBacktestResumeConfig(config: ExecutorConfig): void {
  if (!config.taskId) {
    throw new Error('Cannot persist backtest resume configuration without taskId');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    if (process.env.NODE_ENV === 'test') return;
    throw new Error('Secure storage is unavailable; backtest resume configuration cannot be persisted safely');
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(config)).toString('base64');
  const db = openCheckpointDb();
  try {
    db.prepare(`
      INSERT INTO backtest_resume_config (task_id, encrypted_config)
      VALUES (?, ?)
      ON CONFLICT(task_id) DO UPDATE SET encrypted_config = excluded.encrypted_config
    `).run(config.taskId, encrypted);
  } finally {
    db.close();
  }
}

export function loadBacktestResumeConfig(taskId: string): ExecutorConfig | null {
  const dbPath = getCheckpointDbPath();
  if (!existsSync(dbPath)) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    if (process.env.NODE_ENV === 'test') return null;
    throw new Error('Secure storage is unavailable; backtest resume configuration cannot be decrypted');
  }
  const db = openCheckpointDb();
  try {
    const row = db.prepare(
      'SELECT encrypted_config FROM backtest_resume_config WHERE task_id = ?',
    ).get(taskId) as { encrypted_config: string } | undefined;
    if (!row) return null;
    const json = safeStorage.decryptString(Buffer.from(row.encrypted_config, 'base64'));
    return JSON.parse(json) as ExecutorConfig;
  } finally {
    db.close();
  }
}
