"""
TICKET_958_5 AC #6 -- shared canonical-stdout schema pin.

The Electron-side cache write boundary commits parquet rows in the
canonical OHLCV_V1_CANONICAL schema (`OHLCV_SCHEMA` in
ohlcv-parquet-schema.ts). Every Python provider script
(`databento_query.py`, `yfinance_query.py`, `akshare_query.py`,
`baostock_query.py`, `tushare_query.py`) is the producer side of that
contract: its stdout JSON list MUST be a list of objects with EXACTLY
the keys `[timestamp, open, high, low, close, volume]` in that order,
where `timestamp` is `int` (Unix seconds, NOT milliseconds, NOT
nanoseconds, NOT an ISO string) and OHLCV are `float`.

This module is the single source of truth for that assertion. Each
script's chunk-seam test imports `assert_canonical_stdout_rows` and
calls it on its existing `query_ohlcv -> json.loads(stdout)` output.
A script that drifts (e.g. emits `ts_event` instead of `timestamp`,
or `Datetime`, or a millisecond integer) fails its provider's existing
test instead of waiting for a downstream Electron-side schema-mismatch
crash.

The canonical key order matches `OHLCV_SCHEMA` in
ohlcv-parquet-schema.ts. The order matters for `OrderedDict` JSON dumps
but NOT for regular dict serialisation -- Python's `json.dumps` of a
plain dict preserves insertion order from 3.7+, and the Electron-side
writer reorders columns at the schema layer anyway. The key-set
assertion is what protects the read path; the order assertion is
documentation that catches "someone added a column" drift.
"""

from __future__ import annotations

from typing import Any, Iterable

CANONICAL_KEYS: tuple[str, ...] = (
    "timestamp",
    "open",
    "high",
    "low",
    "close",
    "volume",
)


def assert_canonical_stdout_rows(rows: Iterable[Any]) -> None:
    """Raise AssertionError with a TICKET_958_5 AC #6 prefix if any row in
    `rows` violates the canonical-stdout contract.

    Contract:
      - Every element is a dict.
      - Every element has EXACTLY the keys in `CANONICAL_KEYS` (no
        extra, no missing).
      - `timestamp` is `int` (Unix seconds; sanity-bounded so a
        millisecond / nanosecond timestamp trips a clear failure).
      - `open`, `high`, `low`, `close`, `volume` are `int` or `float`
        (Python's `json.loads` may parse integer-valued floats as
        ints; both are acceptable).

    The function returns nothing; it raises on the first violation
    with a message naming the row index, key, and observed type so a
    failing CI run says exactly what drifted.
    """
    rows_list = list(rows)
    if not rows_list:
        # Empty output is a separate concern (the script's downstream
        # contract is to ALSO be allowed to emit an empty list when the
        # window covers no bars). The schema pin has nothing to assert
        # on emptiness -- return silently. Callers that want a non-empty
        # check should add their own `assert len(rows) > 0` next to the
        # canonical pin call.
        return

    for idx, row in enumerate(rows_list):
        assert isinstance(row, dict), (
            f"TICKET_958_5 AC #6: row[{idx}] is not a dict: "
            f"type={type(row).__name__}, value={row!r}"
        )
        observed_keys = tuple(row.keys())
        assert set(observed_keys) == set(CANONICAL_KEYS), (
            f"TICKET_958_5 AC #6: row[{idx}] key-set drift. "
            f"expected={CANONICAL_KEYS}, observed={observed_keys}. "
            f"Every provider script's stdout JSON list MUST emit the "
            f"canonical OHLCV_V1_CANONICAL key-set; a script that emits "
            f"`ts_event` / `Datetime` / `date` / `bar_count` / `vwap` "
            f"would break the Electron-side canonical writer."
        )

        ts = row["timestamp"]
        assert isinstance(ts, int) and not isinstance(ts, bool), (
            f"TICKET_958_5 AC #6: row[{idx}].timestamp is not int. "
            f"type={type(ts).__name__}, value={ts!r}. The canonical "
            f"timestamp unit is integer Unix SECONDS; floats / ISO "
            f"strings / pandas Timestamps would silently break the "
            f"DuckDB gate's `WHERE \"timestamp\" >= ?` SQL."
        )
        # Sanity bound: Unix seconds for the range this project covers
        # (1990-01-01 .. 2100-01-01) fit in [6.3e8, 4.1e9]. A timestamp
        # in milliseconds (~1.7e12) or nanoseconds (~1.7e18) would
        # blow this bound, so a unit drift trips clearly.
        assert 6_000_000_000 > ts >= 600_000_000, (
            f"TICKET_958_5 AC #6: row[{idx}].timestamp={ts} is outside "
            f"the Unix-seconds sanity bound [6e8, 6e9). This usually "
            f"means the script emitted milliseconds (e.g. ~1.7e12) or "
            f"nanoseconds (~1.7e18) instead of seconds."
        )

        for col in ("open", "high", "low", "close", "volume"):
            v = row[col]
            # Allow int OR float -- json.loads may parse `100` as int and
            # `100.0` as float; both are valid OHLCV values. Reject bool
            # explicitly because `isinstance(True, int) is True`.
            assert isinstance(v, (int, float)) and not isinstance(v, bool), (
                f"TICKET_958_5 AC #6: row[{idx}].{col} is not numeric. "
                f"type={type(v).__name__}, value={v!r}"
            )
