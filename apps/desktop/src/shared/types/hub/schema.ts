/**
 * Hub Schema Registry
 * 
 * Defines the schemas for all shared entities in the Data Hub.
 * This is the "Source of Truth" for Hub data structures.
 * 
 * Related: TICKET_117_1 - Unified Data Hub Pattern Design
 */

import { AlgorithmRecord } from '../algorithm';

/**
 * File-related types for File Sharing Hub (TICKET_117_2)
 */
export interface FileMetadata {
  name: string;
  type: 'strategy' | 'data' | 'report' | 'config' | 'cache';
  mimeType?: string;
  sourcePath?: string;
  content?: Buffer;
  description?: string;
  tags?: string[];
}

export interface FileRecord extends FileMetadata {
  id: string;
  storageType: 'blob' | 'external';
  externalPath?: string;
  size: number;
  checksum?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/**
 * Registry of all available Hub Entity types and their records
 */
export interface HubEntityMap {
  'nona_algorithm': AlgorithmRecord;
  'nona_factor': FactorRecord;
  'backtest_result': BacktestResultRecord;
  'file:strategy': FileRecord;
  'file:data': FileRecord;
  'file:report': FileRecord;
  'file:config': FileRecord;
  'file:cache': FileRecord;
}

export type HubEntityType = keyof HubEntityMap;

/**
 * Registry of all available Hub Events and their payloads
 */
export interface HubEventPayload {
  'algorithm:created': { id: number; name: string; userId: string };
  'algorithm:updated': { id: number; fields: string[] };
  'algorithm:deleted': { id: number };
  'backtest:started': { id: string; algorithmId: number; symbol: string };
  'backtest:completed': { id: string; success: boolean };
  'data:refreshed': { symbol: string; interval: string };
  'file:registered': { id: string; name: string; type: string };
  'file:removed': { id: string };
}

export type HubEventType = keyof HubEventPayload;

/**
 * Registry of all global reactive states
 */
export interface HubStateMap {
  'active_algorithm_id': number | null;
  'active_symbol': string | null;
  'is_generating_strategy': boolean;
  'last_error': { code: string; message: string } | null;
}

export type HubStateKey = keyof HubStateMap;

/**
 * Placeholder for FactorRecord (to be defined in TICKET_118)
 */
export interface FactorRecord {
  id: number;
  name: string;
  formula: string;
  user_id: string;
  create_time: string;
}

/**
 * Placeholder for BacktestResultRecord (to be defined in TICKET_119)
 */
export interface BacktestResultRecord {
  id: number;
  algorithm_id: number;
  metrics: string; // JSON
  trades: string; // JSON
  user_id: string;
  create_time: string;
}
