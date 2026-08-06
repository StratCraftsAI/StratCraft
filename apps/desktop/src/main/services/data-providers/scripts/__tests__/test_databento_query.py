"""
Pyarrow window-pushdown enforcement test for databento_query.py.

TICKET_958 Acceptance Criterion #1 + CLAUDE.md "no full-history read" rule
(TICKET_919): `query_ohlcv` MUST push the requested time window down to
`pyarrow.parquet.read_table(..., filters=...)`. Reading the full parquet and
slicing in memory is forbidden -- this test is the literal enforcement of
that rule.

The probe: monkey-patch `pyarrow.parquet.read_table` to record the kwargs it
was invoked with, then assert that:
  1. `filters` is not None
  2. `filters` contains a >= predicate on the timestamp column with the
     start datetime, AND a < predicate with the end datetime
  3. `columns` is restricted to the OHLCV subset (a second form of
     pushdown -- the full column set is never decoded)

Run with: pytest apps/desktop/src/main/services/data-providers/scripts/__tests__/test_databento_query.py
"""

import importlib.util
import io
import json
import os
import sys
from contextlib import redirect_stdout
from datetime import datetime
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

# TICKET_958_5 AC #6 -- canonical-stdout schema pin (shared helper).
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _canonical_stdout_pin import assert_canonical_stdout_rows  # noqa: E402


SCRIPT_DIR = Path(__file__).resolve().parent.parent
SCRIPT_PATH = SCRIPT_DIR / "databento_query.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("databento_query", SCRIPT_PATH)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def fixture_root(tmp_path, monkeypatch):
    """Build a tiny IBM/1m.parquet that mirrors the production schema so
    read_table actually has something to consume after the monkey-patch
    probe records its kwargs."""
    # Schema mirrors a representative `<parquet-root>/IBM/1m.parquet`:
    #   open/high/low/close: float64, volume: uint32, bar_count: int64,
    #   vwap: float64, __index_level_0__: timestamp[ns] (pandas index)
    ts = pa.array(
        [
            datetime(2026, 1, 28, 13, 31, 0),
            datetime(2026, 1, 28, 13, 32, 0),
            datetime(2026, 1, 28, 13, 33, 0),
            datetime(2026, 1, 29, 13, 31, 0),
        ],
        type=pa.timestamp("ns"),
    )
    table = pa.table({
        "open": pa.array([100.0, 101.0, 102.0, 103.0], type=pa.float64()),
        "high": pa.array([100.5, 101.5, 102.5, 103.5], type=pa.float64()),
        "low": pa.array([99.5, 100.5, 101.5, 102.5], type=pa.float64()),
        "close": pa.array([100.2, 101.2, 102.2, 103.2], type=pa.float64()),
        "volume": pa.array([10, 20, 30, 40], type=pa.uint32()),
        "bar_count": pa.array([1, 1, 1, 1], type=pa.int64()),
        "vwap": pa.array([100.1, 101.1, 102.1, 103.1], type=pa.float64()),
        "__index_level_0__": ts,
    })
    sym_dir = tmp_path / "IBM"
    sym_dir.mkdir()
    pq.write_table(table, sym_dir / "1m.parquet")
    monkeypatch.setenv("STRATCRAFT_DATABENTO_PARQUET_ROOT", str(tmp_path))
    return tmp_path


@pytest.fixture
def recording_read_table(monkeypatch):
    """Wrap pyarrow.parquet.read_table to record the kwargs it received, then
    delegate to the real implementation. This is what enforces the rule --
    if databento_query.py ever stops passing filters=, the assertion below
    fails loudly."""
    calls: list[dict[str, Any]] = []
    real = pq.read_table

    def wrapper(*args, **kwargs):
        calls.append({"args": args, "kwargs": kwargs})
        return real(*args, **kwargs)

    monkeypatch.setattr(pq, "read_table", wrapper)
    return calls


def test_query_ohlcv_pushes_window_filter_to_pyarrow(fixture_root, recording_read_table, capsys):
    """The single most important test in this file: filters= must be set."""
    mod = _load_module()
    mod.query_ohlcv("IBM", "1m", "2026-01-28", "2026-01-29")

    # Exactly one read_table call for the query path.
    assert len(recording_read_table) == 1, (
        f"expected 1 pq.read_table call, got {len(recording_read_table)} -- "
        "the script may be making an extra unfiltered read"
    )
    call = recording_read_table[0]
    kwargs = call["kwargs"]

    # ENFORCEMENT: filters= must be non-None and must reference the timestamp
    # column on BOTH sides of the window.
    filters = kwargs.get("filters")
    assert filters is not None, (
        "TICKET_919 violation: query_ohlcv called pq.read_table without filters=. "
        "This reads the full parquet and is the exact pattern banned by "
        "CLAUDE.md 'no full-history read -- window pushdown mandatory'."
    )

    timestamp_col = "__index_level_0__"
    predicate_ops = {(col, op) for (col, op, _val) in filters}
    assert (timestamp_col, ">=") in predicate_ops, (
        f"missing >= lower-bound predicate on {timestamp_col}: filters={filters}"
    )
    assert (timestamp_col, "<") in predicate_ops, (
        f"missing < upper-bound predicate on {timestamp_col}: filters={filters}"
    )

    # ENFORCEMENT: columns= must also restrict the decode set -- second form
    # of pushdown that prevents bar_count / vwap from being decoded.
    columns = kwargs.get("columns")
    assert columns is not None, "columns= pushdown also required"
    assert timestamp_col in columns
    for col in ("open", "high", "low", "close", "volume"):
        assert col in columns
    # bar_count / vwap must NOT be decoded -- they're never returned.
    assert "bar_count" not in columns
    assert "vwap" not in columns


