/**
 * Alternative Data Provider Interface
 *
 * TICKET_568_5_1 Phase 1: Sibling of `IDataProvider` for non-OHLCV alternative
 * data sources (macro, sentiment, fund flow, on-chain). Not a subclass --
 * different return shape (no `queryOHLCV`, no symbol-search semantics) and
 * different temporal contract (`event_time` + `knowledge_time`).
 *
 * Phase 1 ships the contract + an empty registry. The first concrete
 * implementation (FRED Macro) lands in Phase 3.
 *
 * @see docs/design/TICKET_568_5_1_SIGNAL_DISCOVERY_LAYER3_ALTERNATIVE_DATA_FACTORS.md
 */

import type {
  AlternativeDataRequest,
  AlternativeFactorCategory,
  AlternativeFactorRow,
} from '../../../../shared/types/signal-discovery';

/**
 * Universal alternative-data provider interface.
 *
 * Every alt-data source (FRED macro, news NLP, ETF flows, on-chain feeds)
 * must implement this interface. The ONLY output contract is
 * `AlternativeFactorRow[]` carrying `event_time` + `knowledge_time` + optional
 * `vintage_id` -- downstream factor evaluation is provider-agnostic.
 */
export interface IAlternativeDataProvider {
  /** Unique provider identifier, e.g. `'fred'`, `'glassnode'` */
  readonly id: string;

  /** Human-readable display name */
  readonly name: string;

  /**
   * Top-level category this provider supplies. A provider serves exactly one
   * category; multiple providers per category are allowed.
   */
  readonly source: AlternativeFactorCategory;

  /**
   * Whether this provider can return historical values as they were known at
   * a given knowledge time (i.e. a vintage archive). Providers with
   * `vintage_supported: false` are PERMANENTLY refused for backtest by the
   * persistence guard -- look-ahead bias on revised macro series is
   * impossible to mitigate without a vintage archive.
   */
  readonly vintage_supported: boolean;

  /**
   * Whether this provider can stream live observations into the live engine.
   * Required by TICKET_196_7_7 (NLP / alt-data live signal pack) consumers.
   */
  readonly live_streaming_supported: boolean;

  /**
   * Fetch factor data for the given request. MUST return rows sorted by
   * `event_time` ASC. MUST set `knowledge_time >= event_time` (the contract
   * for any honest historical join). When `params.vintage_as_of` is set and
   * the provider declares `vintage_supported: true`, the returned series MUST
   * reflect the value as it was known at `vintage_as_of`, NOT the latest
   * revision.
   *
   * @throws Error with actionable message on failure
   */
  fetchFactorData(params: AlternativeDataRequest): Promise<AlternativeFactorRow[]>;

  /**
   * Start a live polling stream that forwards new rows (knowledge_time
   * strictly ascending, no look-ahead) to `onRow`. Returns a `stop()` function
   * that cancels any in-flight timer. MUST be present iff
   * `live_streaming_supported === true`. Consumed by TICKET_196_7_7 P2.2 to
   * bridge alt-data into the C++ live engine via stdin `type: 'alt_data'`.
   */
  startLiveStream?(
    params: AlternativeDataRequest,
    onRow: (row: AlternativeFactorRow) => void,
    onError: (err: Error) => void,
    pollIntervalMs?: number,
  ): () => void;
}

/**
 * Registry of installed alternative-data providers.
 *
 * The Phase 1 instance is intentionally empty; the persistence-layer
 * registration guard refuses any alt-data signal whose `source_provider` is
 * not present here (or whose registered provider reports
 * `vintage_supported: false`). The FRED provider registers itself in Phase 3.
 *
 * Singleton via module export; tests reset via `__resetForTests__()`.
 */
class AltDataProviderRegistryImpl {
  private providers = new Map<string, IAlternativeDataProvider>();

  register(provider: IAlternativeDataProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(
        `[AltDataProviderRegistry] provider id '${provider.id}' already registered; ` +
          `unregister first or use a unique id`,
      );
    }
    this.providers.set(provider.id, provider);
  }

  unregister(id: string): void {
    this.providers.delete(id);
  }

  get(id: string): IAlternativeDataProvider | undefined {
    return this.providers.get(id);
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  list(): IAlternativeDataProvider[] {
    return Array.from(this.providers.values());
  }

  /** Test-only: clear the registry. Production code MUST NOT call this. */
  __resetForTests__(): void {
    this.providers.clear();
  }
}

export const AltDataProviderRegistry = new AltDataProviderRegistryImpl();
