/**
 * TICKET_927_1_4_D -- Tier-0 per-market risk, vol-target, and turnover-control
 * type aliases + industry-typical defaults.
 *
 * The canonical `TurnoverControl`, `PortfolioRiskConstraints`, and
 * `VolatilityTarget` interface definitions remain at their origin
 * (`factor-portfolio-backtest.ts`) because they own the resolve logic and
 * all existing consumers import from there. This module provides the
 * per-MarketId map aliases and the documented default operating points
 * consumed by the handler when building per-bucket orchestrators.
 *
 * Ticket section 4 decision 3: a missing MarketId in a user-supplied map
 * means "no constraint for this bucket", NOT "fall back to default".
 * Defaults are applied only when the caller passes `useDefaults: true`
 * (explicit opt-in, TICKET_858).
 */

import type { MarketId } from './market-id';

/**
 * TICKET_880_3_5 turnover-control parameters (re-declared as a Tier-0
 * structural subset so the per-market map alias does not deep-import the
 * service layer). Assignable from `factor-portfolio-backtest.TurnoverControl`.
 */
export interface TurnoverControlConfig {
  dailyTradingRate?: number;
  maxTurnoverPerDay?: number;
  rebalanceEveryN?: number;
}

/**
 * TICKET_880_3_6 risk constraints (Tier-0 structural subset).
 * Assignable from `factor-portfolio-backtest.PortfolioRiskConstraints`.
 */
export interface RiskConstraintsConfig {
  maxWeightPerStock?: number;
  maxDrawdown?: number;
  drawdownRecoveryBars?: number;
}

/**
 * TICKET_880_3_7 vol-target (Tier-0 structural subset).
 * Assignable from `factor-portfolio-backtest.VolatilityTarget`.
 */
export interface VolatilityTargetConfig {
  targetVol?: number;
  lookbackWindow?: number;
  maxLeverage?: number;
}

export type PerMarketTurnoverControl =
  ReadonlyMap<MarketId, TurnoverControlConfig>;
export type PerMarketRiskConstraints =
  ReadonlyMap<MarketId, RiskConstraintsConfig>;
export type PerMarketVolatilityTarget =
  ReadonlyMap<MarketId, VolatilityTargetConfig>;

/**
 * Industry-typical per-market operating points. Used as the default
 * map when the caller passes `useDefaults: true` at the request level.
 *
 * TICKET_858 explicit-only: a missing MarketId in a user-supplied
 * partial map means "no constraint for this bucket", NEVER "fall back
 * to this table". The table is ONLY consulted when no user map is
 * provided AND `useDefaults` is true.
 */
