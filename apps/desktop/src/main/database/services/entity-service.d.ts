/**
 * EntityService - Generic service layer for Data Hub entities
 *
 * Provides base CRUD operations for any table in the framework database.
 * Used by the Unified Data Hub pattern to manage shared business data.
 *
 * Related: TICKET_117_1 - Unified Data Hub Pattern Design
 */
import { DatabaseManager } from '../db-manager';
export interface EntityResult<T> {
    success: boolean;
    data?: T;
    error?: string;
}
/**
 * Generic Entity Service
 *
 * Usage:
 * const algoService = new EntityService<AlgorithmRecord>(db, 'nona_algorithms');
 */
export declare class EntityService<T extends {
    id: number | string;
    version?: number;
}> {
    protected db: DatabaseManager;
    protected tableName: string;
    constructor(db: DatabaseManager, tableName: string);
    /**
     * Tables that support optimistic locking (version column)
     */
    private static VERSIONED_TABLES;
    private isVersioned;
    /**
     * Execute operations in a transaction
     */
    transaction<R>(fn: () => R): Promise<R>;
    /**
     * Save a new record (Async)
     */
    save(data: Partial<T>): Promise<number | string>;
    /**
     * Save a new record (Sync - for use in transactions)
     */
    saveSync(data: Partial<T>): number | string;
    /**
     * Get record by ID (Async)
     */
    get(id: number | string): Promise<T | null>;
    /**
     * Get record by ID (Sync)
     */
    getSync(id: number | string): T | null;
    /**
     * Find records with simple filters
     */
    find(filters?: Record<string, any>, options?: {
        limit?: number;
        offset?: number;
        orderBy?: string;
    }): Promise<T[]>;
    /**
     * Update record by ID (Async)
     */
    update(id: number | string, data: Partial<T>, expectedVersion?: number): Promise<void>;
    /**
     * Update record by ID (Sync)
     */
    updateSync(id: number | string, data: Partial<T>, expectedVersion?: number): void;
    /**
     * Delete record by ID (Async)
     */
    delete(id: number | string): Promise<void>;
    /**
     * Delete record by ID (Sync)
     */
    deleteSync(id: number | string): void;
    /**
     * Count records
     */
    count(filters?: Record<string, any>): Promise<number>;
}
//# sourceMappingURL=entity-service.d.ts.map