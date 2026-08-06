import type { MarketId, AnyMarketId, AssetClass } from './market-id';
import { isDynamicMarketId, assetClassOf } from './market-id';

/** TICKET_927_1_4_C: per-market cost rates. Each bucket reads its own
 *  entry; absence = the bucket runs under documented defaults
 *  (per-MarketId defaults below), never silently zero. */
export interface PerMarketCost {
  /** One-sided fee rate as a fraction of notional (e.g. 0.00005 = 0.5 bps). */
  feeRate: number;
  /** One-sided impact / slippage as a fraction of notional. */
  impactRate: number;
  /** Per-bar funding charge as a fraction of notional. Required for
   *  perpetual markets (`ccxt_perp`); absent for spot / equity / FX. */
  fundingRate?: number;
}

export type PortfolioCostModel = ReadonlyMap<string, PerMarketCost>;

/** Per-MarketId defaults -- documented industry-typical, NOT zero. The
 *  defaults are conservative (slightly high) so omission errs toward
 *  understating Sharpe rather than overstating it. */
export const DEFAULT_PER_MARKET_COST: Record<MarketId, PerMarketCost> = {
  alpaca_us_equity:      { feeRate: 0.00001, impactRate: 0.0005  },  // 0.1 bps + 5 bps
  yfinance_us_equity:    { feeRate: 0.00001, impactRate: 0.0005  },
  clickhouse_us_equity:  { feeRate: 0.00001, impactRate: 0.0005  },
  databento_us_equity:   { feeRate: 0.00001, impactRate: 0.0005  },  // TICKET_958
  dukascopy_forex:       { feeRate: 0.0,     impactRate: 0.00005 },  // 0 + 0.5 bps
  yfinance_forex:        { feeRate: 0.0,     impactRate: 0.0001  },  // synthetic, wider
  ccxt_spot:             { feeRate: 0.0001,  impactRate: 0.0002  },  // 1 bps + 2 bps
  ccxt_perp:             { feeRate: 0.0005,  impactRate: 0.0002,
                           fundingRate: 0.0001 },                    // 5 + 2 + funding
  yfinance_synthetic_crypto: { feeRate: 0.0001, impactRate: 0.001 },
  baostock_cn_a_share:   { feeRate: 0.0003, impactRate: 0.0005 },    // stamp duty + impact
  tushare_cn_a_share:    { feeRate: 0.0003, impactRate: 0.0005 },
  akshare_cn_a_share:    { feeRate: 0.0003, impactRate: 0.0005 },
};

const BYOD_COST_BY_ASSET_CLASS: Readonly<Record<AssetClass, PerMarketCost>> = {
  us_equity:  { feeRate: 0.00001, impactRate: 0.0005  },
  forex:      { feeRate: 0.0,     impactRate: 0.00005 },
  crypto:     { feeRate: 0.0001,  impactRate: 0.0002  },
  cn_a_share: { feeRate: 0.0003,  impactRate: 0.0005  },
};

/** TICKET_880_3_5 Phase 2: per-symbol cost parameters derived from OHLCV
 *  data. The orchestrator's `charge_costs` stage uses these to compute
 *  heterogeneous transaction costs per symbol instead of the uniform
 *  `costPerTurnover` rate. */
export interface PerStockCostParams {
  /** Half bid-ask spread proxy: 0.5 * avg((H-L)/C) over the lookback. */
  readonly halfSpread: number;
  /** Garman-Klass volatility (annualised) over the lookback window. */
  readonly gkVol: number;
  /** Average daily volume (in shares/contracts) over the lookback. */
  readonly avgVolume: number;
}

/** TICKET_880_3_5 Phase 2: universal market-impact constant (dimensionless).
 *  Calibrated from CFM (2016) / Ledoit-Wolf (2025): the 3/2-power impact
 *  law uses `b * sigma * |delta_w|^(3/2) / sqrt(V)`. Default 1.0 is the
 *  literature baseline; the user may tune it via the request. */
export const DEFAULT_IMPACT_CONSTANT = 1.0;

export function getDefaultCostForMarket(market: AnyMarketId): PerMarketCost {
  const static_ = DEFAULT_PER_MARKET_COST[market as MarketId];
  if (static_) return static_;
  if (isDynamicMarketId(market)) {
    const ac = assetClassOf(market);
    return BYOD_COST_BY_ASSET_CLASS[ac];
  }
  throw new Error(
    `TICKET_1095: no cost model for market '${market}'.`,
  );
}
