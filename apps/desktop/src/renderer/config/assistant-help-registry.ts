/**
 * Assistant Help Content Registry (TICKET_593_1)
 *
 * Maps activeView + subPagePath to help content configuration.
 * Also provides a named CONTENT_REGISTRY for panel-internal navigation
 * (e.g., assistant:bollinger-macd links within Markdown content).
 */

import type { SubPageEntry } from '@/stores';
import strategyOverviewMarkdown from '@/content/assistant/strategy-overview.md?raw';
import bollingerMacdMarkdown from '@/content/assistant/bollinger-macd.md?raw';
import rsiMaMarkdown from '@/content/assistant/rsi-ma.md?raw';
import macdRsiDivergenceMarkdown from '@/content/assistant/macd-rsi-divergence.md?raw';
import emaCrossoverMarkdown from '@/content/assistant/ema-crossover.md?raw';
import ichimokuCloudMarkdown from '@/content/assistant/ichimoku-cloud.md?raw';
import fibonacciTrendMarkdown from '@/content/assistant/fibonacci-trend.md?raw';
import vwapStrategyMarkdown from '@/content/assistant/vwap-strategy.md?raw';
import supertrendMarkdown from '@/content/assistant/supertrend.md?raw';
import dualMaVolumeMarkdown from '@/content/assistant/dual-ma-volume.md?raw';

// ============================================================================
// Types
// ============================================================================

export interface HelpContentConfig {
  /** Remote URL for help content (primary source) */
  remoteUrl: string;
  /** Local Markdown file path relative to app resources (offline fallback) */
  localFallback: string;
  /** Panel header title (English fallback) */
  title: string;
  /** i18n key for panel header title (ui namespace, e.g. 'assistantHelp.strategyStudioGuide') */
  titleKey?: string;
  /** Phase 1: bundled markdown content rendered directly in renderer */
  markdownContent?: string;
}

type ViewId = string;

// ============================================================================
// Registry
// ============================================================================

/**
 * Help content registry mapping view IDs to content config.
 * Phase 1: one seeded top-level page so AssistantPanel can render real content.
 */
const HELP_REGISTRY: Record<string, HelpContentConfig> = {
  strategy: {
    remoteUrl: '',
    localFallback: 'help/strategy/overview.md',
    title: 'Strategy Studio Guide',
    titleKey: 'assistantHelp.strategyStudioGuide',
    markdownContent: strategyOverviewMarkdown,
  },
};

/**
 * Named content registry for panel-internal navigation.
 * Keys are referenced by assistant: links in Markdown content.
 */
const CONTENT_REGISTRY: Record<string, HelpContentConfig> = {
  'strategy-overview': {
    remoteUrl: '',
    localFallback: 'help/strategy/overview.md',
    title: 'Strategy Studio Guide',
    titleKey: 'assistantHelp.strategyStudioGuide',
    markdownContent: strategyOverviewMarkdown,
  },
  'bollinger-macd': {
    remoteUrl: '',
    localFallback: 'help/strategy/bollinger-macd.md',
    title: 'Bollinger Bands + MACD Strategy',
    titleKey: 'assistantHelp.bollingerMacd',
    markdownContent: bollingerMacdMarkdown,
  },
  'rsi-ma': {
    remoteUrl: '',
    localFallback: 'help/strategy/rsi-ma.md',
    title: 'RSI + Moving Average Strategy',
    titleKey: 'assistantHelp.rsiMa',
    markdownContent: rsiMaMarkdown,
  },
  'macd-rsi-divergence': {
    remoteUrl: '',
    localFallback: 'help/strategy/macd-rsi-divergence.md',
    title: 'MACD + RSI Divergence Strategy',
    titleKey: 'assistantHelp.macdRsiDivergence',
    markdownContent: macdRsiDivergenceMarkdown,
  },
  'ema-crossover': {
    remoteUrl: '',
    localFallback: 'help/strategy/ema-crossover.md',
    title: 'EMA Crossover Strategy',
    titleKey: 'assistantHelp.emaCrossover',
    markdownContent: emaCrossoverMarkdown,
  },
  'ichimoku-cloud': {
    remoteUrl: '',
    localFallback: 'help/strategy/ichimoku-cloud.md',
    title: 'Ichimoku Cloud Strategy',
    titleKey: 'assistantHelp.ichimokuCloud',
    markdownContent: ichimokuCloudMarkdown,
  },
  'fibonacci-trend': {
    remoteUrl: '',
    localFallback: 'help/strategy/fibonacci-trend.md',
    title: 'Fibonacci Trend Strategy',
    titleKey: 'assistantHelp.fibonacciTrend',
    markdownContent: fibonacciTrendMarkdown,
  },
  'vwap-strategy': {
    remoteUrl: '',
    localFallback: 'help/strategy/vwap-strategy.md',
    title: 'VWAP Strategy',
    titleKey: 'assistantHelp.vwapStrategy',
    markdownContent: vwapStrategyMarkdown,
  },
  'supertrend': {
    remoteUrl: '',
    localFallback: 'help/strategy/supertrend.md',
    title: 'Supertrend Strategy',
    titleKey: 'assistantHelp.supertrend',
    markdownContent: supertrendMarkdown,
  },
  'dual-ma-volume': {
    remoteUrl: '',
    localFallback: 'help/strategy/dual-ma-volume.md',
    title: 'Dual MA + Volume Strategy',
    titleKey: 'assistantHelp.dualMaVolume',
    markdownContent: dualMaVolumeMarkdown,
  },
};

// ============================================================================
// Resolver
// ============================================================================

/**
 * Resolve help content config for the current view and sub-page path.
 * Returns null if no help content is available for this context.
 */
export function resolveHelpContent(
  activeView: ViewId,
  subPagePath: SubPageEntry[]
): HelpContentConfig | null {
  // Build lookup key: e.g., 'strategy:regime' or just 'backtest'
  const subKey = subPagePath.map((s) => s.label.toLowerCase().replace(/\s+/g, '-')).join(':');
  const fullKey = subKey ? `${activeView}:${subKey}` : activeView;

  // Try full key first, then view-level fallback
  return HELP_REGISTRY[fullKey] ?? HELP_REGISTRY[activeView] ?? null;
}

/**
 * Lookup a named content entry for panel-internal navigation.
 * Returns null if the key is not registered.
 */
export function getContentByKey(key: string): HelpContentConfig | null {
  return CONTENT_REGISTRY[key] ?? null;
}
