/**
 * Strategy Plugin Editor Registry
 *
 * Maps viewType to React component for dynamic page routing.
 * Host layer queries this registry instead of hardcoding imports.
 *
 * @see TICKET_079 - Dynamic Page Routing Architecture
 * @see TICKET_056 - VS Code Plugin Architecture
 */

import React from 'react';
import { RegimeDetectorPage } from '../components/pages/RegimeDetectorPage';
import { EntrySignalPage } from '../components/pages/EntrySignalPage';
import { KronosPredictorPage } from '../components/pages/KronosPredictorPage';
import { KronosIndicatorEntryPage } from '../components/pages/KronosIndicatorEntryPage';
import { KronosAIEntryPage } from '../components/pages/KronosAIEntryPage';
import { MarketObserverPage } from '../components/pages/MarketObserverPage';
import { TraderAIEntryPage } from '../components/pages/TraderAIEntryPage';
import { AILiberoPage } from '../components/pages/AILiberoPage';
import { AIStrategyStudioPage } from '../components/pages/AIStrategyStudioPage';
import { IndicatorExitPage } from '../components/pages/IndicatorExitPage';
import { StrategyCatalogPage } from '../components/pages/StrategyCatalogPage';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * Props passed to editor components
 */
export interface EditorProps {
  onGenerate?: (config: unknown) => Promise<void>;
  onSettingsClick?: () => void;
  pageTitle?: string;
}

/**
 * Editor provider definition
 */
export interface EditorProvider {
  component: React.ComponentType<EditorProps>;
}

// -----------------------------------------------------------------------------
// Editor Registry
// -----------------------------------------------------------------------------

/**
 * Editor Provider Registry
 *
 * Maps viewType (from manifest.json) to React component.
 * viewType must match manifest.contributes.editors[].viewType
 */
export const EDITOR_PROVIDERS: Record<string, EditorProvider> = {
  'strategy.regimeEditor': {
    component: RegimeDetectorPage,
  },
  'strategy.entrySignal': {
    component: EntrySignalPage,
  },
  'strategy.kronosPredictor': {
    component: KronosPredictorPage,
  },
  // TICKET_208: Kronos Indicator Entry Page
  'strategy.kronosIndicatorEntry': {
    component: KronosIndicatorEntryPage,
  },
  // TICKET_211: Kronos AI Entry Page
  'strategy.kronosAIEntry': {
    component: KronosAIEntryPage,
  },
  // TICKET_077_1: Market Observer Page (page35) - Trader Mode
  'strategy.marketObserver': {
    component: MarketObserverPage,
  },
  // TICKET_214: Trader AI Entry Page (page36) - Trader Mode
  'strategy.traderAIEntry': {
    component: TraderAIEntryPage,
  },
  // TICKET_077_26: AI Libero Page (page37) - AI Command Center Mode
  'strategy.aiLibero': {
    component: AILiberoPage,
  },
  // TICKET_077_19: AI Strategy Studio Page (page38) - AI Strategy Studio Mode
  'strategy.aiStrategyStudio': {
    component: AIStrategyStudioPage,
  },
  // TICKET_274: Indicator Exit Generator (Risk Manager)
  'strategy.indicatorExit': {
    component: IndicatorExitPage,
  },
  // TICKET_994: Strategy Catalog
  'strategy.strategyCatalog': {
    component: StrategyCatalogPage,
  },
};

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------

/**
 * Get editor component by viewType
 *
 * @param viewType - The viewType from manifest.json
 * @returns React component or null if not found
 */
export function getEditorComponent(viewType: string): React.ComponentType<EditorProps> | null {
  return EDITOR_PROVIDERS[viewType]?.component ?? null;
}

/**
 * Check if editor exists for viewType
 *
 * @param viewType - The viewType to check
 * @returns true if editor exists
 */
export function hasEditor(viewType: string): boolean {
  return viewType in EDITOR_PROVIDERS;
}

/**
 * Get all registered viewTypes
 *
 * @returns Array of registered viewType strings
 */
export function getRegisteredViewTypes(): string[] {
  return Object.keys(EDITOR_PROVIDERS);
}
