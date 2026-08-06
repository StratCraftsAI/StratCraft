/**
 * Centralized View Registry
 *
 * Single source of truth for all view-related configuration.
 * Consolidates mappings previously scattered across multiple files.
 *
 * @see TICKET_069 - Centralized View Registry
 * @see TICKET_067 - Plugin Hub Authentication
 * @see TICKET_068 - Page Hierarchy Definition
 */

import React, { lazy } from 'react';
import { Cpu, Package, PackageCheck, Settings, Activity, BarChart3, LineChart, Bot, FlaskConical, Database } from 'lucide-react';
import { PLUGIN_IDS } from '@shared/constants';
import i18n from 'i18next';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * All valid view identifiers in the application.
 * This is the canonical list - all other usages should reference this type.
 */
/**
 * TICKET_135: V3 removed 'data' view (merged into backtest)
 * TICKET_234: Added 'backtestResult' as independent result page
 */
/**
 * TICKET_1335_1: Added 'researchEnvironment' as a system-tool peer of
 * 'settings' -- registered here, but rendered in SidePanel's bottom rail
 * rather than the ordinary product-navigation order (see its entry below).
 */
export type ViewId =
  | 'nexus'
  | 'strategy'
  | 'backtest'
  | 'backtestResult'
  | 'quantLab'
  | 'signalGenerator'
  | 'marketplace'
  | 'dataManagement'
  | 'settings'
  | 'researchEnvironment'
  | 'chart'
  | 'ai';

/**
 * Page hierarchy levels per TICKET_068.
 * L1: Landing/Hub pages
 * L2: Plugin Hub pages
 * L3: Deep views within plugins
 */
export type PageLevel = 'L1' | 'L2' | 'L3';

/**
 * Complete configuration for a view.
 */
export interface ViewConfig {
  // === Identity ===
  /** Unique view identifier */
  viewId: ViewId;
  /** Associated plugin ID (only for plugin-backed views) */
  pluginId?: string;

  // === Display ===
  /**
   * Full display name in English. Fallback when `labelKey` is missing or its
   * translation file has not loaded yet. Consumers should prefer
   * `t(labelKey) ?? label` (TICKET_786_4).
   */
  label: string;
  /**
   * Short label for breadcrumbs in English. Fallback for `shortLabelKey`.
   */
  shortLabel?: string;
  /**
   * Translation key in the `ui` namespace resolving to the localized full
   * display name (TICKET_786_4).
   */
  labelKey?: string;
  /**
   * Translation key in the `ui` namespace resolving to the localized
   * short breadcrumb label (TICKET_786_4).
   */
  shortLabelKey?: string;
  /** Lucide icon component */
  icon: React.ElementType;
  /** Custom icon image path (overrides icon) */
  iconPath?: string;

  // === Navigation ===
  /** Whether to show in sidebar */
  showInSidebar: boolean;
  /** Order in sidebar (lower = higher) */
  sidebarOrder?: number;

  // === Page Hierarchy (TICKET_068) ===
  /** Page level in hierarchy */
  level: PageLevel;

  // === Authentication (TICKET_067) ===
  /** Whether this is a Plugin Hub (shows AuthWidget) */
  isPluginHub: boolean;
  /** Service provider name for authentication */
  providerName?: string;
  /** Whether authentication is required */
  authRequired?: boolean;

  // === Parent View (Breadcrumb Hierarchy) ===
  /** Parent view for breadcrumb chain (e.g., backtestResult -> backtest) */
  parentViewId?: ViewId;

  // === Component ===
  /** Lazy-loaded component */
  component: React.LazyExoticComponent<React.ComponentType<any>>;
}

// -----------------------------------------------------------------------------
// Registry Definition
// -----------------------------------------------------------------------------

/**
 * Central registry of all views in the application.
 *
 * To add a new view:
 * 1. Add the viewId to the ViewId type above
 * 2. Add the configuration entry below
 * 3. Create the component file
 *
 * That's it - no other files need modification.
 */
