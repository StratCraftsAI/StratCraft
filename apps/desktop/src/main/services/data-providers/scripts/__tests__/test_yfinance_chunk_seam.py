"""
Chunk-seam contract test for yfinance_query.py.

TICKET_958 C2: every QuantNexus provider script treats `end_date` as
INCLUSIVE -- the bar dated `end_date` MUST appear in the output when the
underlying data source has it. yfinance's `Ticker.history(end=...)` is
natively EXCLUSIVE, so the script must convert inclusive -> exclusive
before calling yfinance, otherwise N chunks lose N trading days at the
chunk seams (the exact cover-not-intersect bypass TICKET_958 closes).

Probes:
  1. The kwarg `end=` passed to `yf.Ticker.history` is `end_date + 1 day`.
  2. A two-chunk replay [Jan 28, Jan 28] + [Jan 29, Jan 29] produces the
     union of all rows -- no row lost at the chunk seam.

Run with:
  pytest apps/desktop/src/main/services/data-providers/scripts/__tests__/test_yfinance_chunk_seam.py
"""

import importlib.util
import io
import json
import sys
import types
from contextlib import redirect_stdout
from datetime import datetime
from pathlib import Path

import pytest

# TICKET_958_5 AC #6 -- canonical-stdout schema pin (shared helper).
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _canonical_stdout_pin import assert_canonical_stdout_rows  # noqa: E402


SCRIPT_DIR = Path(__file__).resolve().parent.parent
SCRIPT_PATH = SCRIPT_DIR / "yfinance_query.py"


class _StubBar:
    def __init__(self, ts: datetime, o: float, h: float, low: float, c: float, v: float):
        self.timestamp = ts
        self.open = o
        self.high = h
        self.low = low
        self.close = c
        self.volume = v


class _StubDataFrame:
    """Minimal DataFrame stand-in for the rows that query_ohlcv iterates over.

    We don't need pandas at all -- the script only uses .empty, .iterrows(),
    and dict-style column access (row["Open"] etc.). Implementing those three
    surfaces directly lets the test run without importing pandas just to build
    a fixture.
    """

    def __init__(self, bars: list[_StubBar]):
        self._bars = bars

    @property
    def empty(self) -> bool:
        return not self._bars

    def iterrows(self):
        for b in self._bars:
            yield b.timestamp, {
                "Open": b.open,
                "High": b.high,
                "Low": b.low,
                "Close": b.close,
                "Volume": b.volume,
            }


class _StubTimestamp:
    """idx in iterrows -- needs .timestamp() returning unix seconds."""

    def __init__(self, dt: datetime):
        self._dt = dt

    def timestamp(self) -> float:
        return self._dt.timestamp()


class _RecordingTicker:
    """Captures the history(end=...) kwarg the script passes."""

    last_kwargs: dict = {}

    def __init__(self, symbol: str):
        self.symbol = symbol

    def history(self, **kwargs):
        _RecordingTicker.last_kwargs = dict(kwargs)
        # Build a single bar dated on the INCLUSIVE end_date the caller asked
        # for. yfinance would only emit it if end= is the day AFTER. So the
        # test stub only emits rows whose date is strictly less than the
        # exclusive end passed in -- that's the actual yfinance semantics.
        start = datetime.strptime(kwargs["start"], "%Y-%m-%d")
        end_exclusive = datetime.strptime(kwargs["end"], "%Y-%m-%d")
        bars = []
        d = start
        while d < end_exclusive:
            wrapped_ts = _StubTimestamp(d)
            bars.append(_StubBar(wrapped_ts, 100.0, 100.5, 99.5, 100.2, 1000.0))
            d = datetime.fromordinal(d.toordinal() + 1)
        return _StubDataFrame(bars)


@pytest.fixture
def stub_yfinance(monkeypatch):
    """Install a fake `yfinance` module before query_ohlcv imports it."""
    fake = types.ModuleType("yfinance")
    fake.Ticker = _RecordingTicker
    monkeypatch.setitem(sys.modules, "yfinance", fake)
    _RecordingTicker.last_kwargs = {}
    yield fake


