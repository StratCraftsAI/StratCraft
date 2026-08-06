/**
 * AlgorithmService - Service layer for nona_algorithms table operations
 *
 * Handles:
 * - Inserting LLM-generated algorithms
 * - Querying algorithms by ID, name, type
 * - Updating algorithm metadata
 *
 * Related:
 * - TICKET_115: Algorithm Storage Implementation
 * - TICKET_117_1: Data Hub Pattern
 */
import { DatabaseManager } from '../db-manager';
import { EntityService } from './entity-service';
/**
 * Data required to insert a new algorithm into database
 */
export interface AlgorithmInsertData {
    code: string;
    strategy_name: string;
    strategy_type: number;
    classification_metadata: string;
    strategy_rules?: string;
    description?: string;
    file_path?: string;
    prompt_template?: string;
    user_id: string;
    category?: string;
    metadata?: string;
    record_type?: string;
    is_system?: number;
    activate?: number;
    status?: number;
    pnl?: string;
    sync_status?: string;
    local_only?: number;
    version?: number;
    audit_status?: 'pending' | 'completed' | 'failed' | 'skipped';
}
/**
 * Complete algorithm record from database
 */
export interface AlgorithmRecord {
    id: number;
    code: string;
    file_path: string | null;
    strategy_name: string | null;
    description: string | null;
    strategy_type: number;
    classification_metadata: string | null;
    record_type: string;
    category: string | null;
    metadata: string | null;
    pnl: string;
    user_id: string | null;
    is_system: number;
    status: number;
    activate: number;
    create_time: string;
    update_time: string;
    sync_status: string;
    last_sync_time: string | null;
    local_only: number;
    strategy_rules: string | null;
    prompt_template: string | null;
    version: number;
    deleted_at: string | null;
    compile_status: 'pending' | 'success' | 'error' | null;
    compile_error: string | null;
    compile_hash: string | null;
    compile_artifact_path: string | null;
    compiled_at: number | null;
    audit_status: 'pending' | 'completed' | 'failed' | 'skipped' | null;
}
/**
 * TICKET_709: Return type for insertAlgorithm with auto-dedup
 */
export interface AlgorithmInsertResult {
    id: number;
    strategy_name: string;
}
/**
 * TICKET_437_2: L1 coverage summary row (GROUP BY regime, signal_source, indicator_combo)
 */
export interface CoverageSummaryRow {
    regime: string | null;
    signal_source: string | null;
    indicator_combo: string | null;
    variant_count: number;
}
/**
 * TICKET_437_2: L2 subset detail row (per-strategy fingerprint for focused dedup)
 */
export interface SubsetDetailRow {
    strategy_name: string | null;
    class_name: string | null;
    feature_fingerprint: string | null;
    trading_style: string | null;
}
export declare class AlgorithmService extends EntityService<AlgorithmRecord> {
    constructor(db: DatabaseManager);
    /**
     * Insert a new algorithm into the database with automatic name dedup.
     * TICKET_709: Centralizes name collision resolution.
     */
    insertAlgorithm(data: AlgorithmInsertData): Promise<AlgorithmInsertResult>;
    /**
     * Get algorithm by ID (Aliased for compatibility)
     */
    getAlgorithmById(id: number): Promise<AlgorithmRecord | null>;
    /**
     * Update algorithm fields (Aliased for compatibility)
     */
    updateAlgorithm(id: number, data: Partial<AlgorithmInsertData>): Promise<void>;
    /**
     * TICKET_641_8: Update audit status for an algorithm
     */
    updateAuditStatus(id: number, status: 'pending' | 'completed' | 'failed' | 'skipped'): Promise<void>;
    /**
     * TICKET_437: Check if a strategy name already exists for a given user
     */
    existsByName(strategyName: string, userId: string): Promise<boolean>;
    /**
     * Get algorithms by user ID (Specific query logic)
     */
    getAlgorithmsByUserId(userId: string, options?: {
        strategy_type?: number;
        limit?: number;
        offset?: number;
    }): Promise<AlgorithmRecord[]>;
    /**
     * TICKET_210: Get algorithms by user ID with signal_source prefix filter
     * Filters by extracting signal_source from classification_metadata JSON
     */
    getAlgorithmsBySignalSource(userId: string, options: {
        strategy_type?: number;
        signalSourcePrefix: string;
        limit?: number;
        offset?: number;
    }): Promise<AlgorithmRecord[]>;
    /**
     * TICKET_437_2 L1: Get coverage summary grouped by regime, signal_source, indicator_combo
     */
    getCoverageSummary(userId: string): CoverageSummaryRow[];
    /**
     * TICKET_437_2 L2: Get per-strategy detail for a specific signal_source + regime subset
     */
    getSubsetDetail(userId: string, signalSource: string, regime: string, limit?: number): SubsetDetailRow[];
}
//# sourceMappingURL=algorithm-service.d.ts.map