export const VIEW_REGISTRY: Record<ViewId, ViewConfig> = {
  // -------------------------------------------------------------------------
  // L1: Landing Pages (No AuthWidget)
  // -------------------------------------------------------------------------
  nexus: {
    viewId: 'nexus',
    label: 'Nexus Hub',
    shortLabel: 'Hub',
    labelKey: 'viewRegistry.nexus.label',
    shortLabelKey: 'viewRegistry.nexus.shortLabel',
    icon: Cpu,
    showInSidebar: true,
    sidebarOrder: 1,
    level: 'L1',
    isPluginHub: false,
    component: lazy(() => import('@/features/nexus/NexusHubPage')),
  },

  marketplace: {
    viewId: 'marketplace',
    pluginId: PLUGIN_IDS.MARKETPLACE,
    label: 'Plugin Marketplace',
    shortLabel: 'Marketplace',
    labelKey: 'viewRegistry.marketplace.label',
    shortLabelKey: 'viewRegistry.marketplace.shortLabel',
    icon: Package,
    showInSidebar: true,
    sidebarOrder: 2,
    level: 'L1',
    isPluginHub: false,
    component: lazy(() => import('@/features/marketplace/MarketplacePage')),
  },

  // TICKET_340: Data Management Center
  dataManagement: {
    viewId: 'dataManagement',
    label: 'Data Management',
    shortLabel: 'Data Mgmt',
    labelKey: 'viewRegistry.dataManagement.label',
    shortLabelKey: 'viewRegistry.dataManagement.shortLabel',
    icon: Database,
    showInSidebar: true,
    sidebarOrder: 3,
    level: 'L1',
    isPluginHub: false,
    component: lazy(() => import('@/features/data-management/DataManagementPage')),
  },

  settings: {
    viewId: 'settings',
    label: 'Settings',
    shortLabel: 'Settings',
    labelKey: 'viewRegistry.settings.label',
    shortLabelKey: 'viewRegistry.settings.shortLabel',
    icon: Settings,
    showInSidebar: false,
    level: 'L1',
    isPluginHub: false,
    component: lazy(() => import('@/components/settings/SettingsPage')),
  },

  /**
   * TICKET_1335_1 D2: Research Environment manager.
   *
   * `showInSidebar: false` is load-bearing, not an omission. The bottom rail is
   * an explicit system-tool zone rendered after `flex-1` in `SidePanel.tsx`,
   * not part of `getSidebarItems()` ordering -- giving this a `sidebarOrder`
   * would drop it among Nexus/Marketplace/Data Management/Scoreboard, which
   * D1 rejects. It is a PEER of `settings`, sharing that flag for that reason.
   *
   * Level L1 and `isPluginHub: false` match `settings`: this is a host system
   * page, so it shows no AuthWidget, and TICKET_638 means it requires no login.
   */
  researchEnvironment: {
    viewId: 'researchEnvironment',
    label: 'Research Environment',
    shortLabel: 'Research Env',
    labelKey: 'viewRegistry.researchEnvironment.label',
    shortLabelKey: 'viewRegistry.researchEnvironment.shortLabel',
    icon: PackageCheck,
    showInSidebar: false,
    level: 'L1',
    isPluginHub: false,
    component: lazy(() => import('@/features/research-environment/ResearchEnvironmentPage')),
  },

  // -------------------------------------------------------------------------
  // L2: Plugin Hubs (Show AuthWidget)
  // -------------------------------------------------------------------------
  strategy: {
    viewId: 'strategy',
    pluginId: PLUGIN_IDS.STRATEGY,
    label: 'StratForge',
    shortLabel: 'StratForge',
    labelKey: 'viewRegistry.strategy.label',
    shortLabelKey: 'viewRegistry.strategy.shortLabel',
    icon: Activity,
    iconPath: '/images/plugin_line_icon.png',
    showInSidebar: false,
    level: 'L2',
    isPluginHub: true,
    providerName: 'StratForge',
    // TICKET_638: authRequired removed -- BYOK strategy generation works without login
    component: lazy(() => import('@/features/strategy/StrategyStudioPage')),
  },

  backtest: {
    viewId: 'backtest',
    pluginId: PLUGIN_IDS.BACKTEST,
    label: 'Backtester',
    shortLabel: 'Backtester',
    labelKey: 'viewRegistry.backtest.label',
    shortLabelKey: 'viewRegistry.backtest.shortLabel',
    icon: BarChart3,
    iconPath: '/images/plugin_line_icon.png',
    showInSidebar: false,
    level: 'L2',
    isPluginHub: true,
    providerName: 'Backtester',
    // TICKET_638: authRequired removed -- backtest execution is fully local
    component: lazy(() => import('@/features/backtest/BacktestPage')),
  },

  // TICKET_234: Independent Backtest Result Page
  backtestResult: {
    viewId: 'backtestResult',
    pluginId: PLUGIN_IDS.BACKTEST,
    label: 'Backtest Result',
    shortLabel: 'Result',
    labelKey: 'viewRegistry.backtestResult.label',
    shortLabelKey: 'viewRegistry.backtestResult.shortLabel',
    icon: BarChart3,
    showInSidebar: false,
    level: 'L2',
    isPluginHub: false,
    parentViewId: 'backtest',
    component: lazy(() => import('@/features/backtest/BacktestResultPage')),
  },

  // TICKET_250: QUANT LAB - Alpha Factory
  quantLab: {
    viewId: 'quantLab',
    pluginId: PLUGIN_IDS.QUANT_LAB,
    label: 'Sigma',
    shortLabel: 'Sigma',
    labelKey: 'viewRegistry.quantLab.label',
    shortLabelKey: 'viewRegistry.quantLab.shortLabel',
    icon: FlaskConical,
    iconPath: '/images/plugin_line_icon.png',
    showInSidebar: false,
    level: 'L2',
    isPluginHub: true,
    providerName: 'Sigma',
    // TICKET_638: authRequired removed -- Quant Lab works with BYOK
    component: lazy(() => import('@/features/plugin-host/QuantLabHostPage')),
  },

  signalGenerator: {
    viewId: 'signalGenerator',
    pluginId: PLUGIN_IDS.SIGNAL_GENERATOR,
    label: 'Signal Generator',
    shortLabel: 'Signal Gen',
    labelKey: 'viewRegistry.signalGenerator.label',
    shortLabelKey: 'viewRegistry.signalGenerator.shortLabel',
    icon: Activity,
    iconPath: '/images/plugin_line_icon.png',
    showInSidebar: false,
    level: 'L2',
    isPluginHub: true,
    providerName: 'Signal Generator',
    component: lazy(() => import('@/features/plugin-host/SignalGeneratorHostPage')),
  },

  // TICKET_135: 'data' view removed - Data functionality merged into Backtest module

  // -------------------------------------------------------------------------
  // L2: Other Views (No AuthWidget - not Plugin Hubs)
  // -------------------------------------------------------------------------
  chart: {
    viewId: 'chart',
    label: 'Chart',
    shortLabel: 'Chart',
    labelKey: 'viewRegistry.chart.label',
    shortLabelKey: 'viewRegistry.chart.shortLabel',
    icon: LineChart,
    showInSidebar: false,
    level: 'L2',
    isPluginHub: false,
    // Placeholder component - will be replaced
    component: lazy(() => Promise.resolve({
      default: () => React.createElement('div', { className: 'p-6' }, i18n.t('comingSoon.chartView', { ns: 'ui' })),
    })),
  },

  ai: {
    viewId: 'ai',
    label: 'AI Assistant',
    shortLabel: 'AI',
    labelKey: 'viewRegistry.ai.label',
    shortLabelKey: 'viewRegistry.ai.shortLabel',
    icon: Bot,
    showInSidebar: false,
    level: 'L2',
    isPluginHub: false,
    // Placeholder component - will be replaced
    component: lazy(() => Promise.resolve({
      default: () => React.createElement('div', { className: 'p-6' }, i18n.t('comingSoon.aiAssistant', { ns: 'ui' })),
    })),
  },
};

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------