export const DEFAULT_PER_MARKET_RISK: Readonly<Record<MarketId, {
  turnover: TurnoverControlConfig;
  risk: RiskConstraintsConfig;
  vol: VolatilityTargetConfig;
}>> = {
  alpaca_us_equity: {
    vol: { targetVol: 0.15, maxLeverage: 2.0, lookbackWindow: 21 },
    risk: { maxWeightPerStock: 0.10, maxDrawdown: 0.20, drawdownRecoveryBars: 5 },
    turnover: { dailyTradingRate: 0.5, maxTurnoverPerDay: 1.0, rebalanceEveryN: 1 },
  },
  yfinance_us_equity: {
    vol: { targetVol: 0.15, maxLeverage: 2.0, lookbackWindow: 21 },
    risk: { maxWeightPerStock: 0.10, maxDrawdown: 0.20, drawdownRecoveryBars: 5 },
    turnover: { dailyTradingRate: 0.5, maxTurnoverPerDay: 1.0, rebalanceEveryN: 1 },
  },
  clickhouse_us_equity: {
    vol: { targetVol: 0.15, maxLeverage: 2.0, lookbackWindow: 21 },
    risk: { maxWeightPerStock: 0.10, maxDrawdown: 0.20, drawdownRecoveryBars: 5 },
    turnover: { dailyTradingRate: 0.5, maxTurnoverPerDay: 1.0, rebalanceEveryN: 1 },
  },
  // TICKET_958: Databento local-parquet US equity -- mirror the other US
  // equity markets; identical risk/turnover/vol envelope.
  databento_us_equity: {
    vol: { targetVol: 0.15, maxLeverage: 2.0, lookbackWindow: 21 },
    risk: { maxWeightPerStock: 0.10, maxDrawdown: 0.20, drawdownRecoveryBars: 5 },
    turnover: { dailyTradingRate: 0.5, maxTurnoverPerDay: 1.0, rebalanceEveryN: 1 },
  },
  dukascopy_forex: {
    vol: { targetVol: 0.10, maxLeverage: 5.0, lookbackWindow: 21 },
    risk: { maxWeightPerStock: 0.20, maxDrawdown: 0.15, drawdownRecoveryBars: 3 },
    turnover: { dailyTradingRate: 0.3, maxTurnoverPerDay: 1.5, rebalanceEveryN: 1 },
  },
  yfinance_forex: {
    vol: { targetVol: 0.10, maxLeverage: 5.0, lookbackWindow: 21 },
    risk: { maxWeightPerStock: 0.20, maxDrawdown: 0.15, drawdownRecoveryBars: 3 },
    turnover: { dailyTradingRate: 0.3, maxTurnoverPerDay: 1.5, rebalanceEveryN: 1 },
  },
  ccxt_spot: {
    vol: { targetVol: 0.25, maxLeverage: 1.0, lookbackWindow: 21 },
    risk: { maxWeightPerStock: 0.15, maxDrawdown: 0.25, drawdownRecoveryBars: 5 },
    turnover: { dailyTradingRate: 0.3, maxTurnoverPerDay: 1.5, rebalanceEveryN: 1 },
  },
  ccxt_perp: {
    vol: { targetVol: 0.20, maxLeverage: 3.0, lookbackWindow: 21 },
    risk: { maxWeightPerStock: 0.15, maxDrawdown: 0.20, drawdownRecoveryBars: 5 },
    turnover: { dailyTradingRate: 0.2, maxTurnoverPerDay: 2.0, rebalanceEveryN: 1 },
  },
  yfinance_synthetic_crypto: {
    vol: { targetVol: 0.25, maxLeverage: 1.0, lookbackWindow: 21 },
    risk: { maxWeightPerStock: 0.15, maxDrawdown: 0.25, drawdownRecoveryBars: 5 },
    turnover: { dailyTradingRate: 0.3, maxTurnoverPerDay: 1.5, rebalanceEveryN: 1 },
  },
  baostock_cn_a_share: {
    vol: { targetVol: 0.18, maxLeverage: 1.0, lookbackWindow: 21 },
    risk: { maxWeightPerStock: 0.10, maxDrawdown: 0.20, drawdownRecoveryBars: 5 },
    turnover: { dailyTradingRate: 0.5, maxTurnoverPerDay: 1.0, rebalanceEveryN: 1 },
  },
  tushare_cn_a_share: {
    vol: { targetVol: 0.18, maxLeverage: 1.0, lookbackWindow: 21 },
    risk: { maxWeightPerStock: 0.10, maxDrawdown: 0.20, drawdownRecoveryBars: 5 },
    turnover: { dailyTradingRate: 0.5, maxTurnoverPerDay: 1.0, rebalanceEveryN: 1 },
  },
  akshare_cn_a_share: {
    vol: { targetVol: 0.18, maxLeverage: 1.0, lookbackWindow: 21 },
    risk: { maxWeightPerStock: 0.10, maxDrawdown: 0.20, drawdownRecoveryBars: 5 },
    turnover: { dailyTradingRate: 0.5, maxTurnoverPerDay: 1.0, rebalanceEveryN: 1 },
  },
};
