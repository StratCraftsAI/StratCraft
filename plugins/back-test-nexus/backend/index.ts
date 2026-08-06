/**
 * Data Nexus Backend Entry Point
 *
 * TICKET_142: Plugin backend module for data operations.
 * This file is loaded by plugin-backend-loader and registered
 * for capability-based discovery.
 */

export {
  initialize,
  searchSymbols,
  checkCoverage,
  checkConnection,
  ensureData,
  classifySymbol,
  type SymbolSearchResult,
  type CoverageCheckConfig,
  type CoverageResult,
  type ConnectionStatus,
  type EnsureDataConfig,
  type EnsureDataResult,
} from './data-service';
