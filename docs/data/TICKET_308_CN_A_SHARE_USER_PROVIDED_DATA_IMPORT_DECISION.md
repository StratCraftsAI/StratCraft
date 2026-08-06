# CN A-Share Data  --  User-Provided Import Decision

**Status**: Decided
**Priority**: Medium
**Category**: Data Source / Distribution Policy
**Created**: 2026-05-31
**Related**:  (Data Source Distribution Strategy),  (CN A-Share 800G MySQL Data Package Source Investigation),  (Multi-Source Data Provider Interface),  (Open Core Service Model)

## Decision

StratCraft will **not** concern itself with how a user obtains CN A-share
historical data, and will **not** bundle, resell, or ship any third-party
packaged dataset (including the 800 GB MySQL package investigated in )
as a built-in default.

Instead, StratCraft provides a **single user-provided data import path**. The
user brings their own data (BYOD) or their own vendor credentials (BYOK); the
app ingests whatever the user supplies. The legal, licensing, and quality
responsibility for that data stays with the user, not with StratCraft.

The  package is therefore classified as **user-provided**, not
unsupported and not partner-integrated.

## Rationale

### 1. Redistribution liability stays with the user

 (Probable Data Lineage / Risk Assessment) concludes the 800 GB
package is most likely built from Tushare Pro token-backed APIs, resampled, and
dumped to MySQL. Bundling it as a built-in default would place the second-hand
redistribution liability on StratCraft. An import-only interface keeps that
liability with whoever sourced the data.

### 2. Consistent with the Open Core / BYOK model

-  (Open Core Service Model): BYOK pass-through only; the app must work
  without a server and without us hosting anyone's data.
-  (Approach decision): prefer connectors where users bring their own
  vendor credentials; only distribute preloaded datasets when redistribution
  rights are explicit and documented.

BYOD import is the data-side counterpart to BYOK credentials. Both keep the core
open and shippable with zero proprietary data inside it.

### 3. Cleaner technical boundary

 (Risk Assessment, technical) notes the package's aggregated bars may
not match official vendor bars, adjustment mode may be inconsistent across
tables, delisting/corporate-action coverage may be incomplete, and an 800 GB
MySQL dump is operationally heavy and hard to version. An import interface has a
clear contract  --  "we run what you import"  --  and does not make StratCraft a
guarantor of third-party data quality.

## Scope: What "a single import path" means

This is an **import** path, not a live data provider. The user supplies a static
data source (e.g. the  MySQL dump); StratCraft **reads it once,
normalizes it, and writes it into the existing Parquet cache**. After import the
source can be disconnected  --  backtests read the cache, never the original dump.
It is a one-time ingest action, NOT a resident `IDataProvider` that gets queried
on every backtest.

- **One-time ingest, not per-query pull**: the 800 GB package is static history
  that never updates. Modeling it as a resident provider (re-querying it through
  the live-pull coverage machinery on every run) is the wrong shape. Import reads
  it once into Parquet and is done.
- **Output target is the existing cache**: imported rows land in the existing
  Parquet cache layer (`{symbol}_{interval}.parquet`) in canonical OHLCV form, so
  the rest of the app consumes them exactly like any cached data.

StratCraft distributes zero third-party data, and CN A-share full history is
still usable via this import.

## Market Landscape: There Is No CN A-Share Data Standard

The import interface must NOT standardize on any single source's format
(specifically NOT "akshare format"). Market research on the CN A-share quant
ecosystem establishes:

- **akshare is the de-facto *free* standard, not the overall standard.** akshare
  (~19.9k GitHub stars, MIT, no token, no registration) is the most common free
  entry point for retail/indie quant devs. But production users still lean on
  **Tushare Pro** (token + credit-gated), and the community consensus pattern is
  "Tushare wei zhu, akshare wei bei, baostock wei bu" (Tushare primary, akshare backup,
  baostock supplement). Institutions use Wind / Choice / JoinQuant / RiceQuant
  (all paid).
