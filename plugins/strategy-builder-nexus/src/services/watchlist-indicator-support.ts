import supportedWatchlistIndicatorSlugs from '../../assets/indicators/watchlist-supported-indicator-slugs.json';

export type IndicatorSelectorContext = 'default' | 'watchlist' | 'backtest';

interface IndicatorTargets {
  backtrader?: Record<string, unknown>;
  nonabt?: Record<string, unknown>;
}

interface IndicatorLike {
  slug: string;
  targets?: IndicatorTargets;
}

const WATCHLIST_SUPPORTED_SLUGS = new Set<string>(supportedWatchlistIndicatorSlugs);

export function isWatchlistSupportedIndicatorSlug(slug?: string | null): boolean {
  return typeof slug === 'string' && WATCHLIST_SUPPORTED_SLUGS.has(slug);
}

export function isWatchlistSupportedIndicator(indicator?: IndicatorLike | null): boolean {
  if (!indicator) {
    return false;
  }

  if (indicator.targets?.nonabt) {
    return true;
  }

  return isWatchlistSupportedIndicatorSlug(indicator.slug);
}

export function filterIndicatorsForContext<T extends IndicatorLike>(
  indicators: T[],
  context: IndicatorSelectorContext = 'default',
): T[] {
  if (context !== 'watchlist') {
    return indicators;
  }

  return indicators.filter(isWatchlistSupportedIndicator);
}
