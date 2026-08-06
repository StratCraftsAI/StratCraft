/**
 * @StratCraft/types -- shared SQLite schema-version contract.
 *
 * TICKET_1276 P2 gate 2 (schema-version-skew contract).
 *
 * The Electron main process is the SOLE migration writer: its `MigrationManager`
 * (apps/desktop/src/main/database/migrations/migration-manager.ts) owns the
 * `EMBEDDED_MIGRATIONS` array and records applied versions in the
 * `schema_version` table (`MAX(version)` is the current DB schema version).
 * NOTE: the app tracks schema version via the `schema_version` TABLE, not
 * SQLite's `PRAGMA user_version` -- callers guarding compatibility MUST read
 * the table, not the pragma.
 *
 * The MCP standalone process opens the SAME SQLite file read-only (and RW for a
 * small set of storage-owned UPDATEs) but NEVER runs migrations. To avoid a
 * silent wrong read when the two processes are built against different schema
 * versions, the MCP DB-open path compares the on-disk `MAX(schema_version.version)`
 * against this constant and raises an explicit `schemaAhead` / `schemaBehind`
 * error (TICKET_858) instead of reading blindly.
 *
 * SOURCE OF TRUTH: this MUST equal the highest `version` in `EMBEDDED_MIGRATIONS`.
 * The migration-invariants property test asserts that equality so this constant
 * cannot silently drift behind a newly added migration. When you add a migration
 * with a higher version, bump this constant in the same change set.
 */
export const EXPECTED_SCHEMA_VERSION = 147;
