# CN A-Share 800G MySQL Data Package Source Investigation

**Status**: Open
**Priority**: Medium
**Category**: Data Source / Vendor Due Diligence
**Created**: 2026-05-31

## Context

A YouTube video advertises an "800G quant historical database" with:

- 15 years of complete historical data
- MySQL full database package, over 800 GB after extraction
- 1, 5, 10, 15, 30, 60 minute bars plus daily bars
- MySQL installer and tutorial included
- "open box and use" positioning

Video:

- `https://www.youtube.com/watch?v=sYlslF86rqs`
- Title observed: `800G quant historical database, open-box-and-use. #JinCeZhiSuan #quant-trading #strategy #github #open-source-project (original title in Chinese)`
- Author observed: `GuiJiLiuMa (Chinese channel name)`
- Channel ID observed: `UCILsGvKML6grwlIbQvCzVKQ`
- Published: 2026-04-21

## Initial Findings

The video description does not disclose the original licensed data source. It
only repeats the package coverage and installation claims.

The video tag / description points to `JinCeZhiSuan (Chinese: 'quant compute'), which maps to the public Gitee`, which maps to the public Gitee
project:

- `https://gitee.com/baihome/jin-ce-zhi-suan`

The public project does not include the full historical data package. Its README
indicates that complete backtest data requires contacting the maintainer.

The project's data-provider implementation supports:

- default/private API
- Tushare
- AkShare
- MySQL
- PostgreSQL

The MySQL table names match the advertised package shape:

- `dat_1mins`
- `dat_5mins`
- `dat_10mins`
- `dat_15mins`
- `dat_30mins`
- `dat_60mins`
- `dat_day`

## Probable Data Lineage

Based on the public code, the most likely lineage is:

1. Use Tushare Pro token-backed APIs as the primary source for historical A-share
   minute and daily bars.
2. Persist 1-minute bars into MySQL.
3. Generate additional timeframes through resampling / aggregation where needed.
4. Package the resulting MySQL database dump for distribution.

Supporting observations:

- `history_sync_service.py` requires `data_provider.tushare_token` and builds a
  `TushareProvider` for historical sync.
- `TushareProvider.fetch_minute_data()` calls `pro.stk_mins(..., freq='1min')`.
- `TushareProvider.fetch_daily_data()` calls `pro.daily(...)`.
- The history sync path derives non-1-minute tables by resampling the 1-minute
  frame through `Indicators.resample(...)`.
- AkShare is present, but its EastMoney minute endpoint is not a credible source
  for a 15-year full 1-minute package because its practical historical depth is
  much shorter for 1-minute data.

This is an inference from public code and observed metadata, not a confirmed
vendor statement.

## Public Contact Points

Public contact found in the Gitee project:

- Email: `[redacted-vendor-email]`
- Gitee project: `https://gitee.com/baihome/jin-ce-zhi-suan`
- Video/channel: `GuiJiLiuMa (Chinese channel name)`, YouTube channel ID `UCILsGvKML6grwlIbQvCzVKQ`

## Due Diligence Questions

Ask the maintainer/vendor:

- What is the original source for minute bars and daily bars?
- Is the package sourced from Tushare Pro, AkShare/EastMoney, exchange data,
  broker data, or another licensed vendor?
- Does the seller have explicit redistribution rights for the raw or derived
  dataset?
- What is the adjustment mode for each table: none, qfq, hfq, or mixed?
- Are 5/10/15/30/60-minute bars directly sourced or derived from 1-minute bars?
- What is the symbol universe and delisting coverage?
- What is the exact date range and latest update date?
- How are suspensions, limit-up/limit-down sessions, auction bars, and missing
  bars represented?
- Can they provide a sample dump and row-count summary per table?
- Can they provide checksums and schema versioning for the 800 GB package?

Suggested outreach text:

```text
Hello -- I would like to understand the original data source of the 800G MySQL historical-data package. Are the minute bars and daily bars sourced from Tushare, AkShare, the exchanges, brokers, or another data vendor? Are redistribution rights granted? Could you provide sample data, the field definitions, the adjustment mode (none/qfq/hfq), the update time, the per-table row count, and the checksum/verification method?
```

## Risk Assessment

Primary risk is data redistribution compliance. If the dataset is built from a
vendor API such as Tushare Pro, redistribution may require explicit permission
from the vendor and/or upstream data owner. The package should not be treated as
safe for bundling, resale, or default product distribution without written
authorization.

Technical risk is also non-trivial:

- Aggregated bars may not match official vendor bars if generated locally.
- Adjustment mode may be inconsistent across minute and daily tables.
- Delisted symbols and corporate actions may be incomplete.
- A full MySQL dump is operationally heavy and difficult to version.

## Relation To QuantNexus

This reinforces 's distribution strategy:

- Prefer connectors where users bring their own vendor credentials.
- Only distribute preloaded datasets when redistribution rights are explicit and
  documented.
- Treat third-party packaged datasets as optional user-provided data, not as a
  built-in QuantNexus default, unless legal and technical due diligence passes.

## Resolution

The classification decision is resolved in this package is
**user-provided**. StratCraft will not bundle, resell, or ship it as a built-in
default; it provides only a one-time user-provided import path (BYOD) that reads
the dump once into the existing Parquet cache and exposes it as a distinct
**named "Imported" source** -- deliberately **not** an `IDataProvider` (a static
local dataset is not a live pull; the fake "cache-only provider" shim was the
rejected option, ). The import shipped 2026-05-31 ( +
a; see **DATA_004**). As a result, the vendor outreach below is
**optional** and only required if a future decision reverses  toward
bundling or partner integration.

## Next Actions

- [ ] (Optional) Contact `[redacted-vendor-email]` with the due-diligence questions above.
- [ ] (Optional) Request sample rows and table-level row counts.
- [ ] (Optional) Verify schema and adjustment mode against public Tushare documentation.
- [ ] (Optional) Confirm whether redistribution permission exists in writing.
- [x] Decide whether this vendor/package should be listed as unsupported,
      user-provided, or potentially partner-integrated. -> **user-provided**

