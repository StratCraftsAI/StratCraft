import Database from 'better-sqlite3';
interface DatabaseConfig {
    filename?: string;
    readonly?: boolean;
    fileMustExist?: boolean;
    verbose?: (message?: unknown) => void;
}
/**
 * DatabaseManager - SQLite database wrapper using better-sqlite3
 *
 * Features:
 * - Singleton pattern for single instance
 * - Auto-initialization of schema
 * - Transaction support
 * - WAL mode for better concurrency
 * - Type-safe prepared statements
 *
 * See: TICKET_110_DESKTOP_DATABASE_SCHEMA.md
 */
export declare class DatabaseManager {
    private db;
    private readonly dbPath;
    private isInitialized;
    constructor(config?: DatabaseConfig);
    /**
     * Initialize database schema from schema.sql file
     *
     * This method:
     * 1. Reads the schema.sql file
     * 2. Splits it into individual statements
     * 3. Executes each statement in a transaction
     * 4. Marks database as initialized
     *
     * Safe to call multiple times (idempotent due to IF NOT EXISTS clauses)
     */
    /**
     * Embedded schema - avoids file path issues after webpack bundling
     */
    private static readonly EMBEDDED_SCHEMA;
    initialize(): Promise<void>;
    /**
     * Split SQL file into individual statements
     * Handles multi-line statements and comments
     */
    private splitSqlStatements;
    /**
     * Get list of tables in database
     */
    getTables(): string[];
    /**
     * Get database schema version
     */
    getSchemaVersion(): number;
    /**
     * Execute a transaction
     *
     * Usage:
     * ```typescript
     * const transaction = db.transaction(() => {
     *   // Multiple database operations
     *   stmt1.run();
     *   stmt2.run();
     *   return result;
     * });
     *
     * const result = transaction();
     * ```
     */
    transaction<T>(fn: () => T): () => T;
    /**
     * Prepare a SQL statement
     *
     * Usage:
     * ```typescript
     * const stmt = db.prepare('SELECT * FROM nona_algorithms WHERE user_id = ?');
     * const rows = stmt.all(userId);
     * ```
     */
    prepare<T extends unknown[] = unknown[]>(sql: string): Database.Statement<T>;
    /**
     * Execute a SQL statement directly (for DDL operations)
     */
    exec(sql: string): this;
    /**
     * Get the underlying better-sqlite3 Database instance
     *
     * Use with caution - prefer using the wrapped methods
     */
    getDb(): Database.Database;
    /**
     * Get database file path
     */
    getPath(): string;
    /**
     * Check if database is initialized
     */
    isReady(): boolean;
    /**
     * Close database connection
     *
     * Should be called on app shutdown
     */
    close(): void;
    /**
     * Backup database to specified path
     */
    backup(backupPath: string): Promise<void>;
    /**
     * Get database statistics
     */
    getStats(): {
        path: string;
        size: number;
        tables: string[];
        schemaVersion: number;
        walMode: boolean;
    };
}
/**
 * Get the singleton DatabaseManager instance
 *
 * Usage:
 * ```typescript
 * import { getDatabaseManager } from './db-manager';
 *
 * const db = getDatabaseManager();
 * await db.initialize();
 * ```
 */
export declare function getDatabaseManager(config?: DatabaseConfig): DatabaseManager;
/**
 * Reset singleton instance (for testing)
 */
export declare function resetDatabaseManager(): void;
export {};
//# sourceMappingURL=db-manager.d.ts.map
