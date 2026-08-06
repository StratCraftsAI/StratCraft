/**
 * Strategy Plugin Views
 *
 * View components are now located in this plugin:
 * - RegimeDetectorPage: Main page component (uses modular UI components)
 * - EntrySignalPage: Entry signal generator page
 * - KronosPredictorPage: Kronos AI predictor page
 * - RegimeSelector: Market regime selector component (component2)
 * - ExpressionInput: Expression builder input (part of component1)
 * - StrategyCard: Strategy card display (part of component1)
 *
 * The strategy-plugin-bridge.tsx in the Host directly imports RegimeDetectorPage.
 *
 * @see TICKET_059 - Host/Plugin Architecture
 * @see TICKET_077 - StratCraftsAI UI Component Library
 * @see TICKET_077_1 - Page Hierarchy
 * @see TICKET_205 - Kronos Predictor Page Migration
 */

// View component paths for reference (actual imports are in strategy-plugin-bridge.tsx)
export const VIEW_COMPONENTS = {
  'strategy.hub': '@renderer/features/strategy/components/hub/StrategyHub',
  'strategy.providerPortal': '@renderer/features/strategy/components/hub/ProviderPortal',
  'strategy.groupList': '@renderer/features/strategy/components/hub/StrategyGroupList',
  'strategy.regimeEditor': '@plugins/strategy-builder-nexus/components/pages/RegimeDetectorPage',
  'strategy.entrySignal': '@plugins/strategy-builder-nexus/components/pages/EntrySignalPage',
  'strategy.kronosPredictor': '@plugins/strategy-builder-nexus/components/pages/KronosPredictorPage',
} as const;

export type ViewComponentId = keyof typeof VIEW_COMPONENTS;
