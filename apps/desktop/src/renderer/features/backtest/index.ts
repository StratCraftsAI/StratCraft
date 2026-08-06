/**
 * Backtest Feature Module Export
 *
 * TICKET_133: V3 Architecture
 * TICKET_161: Host/Plugin Code Separation Audit
 * TICKET_234: Independent Backtest Result Page
 *
 * NOTE: All UI components have been migrated to plugin layer.
 * V3 components are in plugins/back-test-nexus/ui/src/components/
 *
 * Host layer only provides the shell page components.
 */

// =============================================================================
// Host Layer Exports
// =============================================================================

export { BacktestPage } from './BacktestPage';
export { BacktestResultPage } from './BacktestResultPage';