/**
 * Get configuration for a specific view.
 */
export function getViewConfig(viewId: ViewId): ViewConfig {
  return VIEW_REGISTRY[viewId];
}

/**
 * Get view configuration by plugin ID.
 * Returns undefined if no view is associated with the plugin.
 */
export function getViewByPluginId(pluginId: string): ViewConfig | undefined {
  return Object.values(VIEW_REGISTRY).find((config) => config.pluginId === pluginId);
}

/**
 * Get view ID by plugin ID.
 * Returns undefined if no view is associated with the plugin.
 */
export function getViewIdByPluginId(pluginId: string): ViewId | undefined {
  const config = getViewByPluginId(pluginId);
  return config?.viewId;
}

/**
 * Get ALL view IDs registered for a plugin (TICKET_1231_1).
 * A plugin can own multiple views (e.g. backtest + backtestResult). This is
 * the single source of truth for the bare `onView` activation event: the
 * derived activation view set of a plugin.
 */
export function getViewIdsByPluginId(pluginId: string): ViewId[] {
  return Object.values(VIEW_REGISTRY)
    .filter((config) => config.pluginId === pluginId)
    .map((config) => config.viewId);
}

/**
 * Whether a string names a registered host view (TICKET_1231_1).
 * Used to validate explicit `onView:<viewId>` manifest declarations at
 * load time.
 */