def _load_module():
    spec = importlib.util.spec_from_file_location("yfinance_query", SCRIPT_PATH)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_query_ohlcv_translates_inclusive_end_to_exclusive_end(stub_yfinance):
    """The kwarg passed to yfinance must be end_date + 1 day."""
    mod = _load_module()
    buf = io.StringIO()
    with redirect_stdout(buf):
        mod.query_ohlcv("IBM", "1d", "2026-01-28", "2026-01-29")

    captured_end = _RecordingTicker.last_kwargs.get("end")
    assert captured_end == "2026-01-30", (
        "yfinance's `Ticker.history(end=...)` is EXCLUSIVE. The script must "
        "convert the caller's inclusive end_date (2026-01-29) to the day after "
        "(2026-01-30) before calling yfinance, otherwise the 2026-01-29 bar "
        f"is silently dropped at every chunk seam. Got end={captured_end!r}."
    )


def test_query_ohlcv_includes_end_date_bar(stub_yfinance):
    """The bar dated end_date must appear in the output (end-inclusive contract)."""
    mod = _load_module()
    buf = io.StringIO()
    with redirect_stdout(buf):
        mod.query_ohlcv("IBM", "1d", "2026-01-28", "2026-01-29")
    rows = json.loads(buf.getvalue())

    expected_end_ts = int(datetime(2026, 1, 29).timestamp())
    timestamps = {r["timestamp"] for r in rows}
    assert expected_end_ts in timestamps, (
        f"end-inclusive contract violation: bar dated 2026-01-29 (ts={expected_end_ts}) "
        f"missing from output. Got timestamps: {sorted(timestamps)}"
    )


def test_query_ohlcv_chunk_boundary_no_dropouts(stub_yfinance):
    """Regression guard: two adjacent single-day chunks must union to both days.

    Before the C2 fix, chunk1 [Jan 28, Jan 28] returned 0 rows because
    yfinance's exclusive end= dropped the only bar in the window. This test
    asserts both chunks produce their respective bars and the union covers
    both days.
    """
    mod = _load_module()

    buf1 = io.StringIO()
    with redirect_stdout(buf1):
        mod.query_ohlcv("IBM", "1d", "2026-01-28", "2026-01-28")
    chunk1 = json.loads(buf1.getvalue())

    buf2 = io.StringIO()
    with redirect_stdout(buf2):
        mod.query_ohlcv("IBM", "1d", "2026-01-29", "2026-01-29")
    chunk2 = json.loads(buf2.getvalue())

    assert len(chunk1) == 1, f"chunk1 should return the Jan 28 bar; got {chunk1}"
    assert len(chunk2) == 1, f"chunk2 should return the Jan 29 bar; got {chunk2}"
    union_ts = {r["timestamp"] for r in chunk1} | {r["timestamp"] for r in chunk2}
    assert union_ts == {
        int(datetime(2026, 1, 28).timestamp()),
        int(datetime(2026, 1, 29).timestamp()),
    }, f"chunk-seam dropout: union should cover both days; got {sorted(union_ts)}"


def test_query_ohlcv_emits_canonical_stdout_schema(stub_yfinance):
    """TICKET_958_5 AC #6: see _canonical_stdout_pin.py for the rationale.
    yfinance's upstream emits a pandas-style `Datetime` index and capital-
    cased column names (`Open`, `Volume`, ...); the script MUST rename to
    canonical lower-case `[timestamp, open, high, low, close, volume]`
    with integer-seconds `timestamp` before json.dumps.
    """
    mod = _load_module()
    buf = io.StringIO()
    with redirect_stdout(buf):
        mod.query_ohlcv("IBM", "1d", "2026-01-28", "2026-01-29")
    rows = json.loads(buf.getvalue())
    assert len(rows) > 0, "fixture produced empty output -- pin needs rows"
    assert_canonical_stdout_rows(rows)
