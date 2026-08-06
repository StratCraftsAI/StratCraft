/**
 * Alt-Data Provider Bootstrap
 *
 * TICKET_568_5_1 Phase 3: Register all alternative-data providers with
 * `AltDataProviderRegistry` at Electron main-process startup. Phase 3
 * shipped the FRED Macro provider; follow-up tickets register additional
 * providers, one register() call per provider:
 *   - TICKET_568_5_1_a -- MarketauxProvider (sentiment, news)
 *   - TICKET_568_5_1_b -- CftcCotProvider (fund-flow, CFTC COT via Socrata)
 *   - TICKET_568_5_1_c -- BinanceFundingRateProvider (on-chain, landed)
 *
 * The bootstrap is intentionally synchronous: provider constructors are
 * cheap (no network, no key read). Credentials are resolved lazily on
 * first fetchFactorData() / startLiveStream() call -- so registering a
 * provider before its BYOK key is configured is fine; the user just sees
 * an actionable error when they try to USE it.
 */

import { appLog } from '../../../utils/logger';
import { AltDataProviderRegistry } from './types';
import { FredProvider } from './fred-provider';
import { MarketauxProvider } from './marketaux-provider';
import { CftcCotProvider } from './cftc-cot-provider';
import { BinanceFundingRateProvider } from './binance-funding-provider';
import { wrapProviderWithHistoryPersistence } from './history-persistence';

let initialized = false;

/**
 * Register the Phase 3 alt-data providers. Safe to call multiple times --
 * the second call is a no-op (mirrors `initializeDataProviderManager()`).
 */
export function initializeAltDataProviders(): void {
  if (initialized) {
    appLog.warn('[AltDataProviders] Already initialized, skipping');
    return;
  }
  initialized = true;

  // TICKET_196_7_7 P4.1 step (b): every provider is wrapped in a history
  // persistence proxy at registration time so that any
  // `startLiveStream().onRow` invocation also INSERTs into `alt_data_history`
  // (migration v52). The Scoreboard live-IC writer replays the reducer over
  // those persisted rows; without this hook the rows would be discarded after
  // the ccxt plugin host pipes them into the C++ live engine. The wrapper is
  // applied centrally here rather than in each provider so future providers
  // get persistence for free.
  AltDataProviderRegistry.register(wrapProviderWithHistoryPersistence(new FredProvider()));
  // TICKET_568_5_1_b: first concrete fund_flow provider. CFTC COT
  // (Disaggregated + TFF Futures-Only) via the Socrata JSON API on
  // publicreporting.cftc.gov. Anonymous-readable; optional Socrata App
  // Token (BYOK `cftc-cot.appToken`) raises the rate-limit ceiling.
  // vintage_supported=false (Socrata exposes only the latest revised
  // value; backtest registration refused by the persistence guard, which
  // is the honest behavior). Live streaming polls the Friday 15:00-18:00
  // ET release window.
  AltDataProviderRegistry.register(wrapProviderWithHistoryPersistence(new CftcCotProvider()));
  // TICKET_568_5_1_a: first concrete sentiment provider. vintage_supported
  // is false so backtest registration is refused by the persistence guard
  // (correct behavior -- news archives can be edited silently). Live
  // streaming remains available for TICKET_196_7_7 consumers.
  AltDataProviderRegistry.register(wrapProviderWithHistoryPersistence(new MarketauxProvider()));
  // TICKET_568_5_1_c: first concrete on-chain provider. Binance USD-M
  // funding rates + OI z-score via CCXT, anonymous (no BYOK).
  // vintage_supported=true because exchange settlements are immutable --
  // backtest registration is admitted by the persistence guard.
  AltDataProviderRegistry.register(wrapProviderWithHistoryPersistence(new BinanceFundingRateProvider()));

  appLog.info(
    `[AltDataProviders] Registered ${AltDataProviderRegistry.list().length} alt-data provider(s): ` +
      AltDataProviderRegistry.list().map((p) => p.id).join(', '),
  );
}

/** Test-only: reset bootstrap flag so each test starts from a clean slate. */
export function _resetAltDataBootstrapForTests(): void {
  initialized = false;
  AltDataProviderRegistry.__resetForTests__();
}