export function isKnownViewId(viewId: string): boolean {
  return viewId in VIEW_REGISTRY;
}

/**
 * Get all sidebar navigation items, sorted by order.
 */
export function getSidebarItems(): ViewConfig[] {
  return Object.values(VIEW_REGISTRY)
    .filter((config) => config.showInSidebar)
    .sort((a, b) => (a.sidebarOrder ?? 99) - (b.sidebarOrder ?? 99));
}

/**
 * Get all Plugin Hub views.
 */
export function getPluginHubViews(): ViewConfig[] {
  return Object.values(VIEW_REGISTRY).filter((config) => config.isPluginHub);
}

/**
 * Check if a view is a Plugin Hub.
 */
export function isPluginHub(viewId: ViewId): boolean {
  return VIEW_REGISTRY[viewId]?.isPluginHub ?? false;
}

/**
 * Get provider name for a view.
 * Returns undefined if not a Plugin Hub or no provider configured.
 */
export function getProviderName(viewId: ViewId): string | undefined {
  const config = VIEW_REGISTRY[viewId];
  return config?.isPluginHub ? config.providerName : undefined;
}

/**
 * Get auth configuration for a view.
 * Compatible with previous plugin-hub-auth.ts interface.
 */
export function getPluginHubAuthConfig(viewId: string): {
  isPluginHub: boolean;
  providerName?: string;
  authRequired?: boolean;
} | undefined {
  const config = VIEW_REGISTRY[viewId as ViewId];
  if (!config) return undefined;

  return {
    isPluginHub: config.isPluginHub,
    providerName: config.providerName,
    authRequired: config.authRequired,
  };
}

/**
 * Get all view IDs.
 */
export function getAllViewIds(): ViewId[] {
  return Object.keys(VIEW_REGISTRY) as ViewId[];
}

/**
 * Get icon path for a plugin.
 * Returns the custom iconPath if defined, otherwise undefined.
 */
export function getPluginIconPath(pluginId: string): string | undefined {
  const config = getViewByPluginId(pluginId);
  return config?.iconPath;
}
