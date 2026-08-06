# Data Source Distribution Strategy

**Status**: Planning
**Priority**: High
**Category**: Business Architecture / Data Strategy

## Problem Statement

QuantNexus Desktop needs a data source strategy for end-user distribution. Two approaches exist with different trade-offs in legal risk, cost, and user experience.

## Approach A: Centralized Data Source (Vendor-Licensed)

Provide pre-loaded data via ClickHouse so users can backtest immediately after installation.

**Pros:**
- Zero-config user experience, backtest-ready on first launch
- Vendor partnership creates brand exposure and co-marketing opportunities
- Consistent data quality and unified format

**Cons:**
- Legal risk: cannot distribute without explicit vendor authorization
- Ongoing server and bandwidth cost, scales linearly with users
- Data coverage limited to licensed vendors only
- Product launch blocked by vendor negotiation timeline

**Vendor Outreach:**
- HistData.com: **defer outreach until public launch plus visible traction**.
  Current strategy is "ship the tooling, not the data": StratCraft includes a
  HistData connector that guides users to download raw tick data from
  histdata.com themselves, then provides one-click conversion and import. This
  sends traffic to HistData and creates real referral data for future partner
  discussions. The previous email draft is stale and needs brand/link updates.
  See the 2026-06-07 decision in `histdata_supplementary/docs/tickets/001`.
- Other vendors TBD

## Approach B: Plugin-Based Data Connectors (User-Provided Keys)

Provide data connector plugins; users supply their own API keys from data vendors.

**Pros:**
- Zero legal risk: platform distributes connectors, not data
- Zero server cost: data flows directly between user and vendor
- Unlimited extensibility: forex, crypto, equities, futures, any vendor
- Open-source connector repo enables community contributions (flywheel effect)
- Multiple revenue channels: free base connectors + paid advanced connectors

**Cons:**
- Higher onboarding friction: users must register and obtain API keys
- Data quality varies across third-party providers

## Decision

**B is the foundation; A is an optional enhancement built on B.**

### Rationale

1. **B first** -- Aligns with existing `IDataProvider` interface. Zero legal risk, zero ops cost, infinite extensibility. Open-source connector repo builds community; paid connectors generate revenue.

2. **A as a special-case plugin** -- If a vendor grants redistribution rights, implement it as a "built-in data source" plugin on the same `IDataProvider` architecture. ClickHouse is an implementation detail; to the user it is simply a data source that requires no key.

3. **Vendor outreach continues but does not block product** -- Continue negotiations with data vendors. Success adds an extra built-in plugin; failure leaves the product fully functional.

### Architecture Alignment

```
IDataProvider
  |
  +-- DukascopyProvider    (Forex: free, no key, tick-level)
  +-- CCXTProvider         (Crypto: free, no key, 1min)
  +-- AlpacaProvider       (US Equities: free, key required, 1min/10yr)
  +-- BaostockProvider     (China A-Share: free, no key, daily/5min -- no sub-5min)
  +-- YFinanceProvider     (Global Equities: free, no key, daily)
  +-- ClickHouseProvider   (Approach A: vendor-licensed, no key needed)
  +-- OpenBBProvider       (Approach B: user key required)
  +-- HistDataConnector     (Approach B: free built-in connector, user downloads
  |                          raw data from histdata.com, StratCraft converts
  |                          tick CSV -> OHLCV Parquet via productized
  |                          export_tick_to_parquet.py; no key, no redistribution)
  +-- CommunityPlugins     (Approach B: open-source, user key)
```

All approaches converge on the same `IDataProvider` plugin interface. Approach A is a special case where the platform holds the credentials instead of the user.

## Default Data Source Matrix

Priority connectors to ship at launch, covering all major markets with free data:

| Market | Provider | Granularity | History Depth | Key Required | Cost |
|---|---|---|---|---|---|
| Forex | **Dukascopy** | Tick-level | Multi-year | No | Free |
| Crypto | **CCXT** | 1min | Exchange-dependent | No | Free |
| US Equities | **Alpaca** | 1min | 10 years | Yes (free signup) | Free |
| China A-Share (live) | **baostock** | Daily / 5min | Multi-year | No | Free |
| China A-Share (minute history) | **User-provided import (BYOD)** | 1/5/15/30/60min + daily | User-supplied (e.g. 15yr) | No | Free -- DATA_004 |
| Global Equities (daily) | **yfinance** | Daily | 20+ years | No | Free |