- **There is zero cross-source schema standardization.** Every source returns a
  different shape:

  | Source   | Column names              | Code format   | Date format  | Adjustment field            |
  |----------|---------------------------|---------------|--------------|-----------------------------|
  | akshare  | **Chinese** (date/open/close...) | `000001`      | `YYYY-MM-DD` | `adjust=""/qfq/hfq`         |
  | tushare  | English short codes       | `000001.SZ`   | `YYYYMMDD`   | `adj=None/qfq/hfq`          |
  | baostock | English lowercase         | `sh.600000`   | `YYYY-MM-DD` | numeric `adjustflag` 1/2/3  |

  Picking one library's format as canonical would lock us into that source's
  quirks (e.g. akshare's Chinese column names) while STILL requiring adapters for
  every other source  --  strictly worse than a neutral schema.

- **User-supplied data ("wu hua ba men" (all shapes and sizes)) arrives in a few physical containers.** The
  realistic distribution is: **CSV** (lowest common denominator, broker/library
  exports), **MySQL / SQLite dumps** (common self-hosted history; the 
  800 GB package is exactly this), and **Parquet** (the rising best practice,
  often paired with DuckDB). These are interchangeable *containers*; each may
  carry *any* of the source-specific logical schemas above.

## Why This Interface Is Necessary (And Why Scoped Tight)

The import interface is **necessary**, but for one specific reason  --  and that
reason also bounds how much we build.

**Necessity:** It is the logical closure of the  decision, not an
optional feature. "We don't distribute data; users bring their own" is only true
if users can actually get their data *in*. With no import path, the decision is
unfulfillable  --  a user holding the 800 GB package has nowhere to put it, and the
only alternatives collapse back to either bundling (the legal risk we rejected)
or A-share minute-level backtesting being **impossible**. That impossibility is
real today: our only CN A-share provider, `baostock`, has **no sub-5-minute bars
and no tick data**, while the entire point of the  package is
1/5/10/15/30/60-minute + 15-year history. The import path is the only way to
close that capability gap without taking on redistribution liability.

**Scope bound (YAGNI):** The concrete demand driving this is *one specific
artifact*  --  a MySQL package. Building a general "any messy format" framework
(CSV + a generic column-mapping UI + every container) for hypothetical future
inputs is over-design. The minimal sufficient build is a **SQL import pipeline**
that normalizes to the existing six-field `OHLCVRow` (plus a resolved adjustment
decision  --  see Open Question). CSV and Parquet readers are deferred until a real
user actually arrives with that container.

## Import Interface Design

A one-time import pipeline, NOT an `IDataProvider`. The contract is an import
action: `importFromSql(connection, options) -> rows written to Parquet cache`.
It runs once per dataset; it is not invoked per backtest.

The canonical output shape is the **existing** `OHLCVRow`
(`apps/desktop/src/main/services/parquet-cache-service.ts:29`, schema contract
 / epoch-seconds )  --  NOT a new format. It has exactly six
fields:

```
OHLCVRow (existing canonical  --  parquet-cache-service.ts:29):
  timestamp : EpochSeconds   // branded epoch seconds, unit locked at type level
  open      : number
  high      : number
  low       : number
  close     : number
  volume    : number
```

Note: `symbol` is not a row field  --  it is carried in the cache file name
(`{symbol}_{interval}.parquet`). There is **no `amount` and no `adjust`** field;
adjustment handling is an open question (see below), not a settled part of the
canonical row.

The pipeline has three stages, run once:

1. **Read (first build: SQL only).** Connect to the user's MySQL / SQLite /
   PostgreSQL dump and read the  `dat_*mins` / `dat_day` tables.
   CSV and Parquet readers are **deferred** (see Scope) and added only on real
   demand.
2. **Normalize.** Map the `dat_*` columns onto the six-field `OHLCVRow` above
   (date -> `timestamp` as epoch seconds; OHLCV -> OHLCV). A generic user-driven
   column-mapping UI is **explicitly out of first scope**  --  that is the
   over-design we are deferring; revisit only for a non-package, unknown-schema
   import.
3. **Write.** Land canonical rows as Parquet files in the existing cache
   directory under the `{symbol}_{interval}.parquet` naming so the rest of the
   app consumes them like any cached data. With the DuckDB stack (below) the file
   is written by DuckDB's `COPY ... TO` itself, not by
   `ParquetCacheService.atomicWriteParquet`; the cache contract that matters is
   the path/naming and the  Parquet schema, which the `COPY` target
   must match.

After step 3 the source connection is no longer needed; backtests read the cache.
No new persistence subsystem, and no resident provider in the live-pull path.

## Implementation Stack: DuckDB

The three stages above are **not** hand-written as a row-by-row JS pipeline. They
collapse into DuckDB, embedded in the Electron main process via
**`@duckdb/node-api`**. DuckDB `ATTACH`es the user's database and a single
`COPY (SELECT ...) TO '*.parquet'` does read + normalize + streamed,
out-of-core Parquet write in one statement:

```sql
ATTACH 'host=... database=...' AS src (TYPE mysql, READ_ONLY);
COPY (SELECT epoch(date) AS timestamp, open, high, low, close, volume
      FROM src.dat_1mins)
  TO '<cacheDir>/<symbol>_1m.parquet' (FORMAT parquet, COMPRESSION zstd);
```

Rationale and why DuckDB over the pure-JS alternatives:

- **It replaces ~90% of the bespoke plumbing.** One `ATTACH` + one `COPY` per
  table covers the SQL driver, cursor batching, the column rename / epoch-seconds
  conversion (done in SQL via `epoch(date)` / aliases), and the Parquet writer.
  There is **no JS Parquet writer in this path**  --  DuckDB writes the file.
- **Out-of-core by design.** DuckDB streams source rows and flushes Parquet row
  groups incrementally (spilling to a temp dir if needed), so the 800 GB import
  never materializes in RAM. `ROW_GROUP_SIZE` / `PARTITION_BY` cap per-file size.
- **`READ_ONLY` attach** guarantees the user's dump is never mutated.
- **One code path for all three dialects**  --  the same `ATTACH ... (TYPE mysql |
  sqlite | postgres)` form covers MySQL (first build), SQLite, and PostgreSQL via
  DuckDB's `mysql` / `sqlite` / `postgres` core extensions.
- **No OHLCV ETL library exists in JS/TS** to package this (the JS financial-data
  ecosystem is acquisition-from-API only), so the DB->canonical->Parquet mapping
  would otherwise be entirely DIY. DuckDB's `COPY (SELECT ...)` is what removes
  the DIY.

Pure-JS fallback (only if a native DuckDB addon in Electron proves unacceptable):
`knex.stream()` across the three drivers -> existing `@dsnp/parquetjs`. More code,
manual backpressure/type-coercion; not the chosen path.

### DuckDB operational constraints (must honor)

- **Package**: use **`@duckdb/node-api`** (the "Neo" client). The legacy `duckdb`
  / `duckdb-async` packages are **deprecated**  --  do not use them.
- **Security pin** (CVE-2025-59037): malicious `@duckdb/node-api@1.3.3` (and
  sibling packages) were briefly published in Sept 2025. Pin an exact known-clean
  version (`>= 1.3.4-alpha.27`; current `1.5.2`) and rely on the lockfile +
  integrity hashes.
- **Electron ABI rebuild**: DuckDB is a native addon and must be ABI-matched to
  Electron, exactly like `better-sqlite3` in this project (`@electron/rebuild`).
  Wire the rebuild into `start.sh` ( build-consistency).

## Open Question: Adjustment (fuquan) Has No Home In The Canonical Schema

**Unresolved  --  must be decided before  ships.** The existing
six-field `OHLCVRow` has **no place to record adjustment mode**, yet adjustment
is the single most dangerous A-share import field:

- **none (bu fuquan)**  --  raw traded prices; corporate actions leave discontinuous
  gaps. Not valid for return series.
- **qfq (qian fuquan)**  --  anchors the current price, rescales history; good for
  charting but **not append-stable** (every new dividend rescales the whole
  history, so a stored qfq series goes stale).
- **hfq (hou fuquan)**  --  anchors the earliest price, append-only stable; the standard
  choice for backtesting cumulative returns.

All three major sources **default to unadjusted** but encode the mode differently
(keyword vs numeric; baostock's `1=hfq / 2=qfq` is the reverse of the letter
order), and a user's pre-exported file may already be qfq/hfq with **no in-band
marker**. If adjustment is silently assumed, raw and adjusted prices get mixed and
return calculations are corrupted.

**Direction (resolved by the named-package model):** adjustment is a
**package-level property**  --  a dump is imported under exactly one mode. So it is
declared once at import time and stored on the package (the `data_cache_files`
rows for that package / its catalog entry), NOT inferred and NOT pushed into the
per-row `OHLCVRow`. This keeps the  row schema untouched. Mixing modes
within one package is refused at import.

What remains to confirm with the  contract owner is only the *minor*
storage detail  --  whether the per-row schema ever needs an `adjust` column, or
whether package-level metadata is sufficient (expected: sufficient; no `OHLCVRow`
change).  must still not write A-share prices until the package
captures a declared mode, or it risks the silent-corruption failure above.

## Gap: Imported Cache Data Is Not Selectable In `DataConfigPanel`

**Landing data in the Parquet cache is necessary but NOT sufficient.** Code
ground-truth shows the import is only half the job  --  the imported symbol still
cannot be picked or backtested through the existing UI:

- The  `DataConfigPanel` symbol picker is fed **exclusively** by live
  provider queries: `DataConfigPanel.tsx:217` ->
  `window.electronAPI.data.searchSymbols(q, dataSource)` ->
  `data-handlers.ts:422` -> `provider.searchSymbols(...)`. It never reads the
  Parquet cache. A symbol that exists only as a `{symbol}_{interval}.parquet`
  file (no live provider returning it) will **never appear** in the typeahead.
- Even bypassing the picker, the run path `data:ensure` -> `doEnsureData`
  (`data-cache-manager.ts:592`) is provider-keyed: on cache miss it calls
  `fullDownload(...provider...)` rather than treating the standalone Parquet file
  as the source of truth.
- A cache-inventory facility **already exists** but `DataConfigPanel` does not use
  it: `data:listSegments` / `listFiles` (`data-cache-manager.ts:416`) and
  `data:getCacheStats` enumerate the `data_cache_files` table; they are consumed
  only by the Data Management feature.

### Design (per common practice): cache inventory is a first-class data source

In local-first / data-lake practice (DuckDB, Parquet lakes), an **already-landed
local dataset** is a distinct kind of source from a **live remote feed**, and the
UI reads from the *inventory of what is on disk*, not by asking a remote provider
"can you fetch this?". The right fix follows that split:

- **Chosen  --  Option 1: make the cache inventory a selectable source, one entry
  per imported package.** Add an "Imported / Local" data-source mode whose symbol
  picker is fed by the existing `data:listSegments` / `listFiles` inventory
  (already returns `{symbol, interval, provider, startDate, endDate, rowCount}`),
  and let the run path treat a present cache file as authoritative for that mode
  (no provider fetch/extension). **Each imported package is a distinct named
  source** (see "Named packages" below), not one merged "local" blob  --  the picker
  groups/filters by package. New wiring is (a) a picker source toggle that lists
  packages, (b) per-package symbol filtering off the inventory, and (c) a
  cache-authoritative branch in `doEnsureData`. It is the root-cause fix and
  matches how local-first / data-lake tools expose on-disk datasets via a catalog.

- **Rejected  --  Option 2: a fake "cache-only provider"** implementing
  `searchSymbols`/`queryOHLCV` over `data_cache_files`/Parquet so nothing
  downstream changes. This reuses all current wiring but **misuses the
  `IDataProvider` abstraction**  --  that interface models on-demand remote
  *pulling*, and a static local dataset is not a pull. It is a bridge/shim that
  encodes the gap inside a provider impl rather than fixing the selection axis,
  which this project explicitly rejects ( / no-shim rule). Listed only
  to record why it was not taken.

### Named packages (each import is a distinct catalog entry)

An import is a *package* (the  dump alone is thousands of symbols x 7
intervals), and **each imported package is modeled as its own named data source**,
not merged into one anonymous "local" pool. This is the data-lake/catalog norm
(DuckDB / Iceberg / Hive metastore all namespace landed datasets by
catalog+version) and is chosen for concrete reasons, not preference:

- **Correctness  --  no symbol collision.** A-share codes like `600000` recur across
  packages. A merged pool can't tell which package a hit came from, so a backtest
  is not reproducible (same code, different source/adjustment => different
  returns). Naming each package eliminates the collision.
- **Adjustment has a home.** Adjustment mode (qfq/hfq/none) is a *package-level*
  property  --  a dump is imported under one mode. A named package is where that
  mode lives (resolving half of the Open Question below); a merged pool has no
  entity to attach it to.
- **Operability.** Delete / re-import / overwrite / provenance ("where did this
  dataset come from") all become per-package operations.
- **Near-zero cost.** `data_cache_files` already has a `provider` field; B reuses
  it to hold the **user-supplied package name**  --  no new table or schema. Not
  over-design.

The only added step versus a merged pool: the import asks the user to **name the
package** (default auto-filled from the file/database name, editable). That step
is what buys collision-freedom, an adjustment home, and provenance  --  it is worth
it, and it matches the user's own mental model ("I'm importing *this* dataset").

**Storage requirement (load-bearing):** `ParquetCacheService` has no symbol-listing
capability; the enumerable inventory lives entirely in the `data_cache_files`
table. Therefore the DuckDB import MUST, for every `COPY`-produced
file, also insert a `data_cache_files` row with `provider` = the package name. A
file on disk without a registry row is invisible to both the inventory and the
picker  --  registration is not optional.

This gap and Option 1 are owned by a sibling ticket (**a** below) and
must ship alongside the import for imported data to be usable end-to-end.

## Non-Goals

- Not bundling the  dataset (or any equivalent) as a default install.
- Not reselling or co-distributing any third-party packaged dataset.
- Not standing behind the correctness, adjustment mode, or completeness of
  user-imported data.
- Not building a CN-specific import subsystem separate from `IDataProvider`.

## Impact On 

's vendor due-diligence Next Actions are **downgraded to optional**.
Because StratCraft will not redistribute the package, the urgency of contacting
`[redacted-vendor-email]` and confirming written redistribution rights drops
substantially. Due diligence is only required if a future decision reverses this
ticket and proposes partner integration or bundling.

## Current Code State

Ground-truth from the codebase (so the Next Actions below are accurate):

- **No file/DB import path exists today.** Every current provider
  (`yfinance`, `dukascopy`, `alpaca`, `ccxt`, `baostock`, `clickhouse` under
  `apps/desktop/src/main/services/data-providers/`) is a **live pull** (REST /
  npm lib / local Python lib / ClickHouse cloud). The Parquet cache layer is a
  **write-only output** of those pulls, never an import sink. The import pipeline
  in this design is **net-new**  --  it writes into that same Parquet cache, but as
  a one-time ingest, not as a provider in the live-pull path.
- **akshare / tushare are NOT in the codebase.** They appear only in 's
  investigation notes (describing the external Gitee project). StratCraft's
  actual CN A-share provider is **`baostock`** (`baostock-provider.ts`).
- The `IDataProvider` interface (`data-providers/types.ts`) and
  `ParquetCacheService` (`parquet-cache-service.ts`, epoch-seconds schema per
  813) already exist and are the layers this design extends.

## Implementation Plan

All anchors below are verified against HEAD. The plan is two sibling tickets
(308_1 import, 308_1a selection) plus one blocker confirmation.

### Pre-work P0  --  dependency + blocker

- **Add `@duckdb/node-api`** (NOT the deprecated `duckdb`/`duckdb-async`), pinned
  to a known-clean version (`>= 1.3.4-alpha.27`; CVE-2025-59037). No duckdb
  package exists in any `package.json` today  --  net-new dependency.
- **ABI rebuild**: DuckDB is a native addon; add an `@electron/rebuild` step to
  `start.sh` alongside the existing `better-sqlite3` rebuild.
- **Blocker confirmation**: adjustment is package-level only  --  confirm with the
   owner that no `OHLCVRow`/Parquet-schema change is needed (expected).

###   --  DuckDB SQL import (main process)

1. **New IPC handler `data:importPackage`** in `data-handlers.ts` (slots in beside
   the existing `data:*` handlers, `ipcMain.handle` convention), with a preload
   binding `importPackage` in `preload/index.ts` (follow the `enqueueDownload`
   pattern at `:247`). Config carries `{ connection, dialect, packageName,
   adjustMode, tableMap }`.
2. **Importer service** (e.g. `data-import-service.ts`): open `@duckdb/node-api`,
   `ATTACH '<conn>' AS src (TYPE mysql|sqlite|postgres, READ_ONLY)`, then per
   `(symbol, interval)` run `COPY (SELECT epoch(date) AS timestamp, open, high,
   low, close, volume FROM src.<table> WHERE ...) TO '<stablePath>' (FORMAT
   parquet, COMPRESSION zstd)`. Target path = `cacheService.getStablePath(symbol,
   interval, packageName)` so the file lands under the package-namespaced dir and
   matches the existing `{symbol}_{interval}.parquet` naming.
3. **Register each file** via `dataCacheManager.upsertMetadata(record)`
   (`data-cache-manager.ts:1131`, INSERT...ON CONFLICT on the UNIQUE
   `(symbol, interval, provider)` triple). Set `provider = packageName`,
   `source_type='base'`, and `first/last_timestamp`, `row_count` from a
   `SELECT min/max(timestamp), count(*)` over the written data. The `provider`
   column is unconstrained `TEXT NOT NULL` (`migration-manager.ts:803`)  --  it
   accepts the package name with no schema change. **Registration is the
   load-bearing step: an unregistered file is invisible to inventory and picker.**
4. **Adjustment + package metadata**: store the declared `adjustMode` and package
   provenance. `data_cache_files` has no column for it, so this needs a small
   **`imported_packages` table** (name, adjust_mode, source dialect, created_at)
   keyed by `packageName`  --  the catalog entry. (This is the only new table; it is
   the home for the package-level adjustment decided above.)
5. **Progress / cancel / resume**: a package is thousands of `COPY`s  --  emit
   per-table progress, make it cancellable, and skip already-registered
   `(symbol,interval,packageName)` rows on re-run (idempotent via the UNIQUE
   triple). Errors must surface to the UI, not log-only.

### a  --  make imported packages selectable (the harder half)

Code ground-truth exposes a **provider-abstraction tension** that must be solved
deliberately, not shimmed:

- The picker's source list comes from `data:getProviderList`
  (`AlphaFactoryPage.tsx:174` -> `DataConfigPanel` `dataSources` prop), and the
  run path resolves the selected id via `DataProviderManager.getProvider(id)`,
  which **throws for an unknown id** (`provider-manager.ts:36`,
  invoked in the queue worker `data-download-queue.ts:508`). So simply putting a
  package name into the source dropdown would **throw at run time**  --  the live
  pull chain hard-assumes every source id is a registered provider.

The root-cause resolution (still Option 1 / model B, NOT the rejected fake
provider): make "imported package" a **distinct source kind**, not a fake entry
in the provider list.

1. **Source list**: extend the picker's source feed so imported packages appear
   as their own group, sourced from `imported_packages` / `listFiles` (distinct
   from `getProviderList`). Each package = one selectable source labelled by name.
2. **Symbol typeahead**: when the selected source is an imported package, the
   typeahead reads `data:listSegments` filtered by `provider = packageName`
   (`listFiles` filters on exact `provider`, `data-cache-manager.ts:428`) instead
   of `data:searchSymbols`. Dates autofill from the segment's
   `first/last_timestamp` (no `getSymbolDateRange` provider call).
3. **Run path  --  cache-authoritative branch, forked at the IPC boundary.** An
   imported source is read-from-disk, never downloaded, so it must NOT enter the
   download machinery at all. The fork lives at the `data:ensure` IPC handler
   (`data-handlers.ts:142`)  --  the abstraction boundary where the provider-id
   string is resolved and the job is handed to the queue. Before the enqueue:
   detect an imported-package source and route to a new direct read path that
   reads the registered `data_cache_files` row and returns
   `{filePath,rowCount,first/last_timestamp}`  --  the same shape `doEnsureData`
   returns on cache-hit (`data-cache-manager.ts:681-688`)  --  without ever calling
   `getProvider(packageName)` (which throws, `provider-manager.ts:36`),
   `fullDownload` (`:638`), or `fetchRange` (`:701/:712`). The interval-validity
   check that `resolveFetchPlan` would do is replaced by the presence of the
   registered `(symbol,interval,packageName)` row (it only exists if that interval
   was imported).
4. **Reuse the Data Management UI** (`features/data-management/DataManagementPage.tsx`,
   `useDataCatalog`) as the natural host for the import button and the
   imported-package list (it already renders `listSegments`/`getCacheStats`).

**Decision (resolved  --  fork at the IPC boundary, not the queue worker).** The
imported-vs-provider fork goes at the `data:ensure` IPC handler
(`data-handlers.ts:142`), before the job is enqueued  --  NOT inside the queue worker
(`data-download-queue.ts:508`, before `getProvider`). Root-cause rationale:

- **Single responsibility.** `DataDownloadQueue` exists to *download from a remote
  provider*  --  its table is `download_queue`, its states are `downloading`/`yielded`,
  its worker calls `getProvider().queryOHLCV()`. An imported package is
  already-landed local data that is never downloaded. Forking inside the worker
  would force a download component to understand "some jobs don't download"  -- 
  exactly the kind of concept-bleed / shim this project rejects.
- **No noise through the wrong path.** Forking at the worker still drags imported
  reads through enqueue, request-coalescing, and persistence to the
  `download_queue` table  --  all meaningless for a disk read.
- **Fork at the boundary that owns the distinction.** `data-handlers.ts:142` is
  where a source id first becomes a download intent; diverting there keeps the
  queue purely provider-only (zero changes to it) and gives imported data its own
  semantically-correct read path. This is the most-direct-layer fix, not a bridge bolted onto a downstream component.

### Phased Execution Sequence

Ordered so every phase has an independent verification point  --  no big-bang
integration. Gates first, backend before UI, the error-prone fork validated via
IPC before the UI glue.

**Phase 1  --  Gates (blockers; stop if either fails).  --  DONE 2026-05-31, all gates PASS.**
- Confirm with the  owner that adjustment is package-level only (no
  `OHLCVRow` / Parquet-schema change). If it unexpectedly needs a schema change,
  308_1's write shape changes  --  resolve before coding.
- Add `@duckdb/node-api` (pinned, clean version) and wire the `@electron/rebuild`
  step into `start.sh` next to `better-sqlite3`.
- *Verify*: `@duckdb/node-api` loads in the Electron main process and runs
  `SELECT 1`.

> **Phase 1 resolution (verified against HEAD, root-cause derivation  --  no
> questions asked):**
>
> 1. **Gate 1  --  adjustment is package-level only: PASS, no schema change.**
>    Resolved from code, not by asking the contract owner. The  contract
>    is the six-field Parquet schema with exactly two sources of truth  -- 
>    `OHLCV_SCHEMA` (`ohlcv-parquet-schema.ts:25`: `timestamp/open/high/low/close/
>    volume`, INT64 + 5xDOUBLE) and `OHLCVRow` (`parquet-cache-service.ts:29`).
>    Neither has `adjust` or `amount`. The schema is locked by a golden-fixture CI
>    gate (`regen-ohlcv-golden-parquet.ts --check`) and consumed by Python readers
>    (`nona_algorithm.io.load_ohlcv`). Adding an `adjust` column would break the
>    golden gate, ripple into every Python reader, and be redundant  --  a package is
>    imported under exactly one mode, so package-level metadata (the
>    `imported_packages` table, Phase 2) is the strictly-correct altitude. **Zero
>    `OHLCVRow` / Parquet-schema change. The Open Question's "minor storage detail"
>    resolves to: package-level is sufficient.**
>
> 2. **Gate 2  --  `@duckdb/node-api` added, pinned, security-clean.** Pinned exact
>    `1.5.2-r.2` in `apps/desktop/package.json` (no `^`). Note the versioning
>    scheme changed since this ticket was drafted: the registry now uses `-r.N`
>    release tags (`latest` = `1.5.3-r.2`), not the `-alpha.N` scheme the P0 note
>    referenced. `1.5.2-r.2` is one minor below latest (conservative), far past the
>    CVE-2025-59037 malicious `1.3.3`. Repo uses **pnpm@9** (`pnpm-lock.yaml` is
>    live; root `package-lock.json` is stale from April)  --  the lockfile +
>    `integrity sha512-...` hash provides the supply-chain pin the security note
>    requires.
>
> 3. **Gate 3  --  ABI rebuild: the "wire into `start.sh`" premise was wrong; the
>    correct mechanism already exists.** Ground truth: `better-sqlite3` is NOT
>    rebuilt in `start.sh`  --  it is rebuilt by the `postinstall` hook
>    (`apps/desktop/package.json:40`: `npx @electron/rebuild -m .`), which rebuilds
>    *all* native addons in the package. So adding DuckDB as a dependency makes its
>    ABI rebuild automatic; **no `start.sh` edit is needed** (adding one would be a
>    redundant, second rebuild path  --  rejected per no-unrelated-changes). Further,
>    DuckDB's `@duckdb/node-bindings` ships a **prebuilt `duckdb.node`** (N-API,
>    ABI-versioned and decoupled from `process.versions.modules`), so unlike the
>    node-gyp `better-sqlite3` source build it does not actually need a recompile  -- 
>    the install's `@electron/rebuild` ran clean ("Rebuild Complete") and is a
>    belt-and-braces no-op for DuckDB.
>
> 4. **Verify  --  PASS.** Loaded `@duckdb/node-api` in a real Electron main process
>    (Electron 33.4.11, Node 20.18.3, ABI modules=130) and ran
>    `SELECT 1, version()` -> returned `1`, DuckDB engine `v1.5.2`. The N-API
>    prebuilt is ABI-compatible with the Electron runtime; no native-load failure.
>
> **Files touched:** `apps/desktop/package.json` (+1 dep line), `pnpm-lock.yaml`
> (regenerated). No `start.sh`, no schema, no source code. Phase 1 is a pure
> dependency + decision gate. **Cleared to start Phase 2 (`imported_packages`
> migration).**

**Phase 2  --  `imported_packages` table.  --  DONE 2026-05-31.** New migration: the only
new table; home for package name, adjust mode, source dialect, created_at.
- *Verify*: migration runs; table exists.

> **Phase 2 resolution (root-cause derivation, verified against HEAD):**
>
> Migration **v76** added to `EMBEDDED_MIGRATIONS`
> (`migration-manager.ts`), following the v74/v75 convention exactly:
>
> ```sql
> CREATE TABLE IF NOT EXISTS imported_packages (
>   package_name    TEXT NOT NULL PRIMARY KEY,
>   adjust_mode     TEXT NOT NULL CHECK(adjust_mode IN ('none','qfq','hfq')),
>   source_dialect  TEXT NOT NULL CHECK(source_dialect IN ('mysql','sqlite','postgres')),
>   created_at      INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
> );
> ```
>
> - **`package_name` PK = the catalog join key.** It is exactly the value the
>   import writes into `data_cache_files.provider` for every COPY-produced file
>   (the registration step). Catalog row + inventory row share this string; an
>   unregistered file is invisible to the picker.
> - **`adjust_mode` CHECK-pinned to `none/qfq/hfq`.** This is the home that closes
>   the "Adjustment has no home in the canonical schema" open question  --  declared
>   once per package, never per row, so the  six-field schema is
>   untouched (Gate 1).
> - **`source_dialect` CHECK-pinned to the three DuckDB ATTACH dialects** for
>   provenance / re-import.
> - **`created_at` epoch-ms**, matching v74/v75.
>
> **No version constant to bump**  --  the migrate loop derives the target from the
> array (`MAX(version)` tracking); v76 is simply the next sequential entry. The
> only new table the import introduces; everything else reuses `data_cache_files`.
>
> **Verify  --  PASS.** Migration v76 applies cleanly; `imported_packages` appears in
> `sqlite_master`. Added 5 schema-coverage tests (PK + NOT NULL shape, both CHECK
> constraints, PK-duplicate rejection, epoch-ms `created_at` default) and the
> table to the key-tables assertion in `migration-manager.test.ts`  --  **all 6
> additions pass**. The 4 remaining failures in that suite ( column-shape
> / index,  v44-heal, rollback `toBe(54)`) are **pre-existing baseline
> drift on HEAD** (confirmed by running the suite against HEAD's migration-manager:
> 10 fail -> my 6 additions account for exactly 6, leaving the same 4), unrelated to
> this table. **Cleared to start Phase 3 (DuckDB importer service).**
>
> *(Test env: vitest runs under Node ABI; rebuilt `better-sqlite3` for Node, ran
> the suite, then restored the Electron ABI via `@electron/rebuild`  --  the standard
> dance for this repo.)*

**Phase 3  --  Importer service (DuckDB ATTACH + COPY).** `ATTACH ... (READ_ONLY)`
then per `(symbol, interval)` a `COPY (SELECT epoch(date) AS timestamp, ...) TO
getStablePath(symbol, interval, packageName)`.
- *Verify*: against a small test SQLite DB, produces correct
  `{symbol}_{interval}.parquet` files matching the six-field schema.

**Phase 4  --  Registration + metadata.  --  DONE 2026-05-31.** For each `COPY`-produced
file call `upsertMetadata` (`provider = packageName`); write the
`imported_packages` row (adjust mode / provenance).
- *Verify*: after import, `data:listSegments` / `getCacheStats` return the rows.
  **Milestone: imported data is in the cache and enumerable.**

> **Phase 4 resolution (root-cause derivation, verified against HEAD):**
>
> The Phase 3 importer produced verified Parquet files but left them invisible
> (a file on disk without a `data_cache_files` row is not enumerable by
> `listFiles`/`getCacheStats` and not selectable by the picker). Phase 4 is the
> load-bearing registration that closes that gap, split across the two layers
> that actually own the writes:
>
> 1. **`DataCacheManager` gains two public registration methods**
>    (`data-cache-manager.ts`). The catalog tables (`data_cache_files`,
>    `imported_packages`) are owned by `DataCacheManager`, which already wraps
>    every cache-catalog write and the row<->record mapping  --  so the most-direct
>    fix is to add the methods *there*, NOT to expose the private
>    `upsertMetadata` or re-implement the INSERT inside the importer:
>    - `registerImportedFile({symbol, interval, packageName, filePath,
>      first/lastTimestamp, rowCount})` -> delegates to the existing
>      `upsertMetadata` with `provider = packageName`, `sourceType='base'`,
>      `baseFileId=null` (an imported series is always a fully-materialized base
>      series, never an on-the-fly aggregate). Upserts on the existing UNIQUE
>      `(symbol,interval,provider)` triple -> re-import is idempotent.
>    - `registerImportedPackage({packageName, adjustMode, sourceDialect})` ->
>      `INSERT ... ON CONFLICT(package_name) DO UPDATE` into the v76
>      `imported_packages` table. This is where the package-level adjustment
>      decision (Gate 1) physically lands.
>
> 2. **`DataImportService.registerImport(result, req)`** (`data-import-service.ts`)
>    orchestrates the two, kept separate from `importPackage` so the DuckDB
>    read/normalize/write stays decoupled from the SQLite catalog (and each is
>    independently testable). It validates the whole series list **before**
>    opening the transaction (fail-fast on a null-timestamp series  --  a contract
>    violation, since `copySeries` only returns rows-bearing series), then runs
>    all `registerImportedFile` calls + the one `registerImportedPackage` call in
>    a **single `db.transaction(...)`** so a crash mid-registration cannot leave
>    files registered under a package that has no catalog row (orphaned
>    adjustment decision). The Phase 5 IPC handler will call `importPackage` then
>    `registerImport`.
>
> 3. **`adjustMode` enters the contract at Phase 4** (Phase 3 deliberately
>    omitted it as pure read/normalize/write). Added `IMPORT_ADJUST_MODES =
>    ['none','qfq','hfq']` + `ImportAdjustMode` to `constants/data-import.ts`
>    (mirrors the v76 CHECK), made `adjustMode` a **required** field on
>    `ImportRequest`, and `importPackage` now fail-fast rejects a missing/invalid
>    mode  --  A-share prices are never written without a declared mode,
>    closing the silent raw/adjusted-mixing risk.
>
> **Non-obvious gotcha:** the DB-manager module is `../database/db-manager`, NOT
> `database-manager` (the importer's first import path was wrong and failed the
> whole suite to load with "Does the file exist?"). `data-cache-manager.ts:20`
> already imports from `db-manager`; matched it.
>
> **Verify  --  PASS.** `data-import-service.test.ts` is **15/15 green** (10 Phase-3
> + 5 new Phase-4: per-series file registration, single catalog row carrying
> adjust mode + dialect, empty-import -> catalog-only, null-timestamp guard,
> missing/invalid adjust-mode rejection). The Phase-4 catalog writes are mocked
> at the `DataCacheManager`/`db-manager` boundary (via `vi.hoisted` spies) so the
> test stays ABI-free  --  the catalog SQL itself is covered by the
> data-cache-manager / migration-manager layers. **0 tsc errors in all changed
> files** (the 265 repo-wide tsc errors are pre-existing baseline in unrelated
> files). `migration-manager.test.ts` 86/90 pass  --  the 4 failures are the known
> pre-existing baseline drift ( x2,  v44-heal, rollback
> `toBe(54)` stale constant), unchanged by Phase 4. **Cleared to start Phase 5
> (IPC `data:importPackage` + preload + progress/cancel/idempotent-rerun).**

**Phase 5  --  IPC `data:importPackage` + preload + UX plumbing.  --  DONE 2026-05-31.**
Wire the service to a new `data:importPackage` handler (`enqueueDownload` pattern)
and preload binding; add per-table progress, cancel, and idempotent re-run (skip
existing `(symbol,interval,packageName)` via the UNIQUE triple); errors surface to
UI.
- *Verify*: a renderer-triggered import reports progress, cancels, re-runs
  idempotently. **308_1 complete.**

> **Phase 5 resolution (root-cause derivation, verified against HEAD):**
>
> Two IPC handlers in `data-handlers.ts` (where every `data:*` handler lives) plus
> three preload bindings. The import is a long-running, cancellable, per-task
> progress operation  --  the **`kronos-handlers.ts` precedent** (`activeKronosTasks =
> Map<string, AbortController>` + `kronos:cancel(taskId)`) is the exact existing
> shape for that, NOT the download queue (an import is never a download  --  the whole
> point of Phase 6 is that imported data must never enter the queue or resolve a
> provider).
>
> 1. **`data:importPackage({ taskId, request })`**  --  registers an `AbortController`
>    in a module-level `activeImportTasks` Map keyed by the **renderer-supplied
>    `taskId`** (the renderer owns its import intent; this keeps the main process
>    free of any non-deterministic `Date.now()`/`Math.random()` id generation that
>    `Math.random` rules and resume-safety discourage  --  mirrors `kronos:cancel`),
>    runs `service.importPackage(request, { signal, onProgress })` then the
>    load-bearing `service.registerImport(result, request)` in the **same handler**
>    so the import is atomic from the renderer's view (Parquet files + their
>    `data_cache_files`/`imported_packages` rows land together  --  an unregistered
>    file is invisible). Per-series `onProgress` is streamed as
>    `data:importProgress` (`phase:'importing'`), a final `phase:'complete'` event
>    carries the counts, and the Map entry is always removed in `finally`.
> 2. **`data:cancelImport(taskId)`**  --  aborts the tracked controller by id; the
>    service's existing `throwIfAborted` turns the signal into an `Import
>    cancelled.` rejection between series. Unknown/finished id -> `{cancelled:false}`.
> 3. **Error propagation**  --  on any failure the handler emits a
>    `phase:'error'` progress event (for observers) AND re-throws so the renderer's
>    `await invoke(...)` rejects (for the caller). Registration is skipped on a
>    failed import (verified by test).
> 4. **Idempotent re-run is already guaranteed by the service** (Phase 4): file rows
>    upsert on the UNIQUE `(symbol,interval,provider)` triple, the package row on its
>    PK  --  so re-running is a no-op-or-overwrite with **zero new Phase-5 code**. The
>    plan's "skip existing via the UNIQUE triple" is satisfied at the catalog layer,
>    the correct altitude, not re-implemented in the handler.
>
> **Preload (`preload/index.ts`, `data` namespace):** `importPackage(payload)`,
> `cancelImport(taskId)` (both `ipcRenderer.invoke`), and `onImportProgress(cb)`
> (subscribe to `data:importProgress`, returns an unsubscribe  --  matches
> `onDownloadQueueProgress`). `window.electronAPI` is untyped (`any`) in the
> renderer today, so there is no central interface to extend  --  renderer consumption
> is Phase 7.
>
> **Verify  --  PASS.** `data-handlers.test.ts` **77/77** (+8 new: import->register->
> return, taskId-less reject, progress streaming, error-surfaces-and-rejects, the
> abort signal that `cancelImport` triggers mid-flight, post-completion cancel
> no-op, unknown-id cancel). `preload-api-functions.test.ts` **293/293** (+3 new
> bindings). The import-service is mocked in the handler test (every other service
> is too), so DuckDB never loads  --  **no ABI dance, fast**. **0 new tsc errors**
> (repo-wide count steady at the 265 pre-existing baseline). **Cleared to start
> Phase 6 (run-path fork at the `data:ensure` IPC boundary).**

**Phase 6  --  Run-path fork (IPC-boundary cache-authoritative branch).  --  DONE
2026-05-31.** At `data:ensure` (`data-handlers.ts`), divert imported sources to a
direct `data_cache_files` read that returns the cache-hit shape, never entering
the queue or calling `getProvider`. Done before the UI because it is the
correctness core and the error-prone part (the `getProvider` throw)  --  validate it
via direct IPC calls, not through the picker.
- *Verify*: an imported package name + symbol returns cached data with the
  provider chain never touched (no throw, no download).

> **Phase 6 resolution (root-cause derivation, verified against HEAD):**
>
> **The fork discriminator** is the `imported_packages` catalog (v76), NOT a
> string-prefix or a try/catch around `getProvider`. A `provider` string is an
> imported package IFF it has an `imported_packages` row  --  live providers
> (`yfinance`, `baostock`, ...) are registered in `DataProviderManager` and never
> appear there. This is the catalog-correct, root-cause discriminator.
>
> 1. **`DataCacheManager.getImportedPackage(packageName)`** (read) added beside
>    the Phase-4 `registerImportedPackage` (write). The most-direct layer
>: `DataCacheManager` owns `imported_packages`, so the fork never
>    reaches into the DB itself. Returns an `ImportedPackageRecord` or `null`
>    (not an imported package -> fall through). New exported type
>    `ImportedPackageRecord {packageName, adjustMode, sourceDialect, createdAt}`.
>
> 2. **`resolveImportedEnsure(config)`** helper in `data-handlers.ts`, called at
>    the very top of the `data:ensure` `try`  --  **before** queue/provider
>    resolution. If `getImportedPackage(config.provider)` is null -> returns null
>    -> handler falls through to the existing queue path (zero behaviour change
>    for live providers). If it IS a package -> reads the registered
>    `getMetadata(symbol, interval, package)` row and returns the **exact
>    cache-hit shape** `{success, filePath, rowCount, first/lastTimestamp}`. The
>    queue is never enqueued, `getProvider`/`fullDownload`/`fetchRange` are never
>    called.
>
> 3. **Fail-fast (858):** if the source is an imported package but the
>    requested interval has no registered `(symbol, interval, package)` row, the
>    helper throws  --  the interval-validity check the provider path would do is
>    replaced by row presence (an interval only exists in the cache if it was
>    imported). The existing `data:ensure` catch surfaces the throw to the
>    renderer (`data:progress` `phase:'error'` + `{success:false,...}` return).
>
> **Scope:** only `data:ensure` is forked, per the plan's surgical
> boundary; `data:ensureMultiTimeframe` is the live-pull multi-timeframe path,
> not the imported-data flow the picker drives.
>
> **Verify  --  PASS.** `data-handlers.test.ts` **80/80** (+3 fork tests: cache read
> with no queue/provider touch, live-provider fall-through, interval-not-imported
> fail-fast -> error to renderer). `data-cache-manager.test.ts` **42/42** (+2
> `getImportedPackage`: null for non-package, mapped record for a package).
> Added the default `setupCacheManager()` mock (`getImportedPackage->null`) to the
> shared `beforeEach` so every live-provider `data:ensure` test still falls
> through. **0 new tsc errors** (changed source files clean; repo-wide steady at
> 265 pre-existing baseline; the 5 OHLCVRow-cast errors in
> data-cache-manager.test are pre-existing in the untouched `ensureAggregatedFile`
> blocks). Both suites are DB-mocked -> no ABI dance. **Cleared to start Phase 7
> (picker wiring, 308_1a UI).**

**Phase 7  --  Picker wiring (308_1a UI).  --  DONE 2026-05-31.** Add the "Imported"
source group to the picker feed (from `imported_packages` / `listFiles`,
distinct from `getProviderList`); typeahead reads `listSegments` filtered by
`provider = packageName`; reuse the Data Management UI to host the import button
+ package list.
- *Verify*: in `DataConfigPanel`, select an imported package -> search a symbol ->
  dates autofill -> run a backtest end-to-end. **308_1a complete; feature
  end-to-end.**

> **Phase 7 resolution (root-cause derivation, verified against HEAD):**
>
> Five renderer pieces plus two root-cause backend fixes:
>
> 1. **Data Management host.** New `ImportPanel.tsx` (the import form +
>    progress/error feedback + imported-package list) driven by a new
>    `useImportPackage.ts` hook (renderer-owned `taskId` via
>    `crypto.randomUUID()`, progress filtered to the active task, 
>    error surfacing, list refresh on completion). `DataManagementPage` gains an
>    `import` tab.
> 2. **Picker source group.** `AlphaFactoryPage` appends `listImportedPackages()`
>    rows as `kind:'imported'` data sources (status `connected`, auth-free), and
>    `DataSourceOption` gains `kind?: 'provider' | 'imported'` as the renderer
>    discriminator.
> 3. **Symbol-axis fork.** `DataConfigPanel`'s `isImportedSource` branch reads
>    `data:listSegments` (provider = package name, `symbol LIKE %q%`) instead of
>    `searchSymbols` / `getSymbolDateRange` (both throw for a non-provider id).
>    The collapse-by-symbol + date-widening transform is extracted to a pure,
>    unit-tested `collapseImportedSegments` (`importedSymbolAxis.ts`).
> 4. **i18n.** `dataManagement.import.*` + `dataManagement.tabs.import` added to
>    both `en_US` and `zh_CN`.
>
> **Two root-cause fixes (the in-flight tree was broken/incomplete):**
> - **Plugin `ElectronAPI` type drift**  --  the plugin's manually-synced ambient
>   `ElectronAPI.data` (`src/types/global.d.ts`) lacked `listSegments` +
>   `listImportedPackages` (2x TS2339). Added both, mirroring the host preload.
> - **`dataManagementTab` store union**  --   puts tab state in Zustand,
>   but the store union (`useAppStore.ts`) was still 2-wide while the page's local
>   alias was 3-wide. Widened the store union and made the page alias *derive*
>   from the store action's parameter type so they cannot drift again.
>
> **Real race bug fixed in `AlphaFactoryPage`**  --  the provider-list `.then()` did
> a wholesale `setDataSources(syncSources)` while the imported-list `.then()` did
> a functional append; the two promises race, so if `listImportedPackages` (a tiny
> local SQLite read) resolved first the provider replace would silently clobber the
> imported entries. Fixed by making the provider `.then()` preserve the
> already-present `kind:'imported'` slice (`[...syncSources, ...prev.filter(...)]`).
>
> **Phase-7-exposed gap closed  --  multi-timeframe ensure fork.** Phase 6 forked
> only `data:ensure`; the ticket scoped out `data:ensureMultiTimeframe` as
> "live-pull, not imported flow." That was wrong once Phase 7 makes imported
> packages selectable in the picker that *also* drives the multi-timeframe run
> path: an Alpha Factory workflow chip with distinct analysis/entry/exit
> timeframes routes to `ensureMultiTimeframe`, whose queue worker calls
> `getProvider(packageName)` and throws  --  the exact failure Phase 6 prevents, on
> the other branch. Per the no-refuse / fail-fast / root-cause rules, added a
> symmetric `resolveImportedEnsureMultiTimeframe` helper (reads the registered
> `(symbol, interval, package)` row per timeframe, returns the multi-timeframe
> cache-hit shape `{ success, dataPath, dataFeeds }`, fail-fast throw if any
> requested timeframe was not imported) wired at the top of the
> `data:ensureMultiTimeframe` handler, before the queue.
>
> **Verify  --  PASS.** `useImportPackage.test.ts` **8/8** (renderer-hook node-env
> convention: `vi.mock('react')` with stateful `useState` + pass-through
> `useCallback`/`useRef`, no jsdom). `importedSymbolAxis.test.ts` **7/7** (pure
> collapse/widen transform). `data-handlers.test.ts` **85/85** (+3 multi-timeframe
> fork tests: cache read no-queue, live-provider fall-through, one-timeframe-not-
> imported fail-fast). `useAppStore.test.ts` **33/33** (union widening). Plugin and
> main-process tsc clean for every changed file; the residual main-tsc errors (the
> 5 OHLCVRow casts in `data-cache-manager.test`) and the plugin suite's 16 i18n /
>  failures are the documented pre-existing baseline, unchanged.
> **308_1a complete; the BYOD import feature is end-to-end.**

**Sequencing logic:** Phase 1 is a hard gate. Phases 2-5 (308_1) must precede 6-7
(308_1a)  --  there must be importable data with `data_cache_files` rows before
selection has anything to read. Phase 6 precedes Phase 7 so the backend fork is
proven via IPC before the UI is built on top of it.

## Next Actions

Implementation is split into sibling tickets (root-cause decision here; build in
sibling tickets). Scope is deliberately tight per the necessity argument above:
only the DuckDB SQL import + its selection wiring are first-build.

**First build (necessary  --  closes the A-share minute-data capability gap):**

- [x] **Confirm adjustment is package-level only** with the 
      Parquet-contract owner  --  i.e. that capturing the declared mode on the named
      package is sufficient and **no `OHLCVRow` / schema change is needed**
      (expected). **Was blocking ; resolved from code in the Phase 1
      box above** (the  contract is locked by a golden-fixture CI gate
      and Python readers; adding `adjust` would break both and is redundant since a
      package is imported under exactly one mode -> package-level `imported_packages`
      metadata is the strictly-correct altitude). No `OHLCVRow` / Parquet-schema
      change. Gate PASS.
- [x] **  --  SQL import pipeline via DuckDB (MySQL / SQLite /
      PostgreSQL).** A one-time `importFromSql` built on **`@duckdb/node-api`**:
      `ATTACH (READ_ONLY)` the  package shape (`dat_*mins` / `dat_day`)
      and `COPY (SELECT ...) TO '*.parquet'` into the cache, matching the
      six-field `OHLCVRow` /  schema. Not a resident provider. The
      import takes a **user-supplied package name** and a **declared adjustment
      mode**, and for every `COPY`-produced file **inserts a `data_cache_files`
      row** (`provider` = package name)  --  registration is load-bearing, a file
      without a row is invisible. Minimal sufficient build, **gated on the
      adjustment decision above**. Includes the Electron ABI rebuild wiring
      (start.sh) and the security version pin.
- [x] **a  --  make imported cache data selectable, per named package
      (Option 1 / model B).** Add the "Imported / Local" picker source fed by
      `data:listSegments` / `listFiles`, **grouped/filtered by package name**
      (each imported package is its own selectable source), and a
      cache-authoritative branch in `doEnsureData` so a present Parquet file is the
      source of truth (no provider fetch). Required for imported data to be usable
      end-to-end; ships alongside .

**Deferred (YAGNI  --  build only on real demand, not preemptively):**

- [ ] **  --  CSV import + generic column-mapping UI.** Add when a real
      user arrives with a non-package CSV export of unknown schema.
- [ ] **  --  Parquet reader.** Add when a real DuckDB/Parquet user
      arrives.

**Always (independent of build scope):**

- [x] Document the user-provided import path in the data-source user docs as the
      supported route for CN A-share history. -> **DATA_004** (BYOD import doc,
      following the DATA_00x convention).
- [x] Mark the  package as `user-provided` in any data-source listing.
      ->  "Default Data Source Matrix" + provider tree corrected
      (Qlib was never built; CN A-share = baostock live + BYOD-import minute
      history), package classified `user-provided`;  Resolution carries
      the same classification.
- [x] Leave  vendor outreach open but optional; revisit only if
      bundling/partner integration is reconsidered. ->  Next Actions are
      `(Optional)`; Resolution downgrades outreach and corrects the import path to
      a distinct named source (not an `IDataProvider`).
