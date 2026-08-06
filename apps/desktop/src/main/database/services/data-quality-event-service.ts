/**
 * TICKET_1126 F2 -- data-quality event persistence (migration v112).
 *
 * Every OHLC validation disposition that touches user data is recorded
 * here: `reject` (bar excluded at a write gate), `suspect` (bar kept but
 * flagged), `repair` (F1: bar replaced from a clean source) and `delete`
 * (F1: bar removed and marked missing). "Import succeeded but two weeks
 * were removed" must be a queryable fact, not a log line (TICKET_858 --
 * no silent failures; TICKET_1126 quarantine-never-silently-drop).
 */

import { getDatabaseManager } from '../db-manager';
import { appLog } from '../../utils/logger';
import type {
  DataQualityRule,
  DataQualitySeverity,
} from '../../../shared/constants/data-quality';

export interface DataQualityEventInput {
  provider: string;
  symbol: string;
  interval: string;
  /** Unix epoch SECONDS of the affected bar; null for file-level events. */
  barTs: number | null;
  rule: DataQualityRule;
  severity: DataQualitySeverity;
  /** Original OHLCV values (JSON-serialisable object). */
  original?: unknown;
  /** Replacement values for `repair` events. */
  replacement?: unknown;
  /** Write path / repair source (e.g. 'data-import-service', 'dukascopy-refetch'). */
  source: string;
  message?: string;
}

export interface DataQualityEventRow extends DataQualityEventInput {
  id: number;
  createdAt: string;
}

/**
 * Record a batch of events in one transaction. Callers at write gates pass
 * every reject + suspect from a validation pass; F1 repair tooling passes
 * one event per repaired/removed bar (AC7 provenance).
 */
export function recordDataQualityEvents(
  events: ReadonlyArray<DataQualityEventInput>,
): void {
  if (events.length === 0) return;
  const db = getDatabaseManager();
  const stmt = db.prepare(`
    INSERT INTO data_quality_event
      (provider, symbol, interval, bar_ts, rule, severity,
       original_json, new_json, source, message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    for (const e of events) {
      stmt.run(
        e.provider,
        e.symbol,
        e.interval,
        e.barTs,
        e.rule,
        e.severity,
        e.original === undefined ? null : JSON.stringify(e.original),
        e.replacement === undefined ? null : JSON.stringify(e.replacement),
        e.source,
        e.message ?? null,
      );
    }
  })();
  appLog.info(
    `[DataQuality] recorded ${events.length} event(s): ` +
      summarizeEvents(events),
  );
}

function summarizeEvents(events: ReadonlyArray<DataQualityEventInput>): string {
  const bySeverity = new Map<string, number>();
  for (const e of events) {
    bySeverity.set(e.severity, (bySeverity.get(e.severity) ?? 0) + 1);
  }
  const parts = [...bySeverity.entries()].map(([s, n]) => `${s}=${n}`);
  const first = events[0];
  return `${first.provider}/${first.symbol}/${first.interval} [${parts.join(', ')}]`;
}

/** Query events for a (provider, symbol, interval) series, newest first. */
export function listDataQualityEvents(filter: {
  provider?: string;
  symbol?: string;
  interval?: string;
  limit?: number;
}): DataQualityEventRow[] {
  const db = getDatabaseManager();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.provider) { clauses.push('provider = ?'); params.push(filter.provider); }
  if (filter.symbol) { clauses.push('symbol = ?'); params.push(filter.symbol); }
  if (filter.interval) { clauses.push('interval = ?'); params.push(filter.interval); }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(filter.limit ?? 1000, 100_000));
  const rows = db.prepare(`
    SELECT id, created_at, provider, symbol, interval, bar_ts, rule, severity,
           original_json, new_json, source, message
    FROM data_quality_event ${where}
    ORDER BY id DESC LIMIT ${limit}
  `).all(...params) as Array<{
    id: number; created_at: string; provider: string; symbol: string;
    interval: string; bar_ts: number | null; rule: string; severity: string;
    original_json: string | null; new_json: string | null;
    source: string; message: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    provider: r.provider,
    symbol: r.symbol,
    interval: r.interval,
    barTs: r.bar_ts,
    rule: r.rule as DataQualityRule,
    severity: r.severity as DataQualitySeverity,
    original: r.original_json === null ? undefined : JSON.parse(r.original_json),
    replacement: r.new_json === null ? undefined : JSON.parse(r.new_json),
    source: r.source,
    message: r.message ?? undefined,
  }));
}
