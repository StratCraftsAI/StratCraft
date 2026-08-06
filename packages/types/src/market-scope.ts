import { isAnyMarketId, MARKET_IDS } from './market-id';
import type { AnyMarketId } from './market-id';

/**
 * TICKET_927_1_1: a signal's market-of-applicability (TICKET_927 section 0.1).
 *
 * Value-typed (DDD value-object pattern): immutable, normalised at
 * construction, equality by value. Use `MarketScope.from(...)` to
 * construct -- the constructor enforces dedup + lexicographic sort so
 * two scopes with the same markets in different input order hash
 * identically.
 *
 * TICKET_1095: widened to `AnyMarketId` to support dynamic BYOD markets.
 */
export class MarketScope {
  readonly markets: ReadonlyArray<AnyMarketId>;

  private constructor(markets: ReadonlyArray<AnyMarketId>) {
    this.markets = markets;
  }

  static all(): MarketScope {
    return MarketScope.from([...MARKET_IDS]);
  }

  static isAll(scope: MarketScope): boolean {
    return scope.markets.length === MARKET_IDS.length
      && MARKET_IDS.every(m => scope.markets.includes(m));
  }

  static from(markets: readonly AnyMarketId[]): MarketScope {
    if (markets.length === 0) {
      throw new Error('MarketScope.from: markets must be non-empty');
    }
    const seen = new Set<AnyMarketId>();
    for (const m of markets) {
      if (!isAnyMarketId(m)) {
        throw new Error(`MarketScope.from: '${String(m)}' is not a known MarketId or DynamicMarketId`);
      }
      seen.add(m);
    }
    const sorted = Array.from(seen).sort();
    return new MarketScope(Object.freeze(sorted));
  }

  static fromJson(raw: string | null | undefined): MarketScope | null {
    if (raw == null || raw === '') return null;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return null; }
    if (!Array.isArray(parsed)) return null;
    if (!parsed.every(isAnyMarketId)) return null;
    try { return MarketScope.from(parsed); } catch { return null; }
  }

  toJson(): string {
    return JSON.stringify(this.markets);
  }

  covers(market: AnyMarketId): boolean {
    return this.markets.includes(market);
  }

  intersect(runMarkets: ReadonlySet<AnyMarketId>): AnyMarketId[] {
    return this.markets.filter(m => runMarkets.has(m));
  }

  equals(other: MarketScope): boolean {
    if (this.markets.length !== other.markets.length) return false;
    for (let i = 0; i < this.markets.length; i++) {
      if (this.markets[i] !== other.markets[i]) return false;
    }
    return true;
  }

  toKey(): string {
    return this.markets.join('|');
  }
}
