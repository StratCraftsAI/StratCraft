/**
 * TICKET_383: Shared chart utilities (Tier 0)
 *
 * TICKET_231: Centralized candle coloring logic for synchronized display.
 */

// TICKET_1023_1: Canonical color source: apps/desktop/src/shared/constants/colors.ts (CHART_COLORS).
import { CHART_COLORS } from '@shared/constants/colors';

/** Color for bullish (up) candles - processed */
export const CANDLE_COLOR_BULLISH = CHART_COLORS.PROFIT;

/** Color for bearish (down) candles - processed */
export const CANDLE_COLOR_BEARISH = CHART_COLORS.LOSS;

/** Color for unprocessed candles (gray) */
export const CANDLE_COLOR_UNPROCESSED = CHART_COLORS.UNPROCESSED;

/**
 * TICKET_231: Get candle color based on processed state.
 *
 * @param isUp - Whether candle is bullish (close >= open)
 * @param isProcessed - Whether this candle has been processed by backtest
 * @returns Color string for the candle
 */
export function getCandleColor(isUp: boolean, isProcessed: boolean): string {
  if (!isProcessed) {
    return CANDLE_COLOR_UNPROCESSED;
  }
  return isUp ? CANDLE_COLOR_BULLISH : CANDLE_COLOR_BEARISH;
}

/**
 * TICKET_231: Check if candle index is processed.
 *
 * @param candleIndex - Index of the candle (0-based)
 * @param processedBars - Number of bars processed so far
 * @param totalBars - Total number of bars (optional, for validation)
 * @returns True if candle is processed
 */
export function isCandleProcessed(
  candleIndex: number,
  processedBars: number,
  totalBars?: number
): boolean {
  if (!processedBars || processedBars <= 0) {
    return false;
  }
  if (totalBars !== undefined && processedBars >= totalBars) {
    return true;
  }
  return candleIndex < processedBars;
}
