# DATA_004: User-Provided Data Import (BYOD)

**Status**: Shipped ( + a, 2026-05-31)
**Priority**: High
**Parent**:  (Data Source Distribution Strategy)
**Decision**:  (CN A-Share -- User-Provided Import Decision)

## Goal

Let a user bring their own historical OHLCV data (BYOD) and back-test against it,
without StratCraft bundling, reselling, or standing behind any third-party
dataset. This is the **supported route for CN A-share minute-level history** --
the capability gap left by `baostock` (no sub-5-minute bars, no tick data).

It is **not** an `IDataProvider`. The other DATA_00x sources (Alpaca, Dukascopy,
CCXT, yfinance, baostock) are *live pulls* re-queried on every backtest. A BYOD
package is *already-landed local history* read once into the Parquet cache and
thereafter authoritative -- a distinct kind of source (the local-first / data-lake
"on-disk catalog" model), not a remote feed.

## What the user does

1. **Data Management -> Import tab.** Point the importer at a database the user
   already has (the  800 GB CN A-share MySQL dump is the canonical
   case), choose the source dialect, **name the package**, and **declare the
   adjustment mode**.
2. The app reads it once, normalizes to the canonical six-field `OHLCVRow`, and
   writes package-namespaced Parquet files into the existing cache. Progress is
   per-symbol; the import is cancellable; re-running is idempotent.
3. **Alpha Factory / backtest picker -> the named package appears as its own
   "Imported" data source.** Pick it, search a symbol, dates autofill from the
   cache, run a backtest. The source database can be disconnected afterwards --
   backtests read the cache, never the original dump.

## Supported input (first build)

| Axis | Supported | Notes |
|---|---|---|
| Container | SQL database | MySQL, SQLite, PostgreSQL (DuckDB `ATTACH`, `READ_ONLY`) |
| Data package | Directory of Parquet/CSV files, or single `.duckdb` file |  -- shipped 2026-06-06 |
| Output | `{symbol}_{interval}.parquet` | Existing canonical cache; six-field `OHLCVRow` (813) |
| Intervals | `1m / 5m / 15m / 30m / 1h / 1d` |  `dat_*mins` / `dat_day`; `dat_10mins` dropped (no canonical `10m`) |
| Adjustment | `none / qfq / hfq` | **Declared once per package** (see below); never inferred, never per-row |

The importer ships pre-wired for the verified  package shape
(`code` / `trade_time` / `open` / `high` / `low` / `close` / `vol`; `amount`
dropped -- no canonical home). A generic user-driven column-mapping UI is
**explicitly out of first scope** (the over-design  defers).

## Adjustment (fuquan) is package-level -- declared, never guessed

The canonical six-field `OHLCVRow` has **no `adjust` field**, and that is
deliberate ( Gate 1: confirmed against the  golden-Parquet
contract -- no schema change). Adjustment is the single most dangerous A-share
field: mixing raw (`none`) and adjusted (`qfq`/`hfq`) prices silently corrupts
return series.

The resolution: a dump is imported under **exactly one** adjustment mode, and the
user **declares it at import time**. The mode lives on the package's catalog row
(`imported_packages.adjust_mode`), not on any price row. The import **fails fast**
if no valid mode is declared -- A-share prices are never written without one.

- **none** (bu fuquan): raw traded prices; corporate actions leave gaps. Not valid
  for cumulative-return series.
- **qfq** (qian fuquan): forward-adjusted; good for charting, **not append-stable**.
- **hfq** (hou fuquan): backward-adjusted, append-stable -- the standard choice for
  backtesting cumulative returns.

## Named packages -- each import is its own source

Every imported package is a **distinct named data source**, not merged into one
anonymous "local" pool. This is the data-lake / catalog norm and is load-bearing,
not cosmetic:

- **No symbol collision.** A-share codes like `600000` recur across packages; the
  package name disambiguates, so a backtest is reproducible.
- **Adjustment has a home** -- the per-package catalog row.
- **Operability** -- delete / re-import / provenance are per-package.

The package name is what the user types at import (default auto-filled from the
file/database name). Internally it is stored in the existing
`data_cache_files.provider` column -- **no new column for it**; the only new table
is `imported_packages` (the catalog: name, adjust mode, source dialect, created
time).

## How it is wired (ground truth)

