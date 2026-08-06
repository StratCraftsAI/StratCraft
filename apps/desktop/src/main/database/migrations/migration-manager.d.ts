import { DatabaseManager } from '../db-manager';
/**
 * MigrationManager - Version-controlled database migrations
 *
 * Features:
 * - Auto-discovery of migration files from scripts/ directory
 * - UP/DOWN migration support
 * - Transaction-based execution
 * - Schema version tracking
 *
 * Migration file format:
 * ```sql
 * -- UP MIGRATION
 * CREATE TABLE foo (...);
 *
 * -- DOWN MIGRATION
 * DROP TABLE foo;
 * ```
 *
 * See: TICKET_110_DESKTOP_DATABASE_SCHEMA.md
 */
export declare class MigrationManager {
    private db;
    constructor(db: DatabaseManager);
    /**
     * Get current schema version from database
     */
    private getCurrentVersion;
    /**
     * Load embedded migrations (no file I/O needed)
     */
    private loadMigrations;
    /**
     * Run all pending migrations (UP)
     *
     * Executes migrations in version order, skipping already applied ones.
     */
    migrate(): Promise<void>;
    /**
     * Rollback to specific version (DOWN)
     *
     * Executes DOWN migrations in reverse order.
     *
     * @param targetVersion - Version to rollback to (exclusive)
     */
    rollback(targetVersion: number): Promise<void>;
    /**
     * Get migration status
     */
    getStatus(): {
        currentVersion: number;
        availableMigrations: number;
        pendingMigrations: number;
        migrations: Array<{
            version: number;
            name: string;
            applied: boolean;
        }>;
    };
    /**
     * Check if migrations are needed
     */
    hasPendingMigrations(): boolean;
}
//# sourceMappingURL=migration-manager.d.ts.map