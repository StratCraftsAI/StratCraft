"""
Databento Local-Parquet OHLCV Query Script

TICKET_958 Step 1: Standalone Python reader for the Databento local-parquet
research store. Called via child_process.execFile from DatabentoProvider.

This provider reads parquet files written by the offline Databento ingestion
pipeline at `<parquet-root>/{symbol}/{interval}.parquet`, where the root is
`STRATCRAFT_DATABENTO_PARQUET_ROOT` (see DEFAULT_PARQUET_ROOT below).
No network calls to Databento; no API auth. Local-only research data.

Window pushdown (CLAUDE.md "no full-history read" / TICKET_919):
  pyarrow.parquet.read_table is invoked with `filters=` on the parquet's
  index column (`__index_level_0__`, a timestamp[ns] column written by
  pandas when the index is the bar timestamp). The full parquet is never
  materialised; only row groups intersecting the requested window are read.

Input: command-line args (command, ...)
Output: JSON to stdout

Commands:
  query  <symbol> <interval> <start_iso> <end_iso>  -> OHLCVRow[] JSON
  info   <symbol> <interval>                         -> { startTime, endTime } JSON
  check                                              -> { "connected": true/false } JSON

Interval contract (TICKET_958_3 AC #9):
  `start_iso` / `end_iso` are interpreted as **[start, end] END-INCLUSIVE**
  date-or-timestamp bounds. This matches what every TS caller naturally writes
  (`splitGapIntoChunks` in data-cache-manager.ts emits `chunk.endDate` as the
  last day to include, derived by `chunkEnd - 1 day`). Under the previous
  half-open `[start, end)` convention, multi-chunk downloads silently dropped
  one full RTH session at every chunk seam (e.g. `2026-04-08` and `2026-05-08`
  in a 2026-03-09 .. 2026-06-06 / `CHUNK_MONTHS['5m']=1` walk). The
  contract is now: a date-only `end_iso` covers the WHOLE of that calendar
  day; a full ISO timestamp `end_iso` is the inclusive last instant of the
  window. Internally we convert to a `< end_exclusive` pyarrow filter where
  `end_exclusive = end_inclusive + 1 day` for date-only, or
  `end_inclusive + 1 nanosecond` for a full timestamp.
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone


# TICKET_958: Default parquet root. Overridable via STRATCRAFT_DATABENTO_PARQUET_ROOT
# so the test suite can point at a fixture root without touching production data.
DEFAULT_PARQUET_ROOT = "/data2/ws/equities-hist/data/parquet"

# TICKET_958: pandas writes the bar-timestamp index out under this column name.
# Confirmed via `pyarrow.parquet.read_metadata(...).schema` against
# a representative `<parquet-root>/IBM/1m.parquet` -- the schema is
# (open, high, low, close, volume, bar_count, vwap, __index_level_0__:timestamp[ns]).
TIMESTAMP_COLUMN = "__index_level_0__"

# TICKET_958: Columns we actually need for OHLCVRow. Reading a column subset is a
# second form of pushdown -- pyarrow only decodes the listed columns.
OHLCV_COLUMNS = [TIMESTAMP_COLUMN, "open", "high", "low", "close", "volume"]


def _parquet_root() -> str:
    return os.environ.get("STRATCRAFT_DATABENTO_PARQUET_ROOT", DEFAULT_PARQUET_ROOT)


def _parquet_path(symbol: str, interval: str) -> str:
    return os.path.join(_parquet_root(), symbol, f"{interval}.parquet")


def _parse_iso_to_utc(iso_str: str) -> tuple[datetime, bool]:
    """Parse a YYYY-MM-DD or full ISO-8601 string into a tz-aware UTC datetime.

    Returns `(dt, is_date_only)` so the caller can apply the
    [start, end] end-inclusive contract correctly: a date-only input on the
    `end` side covers the WHOLE of that calendar day, which is `dt + 1 day`
    exclusive, while a full timestamp is the inclusive last instant which is
    `dt + 1 nanosecond` exclusive. See module docstring for the full contract.
    """
    s = iso_str.strip()
    is_date_only = len(s) == 10
    if is_date_only:
        dt = datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    else:
        # Accept 'Z' suffix as UTC indicator (Python <3.11 fromisoformat is strict).
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc), is_date_only


def query_ohlcv(symbol: str, interval: str, start_iso: str, end_iso: str) -> None:
    """Read OHLCV rows for [start, end] (end-inclusive) with pushdown.

    See module docstring "Interval contract (TICKET_958_3 AC #9)" for the
    end-inclusive semantics. Internally we issue a `< end_exclusive` pyarrow
    filter where `end_exclusive` is derived from `end_iso` by adding one
    calendar day (date-only) or one nanosecond (full timestamp).
    """
    import pyarrow.parquet as pq

    path = _parquet_path(symbol, interval)
    if not os.path.isfile(path):
        # Empty result is the correct shape -- the orchestrator treats no-data
        # symbols as exclusions, not as errors (matches yfinance behaviour
        # when ticker.history returns df.empty).
        print(json.dumps([]))
        return

    start_dt_aware, _start_is_date_only = _parse_iso_to_utc(start_iso)
    end_dt_aware, end_is_date_only = _parse_iso_to_utc(end_iso)

    # TICKET_958_3 AC #9: convert the end-inclusive bound to an
    # end-exclusive bound for the pyarrow `<` filter. Date-only inputs
    # cover the whole calendar day, so add 1 day; full timestamps add
    # the smallest representable increment (1 microsecond -- timedelta
    # does not expose nanoseconds, and the parquet column has
    # nanosecond resolution but trade-derived bars are bucketed at
    # second granularity, so 1us is sufficient and avoids any
    # precision-loss surprises).
    if end_is_date_only:
        end_exclusive_aware = end_dt_aware + timedelta(days=1)
    else:
        end_exclusive_aware = end_dt_aware + timedelta(microseconds=1)

    start_dt = start_dt_aware.replace(tzinfo=None)
    end_dt = end_exclusive_aware.replace(tzinfo=None)

    # TICKET_919 / CLAUDE.md "no full-history read": pyarrow filters= pushdown.
    # End is exclusive AFTER the end-inclusive -> end-exclusive shift above,
    # so the on-disk filter still matches pyarrow's `<` semantics while the
    # CALLER's contract is `[start, end]` end-inclusive.
    filters = [
        (TIMESTAMP_COLUMN, ">=", start_dt),
        (TIMESTAMP_COLUMN, "<", end_dt),
    ]

    table = pq.read_table(path, columns=OHLCV_COLUMNS, filters=filters)

    if table.num_rows == 0:
        print(json.dumps([]))
        return

    # Pull arrays directly -- avoids the pandas dependency and is ~3x faster
    # for the row-loop than to_pandas().iterrows().
    ts_col = table.column(TIMESTAMP_COLUMN).to_pylist()
    open_col = table.column("open").to_pylist()
    high_col = table.column("high").to_pylist()
    low_col = table.column("low").to_pylist()
    close_col = table.column("close").to_pylist()
    volume_col = table.column("volume").to_pylist()

    rows = []
    for i in range(table.num_rows):
        ts = ts_col[i]
        # pyarrow returns python datetime objects from timestamp[ns]; convert
        # to unix seconds. The parquet column is tz-naive UTC by convention
        # (pandas-written from a tz-naive DatetimeIndex of UTC bar starts).
        if isinstance(ts, datetime):
            if ts.tzinfo is None:
                ts_unix = int(ts.replace(tzinfo=timezone.utc).timestamp())
            else:
                ts_unix = int(ts.timestamp())
        else:
            # Defensive: if pyarrow ever returns an int (ns), normalise.
            ts_unix = int(ts) // 1_000_000_000
        rows.append({
            "timestamp": ts_unix,
            "open": float(open_col[i]),
            "high": float(high_col[i]),
            "low": float(low_col[i]),
            "close": float(close_col[i]),
            "volume": float(volume_col[i]),
        })

    rows.sort(key=lambda r: r["timestamp"])
    print(json.dumps(rows))


def get_symbol_info(symbol: str, interval: str) -> None:
    """Return earliest/latest available bar timestamps as ISO date strings."""
    import pyarrow.parquet as pq

    path = _parquet_path(symbol, interval)
    if not os.path.isfile(path):
        print(json.dumps({"startTime": None, "endTime": None}))
        return

    # Metadata-only read of min/max from the column statistics is the cheap
    # path, but row-group stats on __index_level_0__ are not guaranteed by
    # every pandas/pyarrow writer version. Fall back to reading the column
    # alone (still cheap: one column, no filters).
    table = pq.read_table(path, columns=[TIMESTAMP_COLUMN])
    if table.num_rows == 0:
        print(json.dumps({"startTime": None, "endTime": None}))
        return

    ts_list = table.column(TIMESTAMP_COLUMN).to_pylist()
    ts_min = min(ts_list)
    ts_max = max(ts_list)
    start_str = ts_min.strftime("%Y-%m-%d") if isinstance(ts_min, datetime) else None
    end_str = ts_max.strftime("%Y-%m-%d") if isinstance(ts_max, datetime) else None
    print(json.dumps({"startTime": start_str, "endTime": end_str}))


def check_connection() -> None:
    """Verify pyarrow is importable AND the parquet root is reachable."""
    try:
        import pyarrow  # noqa: F401
        root = _parquet_root()
        if not os.path.isdir(root):
            print(json.dumps({
                "connected": False,
                "reason": "not-configured",
                "error": f"Databento parquet root not found: {root}",
            }))
            return
        print(json.dumps({"connected": True}))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"connected": False, "error": str(e)}))


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No command specified. Usage: query|info|check"}))
        sys.exit(1)

    command = sys.argv[1]
    try:
        if command == "query":
            if len(sys.argv) != 6:
                print(json.dumps({
                    "error": "Usage: query <symbol> <interval> <start_iso> <end_iso>"
                }))
                sys.exit(1)
            query_ohlcv(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
        elif command == "info":
            if len(sys.argv) != 4:
                print(json.dumps({"error": "Usage: info <symbol> <interval>"}))
                sys.exit(1)
            get_symbol_info(sys.argv[2], sys.argv[3])
        elif command == "check":
            check_connection()
        else:
            print(json.dumps({"error": f"Unknown command: {command}"}))
            sys.exit(1)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
