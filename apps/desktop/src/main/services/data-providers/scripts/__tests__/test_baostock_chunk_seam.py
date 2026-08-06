"""
Chunk-seam contract test for baostock_query.py.

TICKET_958 C2: every QuantNexus provider script treats `end_date` as
INCLUSIVE -- the bar dated `end_date` MUST appear in the output when the
underlying data source has it.

baostock's `query_history_k_data_plus(end_date=...)` is closed (inclusive),
so the script does NOT need an inclusive->exclusive shift. This test pins
that contract: the `end_date` bar appears in the output, and a two-chunk
replay unions to both days with no seam dropout.

Run with:
  pytest apps/desktop/src/main/services/data-providers/scripts/__tests__/test_baostock_chunk_seam.py
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
SCRIPT_PATH = SCRIPT_DIR / "baostock_query.py"


class _StubLoginResult:
    def __init__(self):
        self.error_code = "0"
        self.error_msg = ""


class _StubResultSet:
    """Mimics baostock's row-walker: rs.next() returns True while more rows
    remain, then False; rs.get_row_data() returns the current row's fields
    in the order requested by `fields=` on the query.
    """

    def __init__(self, rows: list[list[str]]):
        self._rows = rows
        self._idx = -1
        self.error_code = "0"
        self.error_msg = ""

    def next(self):
        self._idx += 1
        return self._idx < len(self._rows)

    def get_row_data(self):
        return self._rows[self._idx]


class _Recorder:
    last_kwargs: dict = {}


def _make_stub_module(rows_by_date: dict[str, list[str]]) -> types.ModuleType:
    """Build a fake `baostock` module that emits the requested daily rows
    filtered by the inclusive [start_date, end_date] window, and records
    the kwargs the script passed.
    """
    fake = types.ModuleType("baostock")

    def login():
        return _StubLoginResult()

    def logout():
        return _StubLoginResult()

    def query_history_k_data_plus(symbol, fields, **kwargs):
        _Recorder.last_kwargs = dict(kwargs)
        start = kwargs["start_date"]
        end = kwargs["end_date"]
        # Daily rows: [date, open, high, low, close, volume, amount]
        filtered = [r for r in rows_by_date.values() if start <= r[0] <= end]
        return _StubResultSet(filtered)

    fake.login = login
    fake.logout = logout
    fake.query_history_k_data_plus = query_history_k_data_plus
    return fake


@pytest.fixture
def stub_baostock(monkeypatch):
    rows = {
        "2026-01-28": ["2026-01-28", "100.0", "100.5", "99.5", "100.2", "1000", "100200"],
        "2026-01-29": ["2026-01-29", "100.2", "100.7", "99.7", "100.4", "1100", "110440"],
        "2026-01-30": ["2026-01-30", "100.4", "100.9", "99.9", "100.6", "1200", "120720"],
    }
    fake = _make_stub_module(rows)
    monkeypatch.setitem(sys.modules, "baostock", fake)
    _Recorder.last_kwargs = {}
    yield fake


def _load_module():
    spec = importlib.util.spec_from_file_location("baostock_query", SCRIPT_PATH)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_query_ohlcv_passes_inclusive_end_date_unchanged(stub_baostock):
    """baostock's query_history_k_data_plus is end-inclusive. The script
    must pass end_date through verbatim -- no off-by-one shift.
    """
    mod = _load_module()
    buf = io.StringIO()
    with redirect_stdout(buf):
        mod.query_ohlcv("sh.600000", "d", "2026-01-28", "2026-01-29")

    end_kwarg = _Recorder.last_kwargs.get("end_date")
    assert end_kwarg == "2026-01-29", (
        "baostock's query_history_k_data_plus is end-inclusive; the script "
        f"must pass end_date unchanged. Got {end_kwarg!r}."
    )


def test_query_ohlcv_includes_end_date_bar(stub_baostock):
    mod = _load_module()
    buf = io.StringIO()
    with redirect_stdout(buf):
        mod.query_ohlcv("sh.600000", "d", "2026-01-28", "2026-01-29")
    rows = json.loads(buf.getvalue())

    expected_end_ts = int(datetime(2026, 1, 29).timestamp())
    timestamps = {r["timestamp"] for r in rows}
    assert expected_end_ts in timestamps, (
        f"end-inclusive contract violation: bar dated 2026-01-29 missing. "
        f"Got timestamps: {sorted(timestamps)}"
    )


def test_query_ohlcv_chunk_boundary_no_dropouts(stub_baostock):
    mod = _load_module()

    buf1 = io.StringIO()
    with redirect_stdout(buf1):
        mod.query_ohlcv("sh.600000", "d", "2026-01-28", "2026-01-28")
    chunk1 = json.loads(buf1.getvalue())

    buf2 = io.StringIO()
    with redirect_stdout(buf2):
        mod.query_ohlcv("sh.600000", "d", "2026-01-29", "2026-01-29")
    chunk2 = json.loads(buf2.getvalue())

    assert len(chunk1) == 1, f"chunk1 should return the Jan 28 bar; got {chunk1}"
    assert len(chunk2) == 1, f"chunk2 should return the Jan 29 bar; got {chunk2}"
    union_ts = {r["timestamp"] for r in chunk1} | {r["timestamp"] for r in chunk2}
    assert union_ts == {
        int(datetime(2026, 1, 28).timestamp()),
        int(datetime(2026, 1, 29).timestamp()),
    }, f"chunk-seam dropout: union should cover both days; got {sorted(union_ts)}"


def test_query_ohlcv_emits_canonical_stdout_schema(stub_baostock):
    """TICKET_958_5 AC #6: see _canonical_stdout_pin.py for the rationale.
    baostock's upstream emits a `time` STRING column ("20260128090000000"
    style) and `date` separately -- the script MUST convert and rename
    these to the canonical integer-seconds `timestamp` key before
    json.dumps.
    """
    mod = _load_module()
    buf = io.StringIO()
    with redirect_stdout(buf):
        mod.query_ohlcv("sh.600000", "d", "2026-01-28", "2026-01-29")
    rows = json.loads(buf.getvalue())
    assert len(rows) > 0, "fixture produced empty output -- pin needs rows"
    assert_canonical_stdout_rows(rows)
