"""
TICKET_813: bridge test -- real TS writer -> Python loader round-trip.

Why this file exists
--------------------
TICKET_812's existing contract test
(test_ohlcv_parquet_contract.py) writes its fixture in Python using
pyarrow and the same unit assumption it then asserts. If the TS-side
writer changes shape (column added/removed/retyped, unit changed,
schema bumped), that test does NOT notice because it never touched
the TS writer.

This file closes that gap. The checked-in golden parquet at
``tests/io/fixtures/golden_real_writer.parquet`` was produced by
running the real `@dsnp/parquetjs` writer with the production
`OHLCV_SCHEMA` constant (extracted into a standalone module for
exactly this purpose, see ``apps/desktop/src/main/services/
ohlcv-parquet-schema.ts``). The TS regenerator script
(``scripts/regen-ohlcv-golden-parquet.ts``) writes the file; this
Python test reads it via ``load_ohlcv`` and asserts that the wall-
clock timestamps round-trip correctly.

If the TS-side writer schema changes without the golden being
regenerated, two things happen:

  1. The CI gate ``regen-ohlcv-golden-parquet.ts --check`` exits 1
     (it re-runs the writer and content-diffs the result against the
     checked-in file).
  2. This Python test continues to pass against the stale fixture
     because the fixture and the loader still agree -- but the
     ``--check`` failure surfaces the drift in code review.

Conversely, if the Python loader (load_ohlcv) ever drifts from the
writer's wire format, this test fails immediately because the
golden's seconds-valued timestamps no longer resolve to the
expected wall-clock dates.

Seed values are pinned in ``scripts/regen-ohlcv-golden-parquet.ts``
(5 daily bars starting 2024-05-26 UTC). Keep the assertion table
below in lock-step with that script -- if you change one, regen
the golden AND update the expectations here.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from research_contracts.io import load_ohlcv


_GOLDEN_PATH = (
    Path(__file__).resolve().parent / "fixtures" / "golden_real_writer.parquet"
)

# Mirror of SEED_ROWS in scripts/regen-ohlcv-golden-parquet.ts. If
# this table and that script disagree, either the regenerator hasn't
# been run after a seed change, or someone hand-edited the golden.
# Both are bugs.
_EXPECTED_TIMESTAMPS_S = [1716681600, 1716768000, 1716854400, 1716940800, 1717027200]
_EXPECTED_WALL_CLOCK = pd.to_datetime(_EXPECTED_TIMESTAMPS_S, unit="s")
_EXPECTED_CLOSES = [100.5, 101.5, 102.5, 103.5, 104.5]


def test_golden_parquet_exists() -> None:
    """The checked-in golden must exist; if not, the regen script
    was never run or the file was accidentally deleted. Run the
    regenerator (scripts/regen-ohlcv-golden-parquet.ts) to fix.
    """
    assert _GOLDEN_PATH.exists(), (
        f"Golden parquet missing at {_GOLDEN_PATH}. Run the "
        f"regenerator script: scripts/regen-ohlcv-golden-parquet.ts"
    )


def test_golden_parquet_loads_via_load_ohlcv() -> None:
    """End-to-end: real TS writer output -> canonical loader.

    The most important assertion in this file. If the writer's
    schema or the loader's promote logic drifts in a way that
    silently corrupts the wall clock, this test goes red.
    """
    df = load_ohlcv(_GOLDEN_PATH)
    assert isinstance(df.index, pd.DatetimeIndex)
    assert len(df) == len(_EXPECTED_TIMESTAMPS_S)
    # Index values match the regenerator's seed timestamps,
    # interpreted as Unix seconds. If the loader switched to ms,
    # the index would land in 1970 and this assert would fail.
    assert (df.index == _EXPECTED_WALL_CLOCK).all(), (
        f"Index drift: got {list(df.index)}, "
        f"expected {list(_EXPECTED_WALL_CLOCK)}"
    )
    # Index range is in plausible window (TICKET_813 invariant).
    # Implicitly tested by load_ohlcv not raising; explicit here so
    # the test reads as a single readable assertion table.
    assert df.index[0].year == 2024
    assert df.index[-1].year == 2024
    # Column values round-trip without precision loss for the
    # deterministic seed values.
    assert df["close"].tolist() == _EXPECTED_CLOSES
    # Post-promote shape: no 'timestamp' column (loader drops it).
    assert "timestamp" not in df.columns


def test_golden_parquet_index_is_utc_naive() -> None:
    """Loader produces a UTC-naive index regardless of any pandas
    parquet-reader metadata round-trips that might want to attach
    a tz. The slicer at fit_universe._fold_window_split has a
    tz-aware code path but the writer's column is UTC seconds with
    no explicit zone, so the loader keeps it tz-naive for
    consistency with the existing test fixtures.
    """
    df = load_ohlcv(_GOLDEN_PATH)
    assert df.index.tz is None
