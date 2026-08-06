"""
TICKET_812 + TICKET_813: end-to-end contract test for the OHLCV
parquet loader.

The desktop writer at
``apps/desktop/src/main/services/parquet-cache-service.ts`` declares
the on-disk schema; ``research_contracts.io.ohlcv_parquet.load_ohlcv``
is the canonical reader. This test mirrors the writer's schema in
pyarrow, writes a fixture parquet, and asserts the loader's
behavior end-to-end:

  TC1  -- timestamp INT64 column promoted to DatetimeIndex
  TC2  -- idempotent on a DataFrame that already has a DatetimeIndex
  TC3  -- raises ValueError on missing 'close' column
  TC4  -- raises ValueError when neither DatetimeIndex nor
          'timestamp' column is available
  TC3a (TICKET_813) -- range check catches seconds-loaded-as-ms case
  TC4a (TICKET_813) -- range check catches ms-loaded-as-seconds case
  TC5a (TICKET_813) -- range check is a no-op on a valid 2024 fixture

Any future change to either side (writer schema, loader promote
logic) that breaks the contract trips this test in CI before
reaching a user.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from research_contracts.io import load_ohlcv


def _write_fixture(
    tmp_path: Path,
    *,
    include_timestamp: bool = True,
    include_close: bool = True,
) -> Path:
    """Write a parquet fixture whose schema mirrors the desktop writer.

    parquet-cache-service.ts schema (TICKET_812 contract):
        timestamp INT64 (Unix SECONDS -- not ms; see IDataProvider)
        open / high / low / close / volume DOUBLE
    """
    cols: dict[str, list] = {}
    if include_timestamp:
        # Three consecutive 1-day bars starting 2024-05-26 UTC, in
        # Unix SECONDS to match the real IDataProvider contract.
        cols["timestamp"] = [1716681600, 1716768000, 1716854400]
    cols["open"] = [100.0, 101.0, 102.0]
    cols["high"] = [101.0, 102.0, 103.0]
    cols["low"] = [99.0, 100.0, 101.0]
    if include_close:
        cols["close"] = [100.5, 101.5, 102.5]
    cols["volume"] = [1_000_000.0, 1_100_000.0, 1_200_000.0]
    df = pd.DataFrame(cols)
    path = tmp_path / "fixture.parquet"
    df.to_parquet(path)
    return path


# ---------------------------------------------------------------------------
# TC1 -- timestamp INT64 column promoted to DatetimeIndex
# ---------------------------------------------------------------------------
def test_load_ohlcv_promotes_timestamp_to_datetimeindex(tmp_path: Path) -> None:
    path = _write_fixture(tmp_path)
    out = load_ohlcv(path)
    assert isinstance(out.index, pd.DatetimeIndex)
    # Values match the original epoch-second inputs (resolved as
    # 2024-05-26 / 27 / 28 UTC).
    expected = pd.to_datetime(
        [1716681600, 1716768000, 1716854400],
        unit="s",
    )
    assert (out.index == expected).all()
    assert out["close"].tolist() == [100.5, 101.5, 102.5]
    # Index name should be cleared so downstream slicers don't pick
    # up the stray 'timestamp' label.
    assert out.index.name is None


# ---------------------------------------------------------------------------
# TC2 -- idempotent on pre-indexed DataFrame (test-fixture path)
# ---------------------------------------------------------------------------
def test_load_ohlcv_idempotent_on_existing_datetimeindex(tmp_path: Path) -> None:
    idx = pd.date_range("2024-05-26", periods=3, freq="1D")
    df = pd.DataFrame(
        {
            "open": [100.0, 101.0, 102.0],
            "high": [101.0, 102.0, 103.0],
            "low": [99.0, 100.0, 101.0],
            "close": [100.5, 101.5, 102.5],
            "volume": [1_000_000.0, 1_100_000.0, 1_200_000.0],
        },
        index=idx,
    )
    path = tmp_path / "preindexed.parquet"
    df.to_parquet(path)

    out = load_ohlcv(path)
    assert isinstance(out.index, pd.DatetimeIndex)
    # Round-trip preserves the timestamps; idempotent loader must not
    # double-set the index or raise on the absence of a 'timestamp'
    # column (there is none, by design).
    assert (out.index == idx).all()
    assert out["close"].tolist() == [100.5, 101.5, 102.5]


# ---------------------------------------------------------------------------
# TC3 -- raises ValueError on missing 'close' column
# ---------------------------------------------------------------------------
def test_load_ohlcv_raises_on_missing_close(tmp_path: Path) -> None:
    path = _write_fixture(tmp_path, include_close=False)
    with pytest.raises(ValueError, match="missing required 'close'"):
        load_ohlcv(path)


# ---------------------------------------------------------------------------
# TC4 -- raises ValueError when neither DatetimeIndex nor 'timestamp'
# ---------------------------------------------------------------------------
def test_load_ohlcv_raises_when_no_timestamp_and_no_datetimeindex(
    tmp_path: Path,
) -> None:
    # No 'timestamp' column AND default RangeIndex -> contract failure.
    path = _write_fixture(tmp_path, include_timestamp=False)
    with pytest.raises(
        ValueError,
        match="neither a DatetimeIndex nor a 'timestamp' column",
    ):
        load_ohlcv(path)


# ---------------------------------------------------------------------------
# TICKET_813 -- range-check invariant on the promoted DatetimeIndex
# ---------------------------------------------------------------------------
# The loader's range check is a boundary diagnostic: any promoted
# index outside [1980-01-01, 2100-01-01) is almost certainly a unit
# mismatch (seconds-as-ms lands at 1970; ms-as-seconds lands far in
# the future). These tests use a column with the WRONG unit to
# simulate the failure mode that would otherwise propagate as a
# silent "degenerate window" deep in the slicer.

def test_load_ohlcv_range_check_catches_ms_loaded_as_seconds(
    tmp_path: Path,
) -> None:
    """Ms loaded as seconds -- the unit error that R1 of TICKET_812
    introduced. With the correct loader (unit='s'), an ms-valued
    column is treated as a very-large second count.

    Real 2024 ms values (1.7e12) overflow pandas' nanosecond
    DatetimeIndex (year 56k); pandas raises OutOfBoundsDatetime
    before the range check fires. To exercise the range-check path
    specifically, we use a smaller ms value (4.1e9 ms = ~2099-12 in
    ms space, but interpreted as seconds lands at year 2099 -- in
    range, NO good) -- so we pick a value carefully tuned to land
    past 2100 as seconds but inside pandas' nanosecond bounds:

      4_133_980_800 (year 2101 as SECONDS) -- range check fires.

    The defense in production: real Alpaca ms values are ~1.7e12;
    when fed as seconds they hit pandas' nanosecond overflow first,
    which is also an OK failure mode (loud, not silent). The unit-
    mismatch ValueError is the loader's preferred message; pandas'
    OutOfBoundsDatetime is the fallback. We assert on EITHER as
    long as the loader does not silently return a bogus index.
    """
    # 4_133_980_800 seconds = 2101-01-01 (just past the 2100 floor),
    # well within pandas' nanosecond range. The range check must
    # catch this; pandas does NOT raise here.
    df = pd.DataFrame({
        "timestamp": [4_133_980_800, 4_133_980_801, 4_133_980_802],
        "open":   [100.0, 101.0, 102.0],
        "high":   [101.0, 102.0, 103.0],
        "low":    [99.0, 100.0, 101.0],
        "close":  [100.5, 101.5, 102.5],
        "volume": [1_000_000.0, 1_100_000.0, 1_200_000.0],
    })
    path = tmp_path / "post_2100.parquet"
    df.to_parquet(path)
    with pytest.raises(ValueError, match="unit mismatch"):
        load_ohlcv(path)


def test_load_ohlcv_real_ms_values_loaded_as_seconds_fail_loudly(
    tmp_path: Path,
) -> None:
    """Real-world ms values (1.7e12) loaded as seconds overflow
    pandas' nanosecond DatetimeIndex. Pandas' OutOfBoundsDatetime
    is also an acceptable failure mode for this contract violation
    -- both surfaces are loud, neither lets the bogus index reach
    the slicer. This test pins that we do NOT silently succeed.
    """
    df = pd.DataFrame({
        "timestamp": [1716681600000, 1716768000000, 1716854400000],
        "open":   [100.0, 101.0, 102.0],
        "high":   [101.0, 102.0, 103.0],
        "low":    [99.0, 100.0, 101.0],
        "close":  [100.5, 101.5, 102.5],
        "volume": [1_000_000.0, 1_100_000.0, 1_200_000.0],
    })
    path = tmp_path / "real_ms_as_seconds.parquet"
    df.to_parquet(path)
    # Either ValueError (range check) or OutOfBoundsDatetime
    # (pandas) -- both are acceptable; silent success is not.
    with pytest.raises((ValueError, Exception), match=r"(unit mismatch|Out of bounds|OverflowError)"):
        load_ohlcv(path)


def test_load_ohlcv_range_check_catches_seconds_loaded_with_pre_indexed_1970(
    tmp_path: Path,
) -> None:
    """Pre-indexed DataFrame whose index already lands at 1970 (the
    seconds-as-ms failure mode -- the symptom TICKET_812 R1 produced
    on real Alpaca data). The loader's idempotent path must still
    apply the range check; otherwise a writer that accidentally
    ships a pre-indexed broken frame would slip through.
    """
    bad_idx = pd.to_datetime(
        [1716681600, 1716768000, 1716854400],
        unit="ms",  # WRONG -- these are seconds, treating as ms
                    # produces 1970-01-20 timestamps.
    )
    df = pd.DataFrame(
        {
            "open":   [100.0, 101.0, 102.0],
            "high":   [101.0, 102.0, 103.0],
            "low":    [99.0, 100.0, 101.0],
            "close":  [100.5, 101.5, 102.5],
            "volume": [1_000_000.0, 1_100_000.0, 1_200_000.0],
        },
        index=bad_idx,
    )
    path = tmp_path / "preindexed_1970.parquet"
    df.to_parquet(path)
    with pytest.raises(ValueError, match="unit mismatch"):
        load_ohlcv(path)


def test_load_ohlcv_range_check_noop_on_valid_2024_fixture(
    tmp_path: Path,
) -> None:
    """Sanity: a correctly-shaped 2024 fixture must NOT trip the
    range check. Guards against an over-tight bound (e.g. picking
    1990 as the floor would silently exclude historical equity data
    that some users care about).
    """
    path = _write_fixture(tmp_path)
    out = load_ohlcv(path)
    assert isinstance(out.index, pd.DatetimeIndex)
    # Sanity: index is in 2024, well inside the plausible window.
    assert out.index[0].year == 2024
    assert out.index[-1].year == 2024


# ---------------------------------------------------------------------------
# TICKET_919 (factor-arm window): load_ohlcv window pushdown.
#
# The orchestrator now sends a requested window (epoch SECONDS) down to
# the reader so it loads only the requested bars instead of the symbol's
# entire history. These pin the half-open [start, end) semantics and the
# no-op behaviour when no window / no timestamp column is present.
#
# Fixture bars (Unix SECONDS):
#   1716681600  2024-05-26
#   1716768000  2024-05-27
#   1716854400  2024-05-28
# ---------------------------------------------------------------------------
def test_load_ohlcv_window_slices_to_requested_bars(tmp_path: Path) -> None:
    """A [start, end) window keeps only the in-window bars (half-open)."""
    path = _write_fixture(tmp_path)
    # Keep only the middle bar: start at 05-27, end before 05-28.
    out = load_ohlcv(path, start=1716768000, end=1716854400)
    assert len(out) == 1
    assert isinstance(out.index, pd.DatetimeIndex)
    assert out.index[0] == pd.Timestamp("2024-05-27")


def test_load_ohlcv_window_start_only_is_inclusive(tmp_path: Path) -> None:
    """``start`` alone keeps bars >= start (inclusive lower bound)."""
    path = _write_fixture(tmp_path)
    out = load_ohlcv(path, start=1716768000)
    assert len(out) == 2
    assert out.index[0] == pd.Timestamp("2024-05-27")
    assert out.index[-1] == pd.Timestamp("2024-05-28")


def test_load_ohlcv_empty_frame_skips_plausible_range_check(tmp_path: Path) -> None:
    path = tmp_path / "empty.parquet"
    pd.DataFrame(
        {
            "timestamp": pd.Series(dtype="int64"),
            "close": pd.Series(dtype="float64"),
        }
    ).to_parquet(path)

    out = load_ohlcv(path)

    assert out.empty
    assert isinstance(out.index, pd.DatetimeIndex)


def test_load_ohlcv_window_end_only_is_exclusive(tmp_path: Path) -> None:
    """``end`` alone keeps bars < end (exclusive upper bound)."""
    path = _write_fixture(tmp_path)
    out = load_ohlcv(path, end=1716768000)
    assert len(out) == 1
    assert out.index[0] == pd.Timestamp("2024-05-26")


def test_load_ohlcv_no_window_reads_full_file(tmp_path: Path) -> None:
    """No window -> legacy full-file read (all three bars)."""
    path = _write_fixture(tmp_path)
    out = load_ohlcv(path)
    assert len(out) == 3


def test_load_ohlcv_window_ignored_on_preindexed_fixture(
    tmp_path: Path,
) -> None:
    """A pre-indexed fixture (no ``timestamp`` column) has nothing to
    push down on -- the window is ignored and the full frame returns,
    so existing fit_universe fold-window fixtures keep their bars.
    """
    idx = pd.date_range("2024-05-26", periods=3, freq="D")
    df = pd.DataFrame({"close": [100.5, 101.5, 102.5]}, index=idx)
    path = tmp_path / "preindexed.parquet"
    df.to_parquet(path)
    out = load_ohlcv(path, start=1716768000, end=1716854400)
    assert len(out) == 3


# TICKET_1292_07 cut 07-B: type-aware pushdown bound.
#
# The production writer emits INT64 seconds, but pandas-written frames (test
# fixtures, and any frame whose `timestamp` column is a datetime dtype) store
# the column as Arrow ``timestamp[ns]``. A seconds-int pushdown predicate
# against a ``timestamp[ns]`` column raises ArrowNotImplementedError (no cross-
# type kernel). The reader must coerce the bound to the column's physical type
# so the SAME requested window pushes down on both physical layouts.
def _write_timestamp_ns_fixture(tmp_path: Path) -> Path:
    """Fixture whose ``timestamp`` column is an Arrow ``timestamp[ns]`` (the
    shape pandas produces when the column is a datetime dtype)."""
    df = pd.DataFrame(
        {
            "timestamp": pd.to_datetime(
                [1716681600, 1716768000, 1716854400], unit="s"
            ),
            "close": [100.5, 101.5, 102.5],
        }
    )
    path = tmp_path / "ts_ns_fixture.parquet"
    df.to_parquet(path)
    return path


def test_load_ohlcv_window_pushdown_on_timestamp_ns_column(
    tmp_path: Path,
) -> None:
    """A [start, end) seconds window pushes down against a ``timestamp[ns]``
    column (bound coerced to a like-typed Timestamp), keeping only the
    in-window bar -- no ArrowNotImplementedError."""
    path = _write_timestamp_ns_fixture(tmp_path)
    out = load_ohlcv(path, start=1716768000, end=1716854400)
    assert len(out) == 1
    assert isinstance(out.index, pd.DatetimeIndex)
    assert out.index[0] == pd.Timestamp("2024-05-27")


def test_load_ohlcv_no_window_on_timestamp_ns_reads_full(
    tmp_path: Path,
) -> None:
    """No window on a ``timestamp[ns]`` fixture still reads every bar."""
    path = _write_timestamp_ns_fixture(tmp_path)
    out = load_ohlcv(path)
    assert len(out) == 3