def test_query_ohlcv_returns_window_subset(fixture_root, recording_read_table, capsys):
    """End-to-end: the window filter actually narrows the output rows.

    TICKET_958_3 AC #9: the interval contract is `[start, end]` END-INCLUSIVE.
    A date-only `end_iso` covers the whole of that calendar day. Fixture has
    4 rows: 3 on 2026-01-28 + 1 on 2026-01-29. Querying `[2026-01-28, 2026-01-29]`
    must return all 4 rows.
    """
    mod = _load_module()
    buf = io.StringIO()
    with redirect_stdout(buf):
        mod.query_ohlcv("IBM", "1m", "2026-01-28", "2026-01-29")
    rows = json.loads(buf.getvalue())
    assert len(rows) == 4, f"expected 4 end-inclusive rows, got {len(rows)}: {rows}"
    # TICKET_958_5 AC #6: canonical stdout schema (shared pin).
    assert_canonical_stdout_rows(rows)


def test_query_ohlcv_chunk_boundary_no_dropouts(fixture_root, capsys):
    """Regression guard for TICKET_958_3 Finding 10.

    Previously `databento_query.py` used a half-open `[start, end)` filter
    while the TS-side `DataCacheManager.splitGapIntoChunks` emitted
    `chunk.endDate` as the INCLUSIVE last day (computed via
    `prevDayStr = chunkEnd - 1 day`). The contract drift silently dropped
    one full session at every chunk seam (e.g. 2026-04-08 between chunk1
    [03-09, 04-08] and chunk2 [04-09, 05-08] on a CHUNK_MONTHS=1 walk).

    This test replays a two-chunk walk against the fixture and asserts:
      (a) chunk1 [Jan 28, Jan 28] returns the 3 Jan 28 rows;
      (b) chunk2 [Jan 29, Jan 29] returns the 1 Jan 29 row;
      (c) union of the two chunk results equals the full fixture
          (no row dropped at the boundary, no row counted twice).
    """
    mod = _load_module()
    # Chunk 1: [Jan 28, Jan 28] -- a single-day inclusive window
    buf1 = io.StringIO()
    with redirect_stdout(buf1):
        mod.query_ohlcv("IBM", "1m", "2026-01-28", "2026-01-28")
    chunk1 = json.loads(buf1.getvalue())
    # Chunk 2: [Jan 29, Jan 29] -- the SUCCESSOR single-day window. Under
    # the old half-open contract this would have lost Jan 28 from chunk1
    # while chunk2 starts at Jan 29; the union would be 1 row instead of 4.
    buf2 = io.StringIO()
    with redirect_stdout(buf2):
        mod.query_ohlcv("IBM", "1m", "2026-01-29", "2026-01-29")
    chunk2 = json.loads(buf2.getvalue())

    assert len(chunk1) == 3, (
        f"chunk1 [Jan 28, Jan 28] should return all 3 Jan 28 rows; got {len(chunk1)}: {chunk1}"
    )
    assert len(chunk2) == 1, (
        f"chunk2 [Jan 29, Jan 29] should return the 1 Jan 29 row; got {len(chunk2)}: {chunk2}"
    )
    union_ts = {r["timestamp"] for r in chunk1} | {r["timestamp"] for r in chunk2}
    assert len(union_ts) == 4, (
        f"chunk1 union chunk2 must cover all 4 fixture rows with no dropout and no "
        f"double-count; got {len(union_ts)} unique timestamps: {sorted(union_ts)}"
    )
    # Belt-and-braces: the union of chunked fetches matches a single end-inclusive
    # query that spans both days.
    buf_all = io.StringIO()
    with redirect_stdout(buf_all):
        mod.query_ohlcv("IBM", "1m", "2026-01-28", "2026-01-29")
    full = json.loads(buf_all.getvalue())
    assert {r["timestamp"] for r in full} == union_ts


def test_query_ohlcv_missing_parquet_returns_empty(tmp_path, monkeypatch, capsys):
    """Missing-symbol path -- exclusion, not error (matches yfinance)."""
    monkeypatch.setenv("STRATCRAFT_DATABENTO_PARQUET_ROOT", str(tmp_path))
    mod = _load_module()
    buf = io.StringIO()
    with redirect_stdout(buf):
        mod.query_ohlcv("NOPE", "1m", "2026-01-28", "2026-01-29")
    assert json.loads(buf.getvalue()) == []


def test_check_connection_reports_missing_root(tmp_path, monkeypatch, capsys):
    """`reason: 'not-configured'` is the documented missing-root signal."""
    bogus = tmp_path / "nope"
    monkeypatch.setenv("STRATCRAFT_DATABENTO_PARQUET_ROOT", str(bogus))
    mod = _load_module()
    buf = io.StringIO()
    with redirect_stdout(buf):
        mod.check_connection()
    payload = json.loads(buf.getvalue())
    assert payload["connected"] is False
    assert payload["reason"] == "not-configured"
