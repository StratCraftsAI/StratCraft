"""
Chunk-seam contract test for akshare_query.py.

TICKET_958 C2: every QuantNexus provider script treats `end_date` as
INCLUSIVE -- the bar dated `end_date` MUST appear in the output when the
underlying data source has it.

akshare's `stock_zh_a_daily(end_date=...)` is closed (inclusive), so the
script does NOT need an inclusive->exclusive shift. This test pins that
contract: the `end_date` bar appears in the output, and a two-chunk
replay unions to both days with no seam dropout.

Run with:
  pytest apps/desktop/src/main/services/data-providers/scripts/__tests__/test_akshare_chunk_seam.py
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
SCRIPT_PATH = SCRIPT_DIR / "akshare_query.py"


class _StubAksharerDataFrame:
    """Minimal DataFrame stand-in matching the columns akshare returns for
    `stock_zh_a_daily`: date,open,high,low,close,volume.
    """

    def __init__(self, rows: list[dict]):
        self._rows = rows

    @property
    def empty(self) -> bool:
        return not self._rows

    def iterrows(self):
        for idx, r in enumerate(self._rows):
            yield idx, r


class _Recorder:
    last_kwargs: dict = {}


def _make_stub_module(rows: list[dict]) -> types.ModuleType:
    """Build a fake `akshare` module that emits the requested rows from
    `stock_zh_a_daily` and records the kwargs it received.
    """
    fake = types.ModuleType("akshare")

    def stock_zh_a_daily(**kwargs):
        _Recorder.last_kwargs = dict(kwargs)
        # Apply the inclusive [start_date, end_date] window the way akshare
        # actually does -- both bounds included.
        start = kwargs["start_date"]
        end = kwargs["end_date"]
        filtered = [
            r for r in rows
            if start <= r["date"].replace("-", "") <= end
        ]
        return _StubAksharerDataFrame(filtered)

    fake.stock_zh_a_daily = stock_zh_a_daily
    return fake


@pytest.fixture
def stub_akshare(monkeypatch):
    rows = [
        {"date": "2026-01-28", "open": 100.0, "high": 100.5, "low": 99.5, "close": 100.2, "volume": 1000.0},
        {"date": "2026-01-29", "open": 100.2, "high": 100.7, "low": 99.7, "close": 100.4, "volume": 1100.0},
        {"date": "2026-01-30", "open": 100.4, "high": 100.9, "low": 99.9, "close": 100.6, "volume": 1200.0},
    ]
    fake = _make_stub_module(rows)
    monkeypatch.setitem(sys.modules, "akshare", fake)
    _Recorder.last_kwargs = {}
    yield fake


def _load_module():
    spec = importlib.util.spec_from_file_location("akshare_query", SCRIPT_PATH)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_query_ohlcv_passes_inclusive_end_date_unchanged(stub_akshare):
    """akshare's daily API is closed, so the script must pass end_date as-is
    (in YYYYMMDD form). No off-by-one shift in either direction.
    """
    mod = _load_module()
    buf = io.StringIO()
    with redirect_stdout(buf):
        mod.query_ohlcv("600000.SH", "daily", "2026-01-28", "2026-01-29")

    end_kwarg = _Recorder.last_kwargs.get("end_date")
    assert end_kwarg == "20260129", (
        "akshare's stock_zh_a_daily is end-inclusive. The script must pass the "
        f"caller's end_date unchanged (as 20260129); got {end_kwarg!r}."
    )


def test_query_ohlcv_includes_end_date_bar(stub_akshare):
    mod = _load_module()
    buf = io.StringIO()
    with redirect_stdout(buf):
        mod.query_ohlcv("600000.SH", "daily", "2026-01-28", "2026-01-29")
    rows = json.loads(buf.getvalue())

    expected_end_ts = int(datetime(2026, 1, 29).timestamp())
    timestamps = {r["timestamp"] for r in rows}
    assert expected_end_ts in timestamps, (
        f"end-inclusive contract violation: bar dated 2026-01-29 missing. "
        f"Got timestamps: {sorted(timestamps)}"
    )


def test_query_ohlcv_chunk_boundary_no_dropouts(stub_akshare):
    mod = _load_module()

    buf1 = io.StringIO()
    with redirect_stdout(buf1):
        mod.query_ohlcv("600000.SH", "daily", "2026-01-28", "2026-01-28")
    chunk1 = json.loads(buf1.getvalue())

    buf2 = io.StringIO()
    with redirect_stdout(buf2):
        mod.query_ohlcv("600000.SH", "daily", "2026-01-29", "2026-01-29")
    chunk2 = json.loads(buf2.getvalue())

    assert len(chunk1) == 1, f"chunk1 should return the Jan 28 bar; got {chunk1}"
    assert len(chunk2) == 1, f"chunk2 should return the Jan 29 bar; got {chunk2}"
    union_ts = {r["timestamp"] for r in chunk1} | {r["timestamp"] for r in chunk2}
    assert union_ts == {
        int(datetime(2026, 1, 28).timestamp()),
        int(datetime(2026, 1, 29).timestamp()),
    }, f"chunk-seam dropout: union should cover both days; got {sorted(union_ts)}"


def test_query_ohlcv_emits_canonical_stdout_schema(stub_akshare):
    """TICKET_958_5 AC #6: every provider script's stdout JSON list MUST
    be a list of objects with exactly the canonical OHLCV_V1_CANONICAL
    keys -- `[timestamp, open, high, low, close, volume]` -- where
    `timestamp` is integer Unix seconds. The internal upstream column
    names (akshare's `date` index, baostock's `time` string, tushare's
    `trade_date`, yfinance's `Datetime`) must be renamed and
    unit-converted INSIDE the script before emit. The Electron-side
    canonical writer (`atomicWriteParquet(OHLCV_SCHEMA, rows)`) assumes
    these keys; a drift here breaks the universe min-bars gate's SQL
    `WHERE \"timestamp\" >= ?` silently.
    """
    mod = _load_module()
    buf = io.StringIO()
    with redirect_stdout(buf):
        mod.query_ohlcv("600000.SH", "daily", "2026-01-28", "2026-01-29")
    rows = json.loads(buf.getvalue())
    assert len(rows) > 0, "fixture produced empty output -- pin needs rows"
    assert_canonical_stdout_rows(rows)
