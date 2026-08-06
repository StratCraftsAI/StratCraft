/**
 * Crypto base-symbol classification.
 *
 * Single source of truth for "is this ticker a crypto asset?". Used by:
 *   - dukascopy-provider asset-type classification (main process)
 *   - Signal Discovery Layer 3 on-chain category gate (renderer process)
 *
 * Renderer code cannot import from `apps/desktop/src/main/...`; this util
 * lives under `shared/` so both sides can reach it.
 *
 * The list intentionally tracks BASE-symbol identity (BTC, ETH, ...), not
 * trading-pair strings. Callers that hold a pair (e.g. "BTC/USDT") split on
 * '/' and pass the base; callers that hold a bare ticker pass it as-is.
 *
 * @see TICKET_568_5_1_c -- promoted from dukascopy-provider.ts to support
 *      the Layer 3 on-chain crypto-only UI gate.
 */

/**
 * Known crypto base symbols. Mirrors the set used by dukascopy-provider's
 * asset-type classifier. The set is intentionally finite -- a regex /USDT$/
 * or similar would falsely classify forex / stablecoin / wrapped-asset
 * pairs (e.g. a hypothetical "USD/USDT" pair).
 */
export const CRYPTO_BASES: ReadonlySet<string> = new Set([
  'BTC', 'ETH', 'LTC', 'XRP', 'BCH', 'EOS', 'TRX', 'XLM', 'ADA', 'IOTA',
  'NEO', 'DSH', 'XMR', 'ZEC', 'BAT', 'LINK', 'UNI', 'SOL', 'DOT', 'AVAX',
  'DOGE', 'SHIB', 'MATIC', 'ATOM', 'FTM', 'ALGO', 'MANA', 'SAND', 'AXS',
  'CRV', 'AAVE', 'COMP', 'MKR', 'SUSHI', 'YFI', 'OMG', 'ENJ', '1INCH',
]);

/**
 * Returns true if the given symbol identifies a crypto asset.
 *
 * Accepts either a bare base ticker (`'BTC'`) or a pair (`'BTC/USDT'`,
 * `'BTC-USD'`). For pair inputs the segment before the first separator
 * (`'/'` or `'-'`) is treated as the base. Empty / whitespace-only input
 * returns false.
 */
export function isCryptoBaseSymbol(symbol: string | null | undefined): boolean {
  if (!symbol) return false;
  const trimmed = symbol.trim().toUpperCase();
  if (trimmed.length === 0) return false;
  // Pair forms: 'BTC/USDT', 'BTC-USD'. Split on the first separator only.
  const base = trimmed.split(/[/\-]/, 1)[0];
  return CRYPTO_BASES.has(base);
}
