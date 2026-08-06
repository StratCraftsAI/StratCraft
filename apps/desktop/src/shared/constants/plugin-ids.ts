/**
 * Plugin ID Constants
 *
 * Single source of truth for all plugin identifiers.
 * These IDs must match the 'id' field in plugins/{name}/manifest.json.
 *
 * @see TICKET_070 - Plugin Manifest Unification
 * @see TICKET_055_2 - Plugin Metadata Specification
 */

/**
 * V3 Module IDs
 *
 * TICKET_135: V3 has 2 modules (Strategy, Backtest+Data merged)
 * Format: com.stratcraft.<module-name>
 */
export const PLUGIN_IDS = {
  /** Strategy Module - Strategy creation and AI code generation */
  STRATEGY: 'com.stratcraft.strategy-builder-nexus',

  /** Backtest Module - Strategy backtesting + Data loading (V3 merged) */
  BACKTEST: 'com.stratcraft.back-test-nexus',

  /** QUANT LAB Module - Alpha Factory signal combination (TICKET_250) */
  QUANT_LAB: 'com.stratcraft.quant-lab-nexus',

  /** Signal Generator Module - Live trading signal production (CCXT) */
  SIGNAL_GENERATOR: 'com.stratcraft.signal-generator-nexus',

  /** Plugin Marketplace */
  MARKETPLACE: 'com.stratcraft.marketplace',
} as const;

/**
 * Plugin ID type for type-safe usage
 */
export type PluginId = (typeof PLUGIN_IDS)[keyof typeof PLUGIN_IDS];

/**
 * Check if a string is a valid core plugin ID
 */
export function isCorePluginId(id: string): id is PluginId {
  return Object.values(PLUGIN_IDS).includes(id as PluginId);
}
