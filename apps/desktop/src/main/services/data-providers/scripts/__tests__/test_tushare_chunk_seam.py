"""
Chunk-seam contract test for tushare_query.py.

TICKET_958 C2: every QuantNexus provider script treats `end_date` as
INCLUSIVE -- the bar dated `end_date` MUST appear in the output when the
underlying data source has it.

Tushare Pro's `daily(end_date=...)` is closed (inclusive), so the script
does NOT need an inclusive->exclusive shift. This test pins that
contract: the `end_date` bar appears in the output, and a two-chunk
replay unions to both days with no seam dropout.

Run with:
  pytest apps/desktop/src/main/services/data-providers/scripts/__tests__/test_tushare_chunk_seam.py
"""

import importlib.util
import io
import json
import sys
from contextlib import redirect_stdout
from datetime import datetime
from pathlib import Path

import pytest

# TICKET_958_5 AC #6 -- canonical-stdout schema pin (shared helper).
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _canonical_stdout_pin import assert_canonical_stdout_rows  # noqa: E402


SCRIPT_DIR = Path(__file__).resolve().parent.parent
SCRIPT_PATH = SCRIPT_DIR / "tushare_query.py"


class _StubTushareDataFrame:
    """Mimics the slice of the Tushare Pro daily DataFrame that the script
    consumes: .empty, .iterrows() yielding rows with dict-style access for
    trade_date / open / high / low / close / vol.
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


class _StubProApi:
    def __init__(self, rows: list[dict]):
        self._rows = rows

    def daily(self, **kwargs):
        _Recorder.last_kwargs = dict(kwargs)
        start = kwargs["start_date"]
        end = kwargs["end_date"]
        filtered = [r for r in self._rows if start <= str(r["trade_date"]) <= end]
        return _StubTushareDataFrame(filtered)


def _load_module(monkeypatch, rows: list[dict]):
    """Load tushare_query and replace _get_pro_api so the script never
    touches the real `tushare` package.
    """
    spec = importlib.util.spec_from_file_location("tushare_query", SCRIPT_PATH)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    monkeypatch.setattr(mod, "_get_pro_api", lambda token: _StubProApi(rows))
    return mod


@pytest.fixture
def rows():
    return [
        {"trade_date": "20260128", "open": 100.0, "high": 100.5, "low": 99.5, "close": 100.2, "vol": 1000.0},
        {"trade_date": "20260129", "open": 100.2, "high": 100.7, "low": 99.7, "close": 100.4, "vol": 1100.0},
        {"trade_date": "20260130", "open": 100.4, "high": 100.9, "low": 99.9, "close": 100.6, "vol": 1200.0},
    ]


def test_query_ohlcv_passes_inclusive_end_date_unchanged(monkeypatch, rows):
    """Tushare's daily() is end-inclusive. The script must pass end_date
    through verbatim (in YYYYMMDD form) -- no off-by-one shift.
    """
    _Recorder.last_kwargs = {}
    mod = _load_module(monkeypatch, rows)
    buf = io.StringIO()
    with redirect_stdout(buf):
        mod.query_ohlcv("600000.SH", "daily", "2026-01-28", "2026-01-29", token="fake-token")

    end_kwarg = _Recorder.last_kwargs.get("end_date")
    assert end_kwarg == "20260129", (
        "Tushare Pro daily() is end-inclusive. The script must pass end_date "
        f"unchanged (as 20260129); got {end_kwarg!r}."
    )


def test_query_ohlcv_includes_end_date_bar(monkeypatch, rows):
    mod = _load_module(monkeypatch, rows)
    buf = io.StringIO()
    with redirect_stdout(buf):
        mod.query_ohlcv("600000.SH", "daily", "2026-01-28", "2026-01-29", token="fake-token")
    out = json.loads(buf.getvalue())

    expected_end_ts = int(datetime(2026, 1, 29).timestamp())
    timestamps = {r["timestamp"] for r in out}
    assert expected_end_ts in timestamps, (
        f"end-inclusive contract violation: bar dated 2026-01-29 missing. "
        f"Got timestamps: {sorted(timestamps)}"
    )


def test_query_ohlcv_chunk_boundary_no_dropouts(monkeypatch, rows):
    mod = _load_module(monkeypatch, rows)

    buf1 = io.StringIO()
    with redirect_stdout(buf1):
        mod.query_ohlcv("600000.SH", "daily", "2026-01-28", "2026-01-28", token="fake-token")
    chunk1 = json.loads(buf1.getvalue())

    buf2 = io.StringIO()
    with redirect_stdout(buf2):
        mod.query_ohlcv("600000.SH", "daily", "2026-01-29", "2026-01-29", token="fake-token")
    chunk2 = json.loads(buf2.getvalue())

    assert len(chunk1) == 1, f"chunk1 should return the Jan 28 bar; got {chunk1}"
    assert len(chunk2) == 1, f"chunk2 should return the Jan 29 bar; got {chunk2}"
    union_ts = {r["timestamp"] for r in chunk1} | {r["timestamp"] for r in chunk2}
    assert union_ts == {
        int(datetime(2026, 1, 28).timestamp()),
        int(datetime(2026, 1, 29).timestamp()),
    }, f"chunk-seam dropout: union should cover both days; got {sorted(union_ts)}"


def test_query_ohlcv_emits_canonical_stdout_schema(monkeypatch, rows):
    """TICKET_958_5 AC #6: see _canonical_stdout_pin.py for the rationale.
    Tushare's upstream emits `trade_date` (YYYYMMDD string) and `vol`
    (NOT `volume`); the script MUST rename and unit-convert to canonical
    `[timestamp, open, high, low, close, volume]` with integer-seconds
    `timestamp` before json.dumps.
    """
    mod = _load_module(monkeypatch, rows)
    buf = io.StringIO()
    with redirect_stdout(buf):
        mod.query_ohlcv("600000.SH", "daily", "2026-01-28", "2026-01-29", token="fake-token")
    out = json.loads(buf.getvalue())
    assert len(out) > 0, "fixture produced empty output -- pin needs rows"
    assert_canonical_stdout_rows(out)