**China A-Share classification ( decision).** `QlibProvider` was never
built; the live CN A-share provider is **`baostock`**, which has **no
sub-5-minute bars and no tick data**. That minute-level gap is **not** closed by
bundling a dataset -- StratCraft distributes zero third-party CN A-share data. It
is closed by the **user-provided import path (BYOD, DATA_004 / )**:
the user brings their own dump (e.g. the  800 GB MySQL package), the app
imports it once into the Parquet cache, and it becomes a selectable named source.
The  package is therefore classified **`user-provided`** -- never
bundled, resold, or co-distributed (the redistribution liability stays with the
user).

### Provider Notes

**Dukascopy** (Forex - Primary):
- Tick, 1min, hourly, daily granularity
- Covers forex, CFD, commodities, crypto, stocks, ETFs
- Web tool (no login) or JForex (demo account)
- Open-source downloaders available: `duka` (Python), `dukascopy-node` (JS)
- High quality tick data, ideal as zero-friction default data source

**CCXT** (Crypto):
- `fetch_ohlcv(symbol, timeframe='1m')` for 1-min candles
- Binance, Huobi, MEXC and other major exchanges supported
- Check `exchange.timeframes` for per-exchange availability
- Note: some exchanges differ between spot/futures support

**Alpaca** (US Equities):
- Free account registration (no deposit required)
- 10 years of 1-min OHLCV data, no request rate limit
- Best free option for US intraday backtesting
- Alternative fallbacks: Alpha Vantage (25 req/day), Databento ($125 free credit)

**baostock** (China A-Share -- live, shipped):
- Free, no API key; daily and 5-minute OHLCV
- **No sub-5-minute bars and no tick data** -- this is the gap below
- The originally-planned `QlibProvider` was never built

**User-provided import / BYOD** (China A-Share -- minute history, shipped):
- The supported route for 1/5/15/30/60-minute + multi-year A-share history
- User brings their own dump (the  800 GB MySQL package is the
  canonical case); the app imports it once into the Parquet cache via DuckDB
- Classified **`user-provided`** -- StratCraft bundles/resells nothing; the
  redistribution and quality responsibility stays with the user
- See **DATA_004 / ** for the full design and the package-level
  adjustment (fuquan) handling

**yfinance** (Global Daily):
- Zero-config, no API key needed
- Daily OHLCV for global markets, 20+ year history
- Minute data limited to 7-30 days (not suitable for intraday backtesting)

## Revenue Model

| Connector Type | Pricing | Example |
|---|---|---|
| Built-in free | Free | Dukascopy, CCXT, Alpaca, baostock, yfinance |
| User-provided import (BYOD) | Free | CN A-share minute history via DATA_004 /  |
| Community open-source | Free | Community-contributed connectors |
| Built-in BYOD connector | Free | HistData connector (user downloads raw data, StratCraft converts) |
| Premium paid plugin | One-time or subscription | Institutional feeds, OpenBB |

## Action Items

- [ ] Finalize `IDataProvider` plugin interface
- [x] Implement DukascopyProvider as primary default data source (forex tick data) -- , DATA_002
- [ ] Implement CCXTProvider for crypto market data -- , DATA_003
- [x] Implement AlpacaProvider for US equities minute data -- DATA_001
- [x] Ship baostock as the live CN A-share provider (daily/5min; no sub-5min)
- [x] Close the CN A-share minute-history gap via user-provided import (BYOD),
      not a bundled dataset --  / a / DATA_004
      (supersedes the never-built QlibProvider)
- [ ] Ship yfinance connector as daily-level reference implementation
- [ ] Open-source data connector repo on GitHub
- [ ] Send vendor partnership emails (HistData, others) -- **deferred**: BYOD
      path is working. Revisit HistData outreach after public
      launch plus visible traction. See the 2026-06-07 decision in
      `histdata_supplementary/docs/tickets/001`.
- [ ] Design paid plugin licensing mechanism
- [ ] Document connector development guide for community contributors

## Related Tickets

- Multi-Source Data Provider Interface (`IDataProvider`)
- Auth-Aware UI Gating (provider auth state management)
- ClickHouse Direct Connection Frontend
- ClickHouse Credentials Tunnel
