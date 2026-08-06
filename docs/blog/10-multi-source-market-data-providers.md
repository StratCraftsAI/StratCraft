---
title: "Multi-Source Market Data: Free and advanced Data Providers in StratCraft"
slug: "multi-source-market-data-providers"
category: "Feature"
tags: ["free market data download", "yfinance dukascopy", "clickhouse trading data", "market data management"]
excerpt: "StratCraft supports 6 market data providers including free sources like YFinance and Dukascopy, with a built-in data management center."
estimated_reading_time: "6 min"
---

## Introduction

StratCraft integrates six market data providers covering stocks, forex, crypto, and indices -- with free data sources available out of the box. The Data Management Center provides a unified interface for downloading, caching, and managing market data from all providers, storing everything locally as Parquet files for fast, zero-copy access by the backtest engine.

No account or API key is required for free data providers. Download historical data for YFinance stocks or Dukascopy forex pairs, and start backtesting immediately.

## Key Highlights

- **Six Data Providers** -- YFinance, Dukascopy, ClickHouse, Alpaca, CCXT, and BaoStock covering stocks, forex, crypto, ETFs, indices, and Chinese A-shares.
- **Free Data Out of the Box** -- YFinance and Dukascopy require no authentication. Download stock and forex data immediately after installation.
- **Parquet Caching** -- All downloaded data is cached locally as Parquet files (Apache Arrow format) for fast subsequent access and zero-copy loading by the C++ Executor.
- **Data Management Center** -- Centralized UI for cache statistics, download queue management, and data directory browsing.
- **Concurrent Downloads** -- Download queue supports up to 3 concurrent downloads with progress tracking.

## How It Works

1. **Select a Data Provider** -- Choose from the available providers based on your asset class and data needs.
2. **Search for Symbols** -- Use the symbol search to find the instrument you want (e.g., AAPL, EUR/USD, BTC/USDT).
3. **Configure Download** -- Set the date range and timeframe (1m, 5m, 15m, 1h, 1d, etc.).
4. **Download** -- The data provider fetches historical OHLCV data and caches it locally as a Parquet file.
5. **Use in Backtests** -- Select the downloaded data when configuring a backtest. The C++ Executor loads it directly via zero-copy Apache Arrow.

### Data Provider Comparison

| Provider | Asset Types | Auth Required | Mode | Best For |
|----------|------------|---------------|------|----------|
| **YFinance** | Stocks, ETFs, Indices | No | Native | US equities, free daily data |
| **Dukascopy** | Forex | No | Native | Forex pairs, tick-level history |
| **ClickHouse** | Forex, Stocks, Crypto | Yes (Pro) | Native | High-quality cloud data, all asset classes |
| **Alpaca** | Stocks, Crypto | Yes | Aggregate | US market data with paper trading |
| **CCXT** | Crypto | No | Varies | Multi-exchange crypto data |
| **BaoStock** | Chinese A-Shares | No | Varies | Chinese stock market |

### Data Management Center

The Data Management Center provides:
- **Cache Statistics** -- See total cached data size, number of cached symbols, and last update timestamps
- **Download Queue** -- Monitor active downloads, queue position, and progress (max 3 concurrent)
- **Data Directory** -- Browse cached Parquet files by provider, symbol, and timeframe
- **Cache Cleanup** -- Remove outdated or unused cached data to free disk space

## Screenshots

<!-- SCREENSHOT: Data Management Center showing cache statistics and download queue -->
<!-- FILE: images/blog/multi-source-market-data-providers/01.png -->

<!-- SCREENSHOT: Symbol search with provider selector and timeframe configuration -->
<!-- FILE: images/blog/multi-source-market-data-providers/02.png -->

<!-- SCREENSHOT: Data directory browser showing cached Parquet files organized by provider -->
<!-- FILE: images/blog/multi-source-market-data-providers/03.png -->

## Why This Matters

Market data is the foundation of any backtesting workflow, yet accessing quality historical data remains one of the biggest friction points for retail quant traders. Many platforms either require paid subscriptions for any data access, or provide limited free data with restrictive API rate limits.

StratCraft removes this barrier by including two free data providers that cover the most common asset classes: YFinance for stocks and ETFs, Dukascopy for forex. Both support direct timeframe fetching (native mode) without intermediate aggregation, providing clean data at the resolution you request.

The Parquet caching system means you only download data once. Subsequent backtests on the same symbol and timeframe load instantly from the local cache. The Apache Arrow format enables zero-copy data access by the C++ Executor, eliminating the parsing and memory allocation overhead of traditional CSV-based data loading.

## Getting Started

- **Free Data**: YFinance and Dukascopy available immediately -- no account needed
- **Navigate**: Nexus Hub > Data Management
- **Pro Data**: ClickHouse cloud data requires Pro plan and OAuth authentication
- **GitHub**: [github.com/StratCraftsAI/StratCraft](https://github.com/StratCraftsAI/StratCraft)

## Technical Details

All data providers implement the `IDataProvider` unified interface, outputting standardized `OHLCVRow[]` arrays. Providers operate in two modes: native mode (direct timeframe fetch -- ClickHouse, YFinance, Dukascopy) and aggregate mode (fetch base interval then locally aggregate -- Alpaca with 1-minute base). Dukascopy uses `dukascopy-node` with configurable `batchSize` for concurrent CDN artifact downloads. ClickHouse credentials are obtained on-demand through the Desktop API Tunnel (`desktop-api.silvonastream.com`) with automatic credential refresh. Downloaded data is stored as Parquet files with Apache Arrow for zero-copy NumPy access in the C++ Executor.
