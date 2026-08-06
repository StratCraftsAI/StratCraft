/**
 * DDL for the `data_quality_event` quarantine/audit ledger (migration v112),
 * shared by Electron main and the standalone MCP server (TICKET_1289_1 F1,
 * TICKET_854).
 *
 * The v112 migration body -- now in this package -- creates this table, and the
 * headless F1/F4 data-repair tooling must be able to record audit events before
 * the app has run the migration. Both need the identical DDL, and the standalone
 * MCP cannot import apps/desktop source, so the string lives here. The app-side
 * shared/constants/data-quality.ts re-exports it (its other data-quality
 * constants are unrelated and stay put).
 */
export const DATA_QUALITY_EVENT_TABLE_DDL = `
        CREATE TABLE IF NOT EXISTS data_quality_event (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          provider TEXT NOT NULL,
          symbol TEXT NOT NULL,
          interval TEXT NOT NULL,
          bar_ts INTEGER,
          rule TEXT NOT NULL,
          severity TEXT NOT NULL CHECK (severity IN ('reject','suspect','repair','delete')),
          original_json TEXT,
          new_json TEXT,
          source TEXT NOT NULL,
          message TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_dq_event_series
          ON data_quality_event(provider, symbol, interval, bar_ts);
`;