A one-time ingest path collapsed onto **DuckDB** (`@duckdb/node-api`, pinned
`1.5.2-r.2`, CVE-2025-59037-safe), embedded in the Electron main process. One
`ATTACH (READ_ONLY)` + one `COPY (SELECT ...) TO '*.parquet'` per `(symbol,
interval)` does read + normalize (epoch-seconds UTC via
`timezone('Asia/Shanghai', ...)`) + streamed, out-of-core Parquet write -- the
800 GB import never materializes in RAM, and the user's dump is never mutated.

- **Import:** `data:importPackage({ taskId, request })` IPC handler ->
  `DataImportService.importPackage` (DuckDB) -> `registerImport` (catalog rows in
  one transaction). Cancellable via `data:cancelImport(taskId)`; per-series
  progress streamed on `data:importProgress`; errors surface to the UI, never log-only.
- **Registration is load-bearing.** Every COPY-produced file also gets a
  `data_cache_files` row (`provider` = package name) plus the one
  `imported_packages` row. A file on disk without a registry row is invisible to
  both the inventory and the picker.
- **Selection:** the picker lists imported packages from `data:listImportedPackages`
  as a `kind:'imported'` source group (distinct from `getProviderList`); the
  symbol typeahead reads `data:listSegments` filtered by `provider = packageName`.
- **Run path:** `data:ensure` and `data:ensureMultiTimeframe` fork at the IPC
  boundary -- an imported source is detected by its `imported_packages` catalog row
  and served directly from the registered cache file. It **never** enters the
  download queue or calls `getProvider(packageName)` (which throws for a
  non-provider id). Requesting an interval the package did not import fails fast.

This is **Option 1 / model B** from  -- a distinct source *kind* -- not
the rejected fake "cache-only provider" shim ( no-shim rule).

## Data Package Import -- Directory and DuckDB File

 extends the original SQL-based import with a second path for
pre-prepared data packages. The Import tab exposes two buttons:

### Select Directory

Pick a folder containing `.parquet`, `.csv`, or `.duckdb` files. The system
auto-detects the source dialect from file extensions and infers symbols /
intervals from filenames (pattern `{SYMBOL}_{INTERVAL}.parquet`). A
`manifest.json` in the directory can override inference.

**When to use**: ETL pipeline output, bulk export scripts, our own
`export_tick_to_parquet.py` forex conversion output.

**Example**: `/path/to/parquet-data/` containing forex pair subdirectories,
each with interval Parquet files such as 1m through 1d.

### Select DuckDB File

Pick a single `.duckdb` database file. The system opens it read-only via
`ATTACH`, discovers all tables/views, and exports each to Parquet via
`COPY ... TO ... (FORMAT parquet, COMPRESSION zstd)`.

**When to use**: A colleague or data vendor hands you a self-contained `.duckdb`
database (analogous to receiving a `.sqlite` file). One file, many tables
inside.

### DuckDB is the engine, not the format

In both paths, DuckDB is the **conversion engine** running in-process. It reads
the source (Parquet files, CSV files, or `.duckdb` tables) and writes
normalized Parquet into the StratCraft cache. The canonical cache format is
always Parquet -- no `.duckdb` file is kept after import.

| | Select Directory | Select DuckDB File |
|---|---|---|
| Input | Folder of files | Single `.duckdb` file |
| Typical source | ETL output, scripts | Packaged handoff, vendor |
| DuckDB role | Read parquet/csv, write to cache | `ATTACH` + `COPY` tables to cache |
| Output | Parquet cache (same) | Parquet cache (same) |

## What StratCraft does NOT do

- Does **not** bundle, resell, or co-distribute any third-party dataset (the
   800 GB package included).
- Does **not** stand behind the correctness, adjustment mode, or completeness of
  user-imported data. The legal, licensing, and quality responsibility stays with
  whoever sourced the data.
- Does **not** model the package as a resident `IDataProvider` re-queried on every
  backtest. It is a one-time ingest into the existing cache.

## Related Documents

- CN A-Share -- User-Provided Import Decision (root-cause decision)
- CN A-Share 800 GB MySQL Package -- Source Investigation
- Data Source Distribution Strategy (parent)
- Multi-Source Data Provider Interface (`IDataProvider`) -- the
  contract this path deliberately does *not* implement
-  / canonical six-field Parquet OHLCV schema (epoch seconds)
- Open Core Service Model (BYOK/BYOD, app works without a server)
- DATA_001 / DATA_002 / DATA_003: the live `IDataProvider` data sources (contrast)
