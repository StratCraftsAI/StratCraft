"""Canonical OHLCV parquet loader (TICKET_812, extracted by TICKET_1304_5A).

Single source of truth for "how do we read a Tool Sweep parquet into
a DataFrame that downstream slicers (walk-forward, holdout, embargo)
can rely on."

Writer-side contract
--------------------
The desktop writer at
``apps/desktop/src/main/services/parquet-cache-service.ts`` declares
the following schema for OHLCV parquets:

    timestamp : INT64 Unix epoch SECONDS (UTC).
                NOTE: seconds, not milliseconds. This unit comes from
                the IDataProvider contract
                (``apps/desktop/src/main/services/data-providers/
                types.ts``, queryOHLCV() docblock: "timestamp MUST
                be Unix seconds (not milliseconds)") and is honored
                by every concrete provider (AlpacaProvider,
                DukascopyProvider) plus ParquetCacheService's
                internal date formatting (which multiplies by
                MS_PER_SECOND before constructing a JS Date).
                Stored as a plain column, NOT promoted to the
                parquet's logical index -- the parquetjs-lite
                writer does not round-trip a pandas DatetimeIndex
                with a stable wire format across writer/reader
                version pairs.
    open/high/low/close/volume : DOUBLE.

Python readers must promote ``timestamp`` to a ``pd.DatetimeIndex``
before any time-window slicing (e.g. fit_universe's walk-forward
fold slicer compares against ``pd.Timestamp(ms, unit='ms')`` bounds
supplied by the desktop orchestrator). This module is that single
promote step; downstream code MUST NOT call ``pd.read_parquet``
directly on a Tool Sweep parquet.

The orchestrator's IS/OOS bounds are passed in EPOCH MS even though
the parquet column is SECONDS. That asymmetry is fine: pandas'
``Timestamp(ms, unit='ms')`` and ``to_datetime(seconds, unit='s')``
both resolve to comparable ``pd.Timestamp`` values, so the slicer
that uses ``df.index >= pd.Timestamp(ms, unit='ms')`` works as long
as this loader promotes ``timestamp`` correctly (``unit='s'``).
Mixing the units (e.g. loading seconds as ``unit='ms'``) produces
a 1970 DatetimeIndex that never intersects the 2024-2026 IS/OOS
windows, which is exactly what TICKET_812 R2 was symptomatising.

Pre-TICKET_812 history: ``fit_one.py`` and ``fit_universe.py`` each
had a duplicate private ``_load_parquet`` that did the bare
``pd.read_parquet`` and left the index as ``RangeIndex(int64)``.
fit_one's ``iloc``-based holdout split happened to be index-type-
agnostic so the missing promote was invisible. fit_universe's
walk-forward slicer raised loudly the first time a real (writer ->
CLI) path was exercised end-to-end (TICKET_811 R3 smoke on
sp500_top50 + alpaca). This module replaces both copies.

If the writer schema ever changes (e.g. a v2 schema adds a ``vwap``
column or moves ``timestamp`` to ``TIMESTAMP_MILLIS``), update this
loader and the contract test in the same PR; the test pins the
schema/loader pair end-to-end.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq


# Required columns. The writer always emits OHLCV, but only ``close``
# is strictly load-blocking for v1 -- downstream sweep templates may
# or may not reference the other columns depending on their
# observable. Keeping the required set minimal avoids forcing
# unrelated parquets through a stricter check than fit_one historically
# applied (pre-TICKET_812 fit_one only checked for ``close``).
_REQUIRED_COLUMNS = ("close",)


# TICKET_813: plausible-range invariant on the promoted DatetimeIndex.
#
# A correctly-promoted OHLCV index lands somewhere in modern history;
# anything pre-1980 or post-2100 is almost certainly a unit mismatch:
#
#   - Seconds loaded as ms: e.g. 1716681600 (2024-05-26) becomes
#     pd.Timestamp('1970-01-20 20:54:28.800000') -- pre-1980.
#   - Ms loaded as seconds: 1716681600000 becomes
#     pd.Timestamp('56368-04-29 ...') -- post-2100.
#
# The orchestrator's IS/OOS windows then fail to intersect the index,
# and the slicer reports `train=0, eval=0` (TICKET_812 R1 symptom).
# Catching the mismatch here, at the loader boundary, surfaces the
# real cause ("unit mismatch") instead of letting it propagate as
# "degenerate window" deep in the slicer.
#
# Per CLAUDE.md "NO DEFENSIVE CHECKS AS ROOT CAUSE FIX": the range
# check exists as a *boundary diagnostic* on top of the correct
# loader, not as a substitute for getting the unit right. The loader
# is expected to do the right promote (``unit='s'``); the check
# exists so the next time someone changes the unit incorrectly, the
# failure surfaces at the loader call with a clear message instead
# of as a downstream symptom ten function calls away.
_INDEX_PLAUSIBLE_MIN = pd.Timestamp("1980-01-01")
_INDEX_PLAUSIBLE_MAX = pd.Timestamp("2100-01-01")


def _assert_index_in_plausible_range(
    idx: pd.DatetimeIndex, path: Path
) -> None:
    """Raise if the promoted DatetimeIndex falls outside [1980, 2100).

    No-op on empty frames -- the caller's other checks (e.g.
    fit_universe's degenerate-window guard at len < 2) cover that
    case with a more actionable message.
    """
    if len(idx) == 0:
        return
    first = idx[0]
    last = idx[-1]
    if first < _INDEX_PLAUSIBLE_MIN or last >= _INDEX_PLAUSIBLE_MAX:
        raise ValueError(
            f"OHLCV parquet at {path}: promoted DatetimeIndex falls "
            f"outside the plausible range "
            f"[{_INDEX_PLAUSIBLE_MIN.date()}, "
            f"{_INDEX_PLAUSIBLE_MAX.date()}). "
            f"first={first}, last={last}. "
            f"This is almost certainly a timestamp unit mismatch. The "
            f"writer (parquet-cache-service.ts, per the IDataProvider "
            f"contract) emits Unix SECONDS, so the loader must use "
            f"pd.to_datetime(..., unit='s'). Loading seconds as ms "
            f"lands the index near 1970; loading ms as seconds lands "
            f"it far in the future. See TICKET_813 for the structural "
            f"invariant and TICKET_812 for the loader contract."
        )


def _timestamp_column_type(path: Path) -> Optional["pa.DataType"]:
    """Arrow type of the ``timestamp`` column, or None if absent.

    Reads only the file's footer (cheap) -- no row groups are
    materialised. Used to decide whether a requested window can be
    pushed down: a pre-indexed fixture with no ``timestamp`` column has
    nothing to filter on and must fall through to the bare read.

    The type is returned (not just a bool) so the pushdown predicate can
    be built with a bound value that MATCHES the column's physical type.
    The production writer (parquet-cache-service.ts) emits INT64 epoch
    SECONDS, but test fixtures and any pandas-written frame may store the
    column as an Arrow ``timestamp[unit]``. Comparing an INT64 second
    against a ``timestamp[ns]`` column raises ``ArrowNotImplementedError``
    (no cross-type kernel), so the caller coerces the bound per type.
    """
    schema = pq.ParquetFile(path).schema_arrow
    if "timestamp" not in schema.names:
        return None
    return schema.field("timestamp").type


def _timestamp_pushdown_bound(bound_s: int, ts_type: "pa.DataType"):
    """Coerce an epoch-SECONDS window bound to the ``timestamp`` column type.

    - Integer column (INT64/INT32, the production seconds contract): the
      bound stays an ``int`` second -- byte-identical to the pre-existing
      pushdown path.
    - Arrow ``timestamp[unit]`` column: the bound becomes a
      ``pd.Timestamp`` (UTC-naive) so pyarrow compares like-typed values.
      pyarrow accepts a ``pd.Timestamp`` scalar against a timestamp column
      and normalises the unit internally.
    """
    if pa.types.is_timestamp(ts_type):
        return pd.Timestamp(bound_s, unit="s")
    return int(bound_s)


def load_ohlcv(
    path: Path,
    start: Optional[int] = None,
    end: Optional[int] = None,
) -> pd.DataFrame:
    """Load an OHLCV parquet and promote ``timestamp`` to a DatetimeIndex.

    TICKET_919 (factor-arm window): ``start`` / ``end`` are an optional
    requested window in epoch **SECONDS** (the on-disk ``timestamp``
    unit -- see the writer-side contract above). When supplied, the
    rows are filtered at the storage layer via a pyarrow predicate
    pushdown (half-open ``[start, end)``) so out-of-window bars are
    skipped at read time instead of loaded and discarded. The
    orchestrator carries the window in MS; the *caller* converts MS->S
    before passing it here (the factor CLI does this once at the
    ``__main__`` boundary), keeping this loader's unit consistent with
    the parquet column it filters on.

    The window only applies to the ``timestamp``-column path. Pre-
    indexed fixtures (already a DatetimeIndex, no ``timestamp`` column)
    are returned unsliced -- pushdown has no column to filter on -- so
    existing fit_universe fold-window tests keep their full frames.

    Behavior:
      - If the parquet already has a DatetimeIndex (test fixtures
        built with ``pd.date_range``), return it unchanged.
      - Otherwise promote the ``timestamp`` INT64 column to a UTC-
        naive DatetimeIndex via ``pd.to_datetime(unit='s')``. The
        unit is SECONDS per the IDataProvider contract, not
        milliseconds -- see the module docstring for the source.
      - Raise ``ValueError`` on missing ``close`` (caller-friendly
        contract failure) or on the both-missing case
        (neither DatetimeIndex nor ``timestamp`` column -- this can
        only happen if the writer regresses).

    Args:
      path: Filesystem path to a parquet file produced by
        ``parquet-cache-service.ts`` (or a test fixture matching the
        same shape).

    Returns:
      DataFrame whose index is a ``pd.DatetimeIndex`` (UTC-naive,
      millisecond resolution) and whose columns include at minimum
      ``close``.

    Raises:
      ValueError: If the parquet is missing required columns, or if
        neither a DatetimeIndex nor a ``timestamp`` column is
        available to satisfy the loader's contract.
    """
    # TICKET_919 (factor-arm window): when a window is requested, push the
    # bound down to the parquet read so out-of-window rows never leave the
    # storage layer. Half-open [start, end) on the SECONDS ``timestamp``
    # column. If this parquet's ``timestamp`` lacks row-group statistics
    # the pushdown degrades to a full scan + post-filter -- still correct,
    # and the row count handed downstream is bounded either way. A parquet
    # that has no ``timestamp`` column (pre-indexed fixture) falls through
    # to the bare read; the window has no column to filter on.
    ts_type = (
        _timestamp_column_type(path)
        if (start is not None or end is not None)
        else None
    )
    if ts_type is not None:
        filters = []
        if start is not None:
            filters.append(
                ("timestamp", ">=", _timestamp_pushdown_bound(int(start), ts_type))
            )
        if end is not None:
            filters.append(
                ("timestamp", "<", _timestamp_pushdown_bound(int(end), ts_type))
            )
        df = pq.read_table(path, filters=filters).to_pandas()
    else:
        df = pd.read_parquet(path)

    for col in _REQUIRED_COLUMNS:
        if col not in df.columns:
            raise ValueError(
                f"Parquet at {path} missing required '{col}' column; "
                f"got columns={list(df.columns)}"
            )

    # Idempotent on pre-indexed input. Test fixtures that build the
    # frame directly with a DatetimeIndex must continue to work
    # unchanged so the existing fit_universe fold-window tests pass.
    if isinstance(df.index, pd.DatetimeIndex):
        _assert_index_in_plausible_range(df.index, path)
        return df

    if "timestamp" not in df.columns:
        raise ValueError(
            f"Parquet at {path} has neither a DatetimeIndex nor a "
            f"'timestamp' column; cannot satisfy the OHLCV loader "
            f"contract (see research_contracts.io.ohlcv_parquet). The "
            f"writer must emit one of the two."
        )

    # ``set_index(Series, ...)`` keeps the source column by default
    # (the ``drop`` arg only applies when passing a column-name string).
    # Drop ``timestamp`` explicitly so the post-load shape is the slim
    # OHLCV frame downstream code expects -- no duplicated information
    # between the index and a column, no risk of fit_* code accidentally
    # picking up the int64 column when iterating df.columns.
    df = df.set_index(pd.to_datetime(df["timestamp"], unit="s"))
    df = df.drop(columns=["timestamp"])
    df.index.name = None
    _assert_index_in_plausible_range(df.index, path)
    return df
