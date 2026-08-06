"""
Unit tests for ``research_contracts.storage.eval_parquet_writer``.

Coverage:
    1. Happy path canonical_score / forward_return: file lands at
       ``signal_id={id}/run_id={r}/part.parquet`` and no ``.tmp`` remains.
    2. Orphan cleanup: a pre-existing ``run_id=*.tmp`` is removed.
    3. GC: a second write for a new run_id deletes older runs.
    4. Idempotency: re-writing the same (signal_id, run_id) yields the
       same row set.
    5. Contract: run_id <= 0 raises, signal_id <= 0 raises.
    6. EvalParquetWriteError exposes (table, signal_id, run_id, phase).
"""

from __future__ import annotations

import pytest
import pyarrow as pa
import pyarrow.parquet as pq

from research_contracts.storage import eval_parquet_writer as writer
from research_contracts.storage.eval_parquet_writer import (
    CanonicalScoreRow,
    EvalParquetWriteError,
    ForwardReturnRow,
    write_eval_parquet,
)


def _read_part(part_path):
    """Read one part.parquet file as a flat table.

    ``pq.read_table`` on a path under ``signal_id=N/run_id=M/`` auto-
    triggers Hive partition discovery and tries to merge the partition
    columns with the file's own ``signal_id`` / ``run_id`` columns,
    which conflicts (the file stores them as int64; the partition
    discovery sees them as dictionary<string>). The 947_2 reader will
    deliberately consume the Hive partition columns and drop the
    file's; for the writer tests we just want the raw file contents,
    so use ParquetFile directly.
    """
    return pq.ParquetFile(part_path).read()


def test_writes_canonical_score_with_expected_layout(tmp_path):
    rows = [
        CanonicalScoreRow(symbol="EURUSD", ts=1000, score=0.5, confidence=0.9),
        CanonicalScoreRow(symbol="EURUSD", ts=2000, score=-0.3, confidence=0.4),
        CanonicalScoreRow(symbol="GBPUSD", ts=1000, score=0.1, confidence=0.2),
    ]
    final_dir = write_eval_parquet(
        tmp_path, "canonical_score", 42, 7, rows, created_at_ms=1700000000000
    )

    signal_dir = tmp_path / "eval" / "canonical_score" / "signal_id=42"
    assert (signal_dir / "run_id=7").exists()
    assert not (signal_dir / "run_id=7.tmp").exists()
    assert final_dir == signal_dir / "run_id=7"

    part = final_dir / "part.parquet"
    assert part.exists()
    table = _read_part(part)
    assert table.num_rows == 3
    # Sorted by (symbol, ts).
    rec = table.to_pylist()
    assert rec[0]["symbol"] == "EURUSD"
    assert rec[0]["ts"] == 1000
    assert rec[0]["score"] == 0.5
    assert rec[2]["symbol"] == "GBPUSD"
    assert rec[0]["signal_id"] == 42
    assert rec[0]["created_at"] == 1700000000000


def test_writes_forward_return_with_horizon_bars(tmp_path):
    rows = [
        ForwardReturnRow(symbol="EURUSD", ts=1000, r_next=0.01, horizon_bars=1),
        ForwardReturnRow(symbol="EURUSD", ts=2000, r_next=-0.02, horizon_bars=1),
    ]
    write_eval_parquet(
        tmp_path, "forward_return", 5, 1, rows, created_at_ms=1700000000000
    )

    part = (
        tmp_path
        / "eval"
        / "forward_return"
        / "signal_id=5"
        / "run_id=1"
        / "part.parquet"
    )
    table = _read_part(part)
    rec = table.to_pylist()
    assert table.num_rows == 2
    assert rec[0]["r_next"] == 0.01
    assert rec[0]["horizon_bars"] == 1
    assert rec[0]["signal_id"] == 5


def test_cleans_orphan_tmp(tmp_path):
    signal_dir = tmp_path / "eval" / "canonical_score" / "signal_id=99"
    orphan = signal_dir / "run_id=3.tmp"
    orphan.mkdir(parents=True)
    (orphan / "part.parquet").write_bytes(b"corrupt")

    write_eval_parquet(
        tmp_path,
        "canonical_score",
        99,
        4,
        [CanonicalScoreRow(symbol="A", ts=1, score=0.0, confidence=1.0)],
    )

    entries = {p.name for p in signal_dir.iterdir()}
    assert "run_id=4" in entries
    assert "run_id=3.tmp" not in entries


def test_gc_drops_other_run_ids(tmp_path):
    write_eval_parquet(
        tmp_path,
        "canonical_score",
        11,
        1,
        [CanonicalScoreRow(symbol="A", ts=1, score=0.0, confidence=1.0)],
    )
    # Simulate a prior run 2 left over from another writer.
    signal_dir = tmp_path / "eval" / "canonical_score" / "signal_id=11"
    (signal_dir / "run_id=2").mkdir()
    (signal_dir / "run_id=2" / "part.parquet").write_bytes(b"placeholder")

    write_eval_parquet(
        tmp_path,
        "canonical_score",
        11,
        3,
        [CanonicalScoreRow(symbol="A", ts=1, score=0.0, confidence=1.0)],
    )

    entries = {p.name for p in signal_dir.iterdir()}
    assert entries == {"run_id=3"}


def test_idempotent_rewrite_same_signal_run(tmp_path):
    rows = [
        CanonicalScoreRow(symbol="A", ts=1, score=0.1, confidence=0.5),
        CanonicalScoreRow(symbol="A", ts=2, score=0.2, confidence=0.6),
    ]
    write_eval_parquet(
        tmp_path, "canonical_score", 7, 1, rows, created_at_ms=1700000000000
    )
    write_eval_parquet(
        tmp_path, "canonical_score", 7, 1, rows, created_at_ms=1700000000000
    )

    part = (
        tmp_path
        / "eval"
        / "canonical_score"
        / "signal_id=7"
        / "run_id=1"
        / "part.parquet"
    )
    table = _read_part(part)
    assert table.num_rows == 2


def test_run_id_must_be_positive(tmp_path):
    with pytest.raises(ValueError, match="run_id must be a positive integer"):
        write_eval_parquet(
            tmp_path,
            "canonical_score",
            1,
            0,
            [CanonicalScoreRow(symbol="A", ts=1, score=0.0, confidence=1.0)],
        )


def test_signal_id_must_be_positive(tmp_path):
    with pytest.raises(ValueError, match="signal_id must be a positive integer"):
        write_eval_parquet(
            tmp_path,
            "canonical_score",
            0,
            1,
            [CanonicalScoreRow(symbol="A", ts=1, score=0.0, confidence=1.0)],
        )


def test_eval_parquet_write_error_carries_context():
    err = EvalParquetWriteError(
        "canonical_score", 1, 2, "atomic_rename", RuntimeError("boom")
    )
    assert err.table == "canonical_score"
    assert err.signal_id == 1
    assert err.run_id == 2
    assert err.phase == "atomic_rename"
    assert "atomic_rename" in str(err)
    assert "boom" in str(err)


def test_resolve_executor_prefers_configured_file(tmp_path, monkeypatch):
    executable = tmp_path / "custom-executor"
    executable.write_bytes(b"binary")
    monkeypatch.setenv("STRATCRAFT_EXECUTOR", str(executable))

    assert writer._resolve_executor() == executable


def test_resolve_executor_falls_through_invalid_configuration(tmp_path, monkeypatch):
    repo_root = tmp_path / "repo"
    executable = repo_root / "packages" / "executor" / "build" / writer._EXECUTOR_NAME
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"binary")
    monkeypatch.setenv("STRATCRAFT_EXECUTOR", str(tmp_path / "missing"))
    monkeypatch.setattr(writer, "_REPO_ROOT", repo_root)

    assert writer._resolve_executor() == executable


def test_resolve_executor_fails_actionably_when_absent(tmp_path, monkeypatch):
    monkeypatch.delenv("STRATCRAFT_EXECUTOR", raising=False)
    monkeypatch.setattr(writer, "_REPO_ROOT", tmp_path)

    with pytest.raises(RuntimeError, match="rebuild through start.sh executor"):
        writer._resolve_executor()


@pytest.mark.parametrize("value", [True, 1.5, "1"])
def test_integer_contract_rejects_non_integer_values(value):
    with pytest.raises(ValueError, match="must be an integer"):
        writer._require_int(value, "field", positive=False)


@pytest.mark.parametrize(
    ("table", "row", "message"),
    [
        (
            "canonical_score",
            ForwardReturnRow("A", 1, 0.1, 1),
            "must be CanonicalScoreRow",
        ),
        (
            "canonical_score",
            CanonicalScoreRow("A", 1, float("nan"), 1.0),
            "score and confidence must be finite",
        ),
        (
            "forward_return",
            CanonicalScoreRow("A", 1, 0.1, 1.0),
            "must be ForwardReturnRow",
        ),
        (
            "forward_return",
            ForwardReturnRow("A", 1, float("inf"), 1),
            "r_next must be finite",
        ),
        (
            "forward_return",
            ForwardReturnRow("A", 1, 0.1, 0),
            "horizon_bars must be a positive integer",
        ),
        (
            "canonical_score",
            CanonicalScoreRow("A", 1, 0.1, 1.0, path_index=-2),
            "path_index must fit nullable int32",
        ),
        (
            "canonical_score",
            CanonicalScoreRow("A", 1, 0.1, 1.0, path_index=2_147_483_648),
            "path_index must fit nullable int32",
        ),
    ],
)
def test_row_encoding_contract_rejects_invalid_rows(tmp_path, table, row, message):
    with pytest.raises(ValueError, match=message):
        writer._write_rows(tmp_path / "rows.bin", table, [row])


def test_row_encoding_rejects_non_string_symbol(tmp_path):
    row = CanonicalScoreRow(symbol=1, ts=1, score=0.1, confidence=1.0)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="symbol must be a string"):
        writer._write_rows(tmp_path / "rows.bin", "canonical_score", [row])


def test_write_rejects_unknown_table_before_encoding(tmp_path):
    with pytest.raises(ValueError, match="unknown eval table"):
        write_eval_parquet(tmp_path, "unknown", 1, 1, [])  # type: ignore[arg-type]


def test_write_wraps_encoding_failure(tmp_path):
    row = CanonicalScoreRow(symbol="A", ts=True, score=0.1, confidence=1.0)
    with pytest.raises(EvalParquetWriteError) as raised:
        write_eval_parquet(tmp_path, "canonical_score", 1, 1, [row])

    assert raised.value.phase == "encode_rows"
    assert isinstance(raised.value.__cause__, ValueError)


@pytest.mark.parametrize(
    ("completed", "message"),
    [
        (
            writer.subprocess.CompletedProcess([], 9, stdout="", stderr="kernel failed"),
            "exited 9: kernel failed",
        ),
        (
            writer.subprocess.CompletedProcess(
                [],
                0,
                stdout='{"status":"error","version":"qnx.eval-parquet/1.0.0"}\n',
                stderr="",
            ),
            "unexpected C\\+\\+ response",
        ),
        (
            writer.subprocess.CompletedProcess([], 0, stdout="", stderr=""),
            "Expecting value",
        ),
    ],
)
def test_write_wraps_cpp_boundary_failures(tmp_path, monkeypatch, completed, message):
    executable = tmp_path / "executor"
    executable.write_bytes(b"binary")
    monkeypatch.setenv("STRATCRAFT_EXECUTOR", str(executable))
    monkeypatch.setattr(writer.subprocess, "run", lambda *args, **kwargs: completed)

    with pytest.raises(EvalParquetWriteError, match=message) as raised:
        write_eval_parquet(
            tmp_path,
            "canonical_score",
            1,
            1,
            [CanonicalScoreRow("A", 1, 0.1, 1.0)],
        )

    assert raised.value.phase == "invoke_cpp"


def test_cross_language_semantic_equivalence(tmp_path):
    """
    TICKET_947_1 cross-language contract: TS writer (snappy) and Python
    writer (zstd) produce parquet files whose pyarrow-readback tables
    are equal after stable sort. This test exercises only the Python
    side -- the cross-write parity check lives in 947_2 integration.
    """
    rows = [
        CanonicalScoreRow(symbol="A", ts=2, score=0.2, confidence=0.6),
        CanonicalScoreRow(symbol="A", ts=1, score=0.1, confidence=0.5),
    ]
    write_eval_parquet(
        tmp_path, "canonical_score", 1, 1, rows, created_at_ms=1700000000000
    )
    write_eval_parquet(
        tmp_path, "canonical_score", 1, 2, rows, created_at_ms=1700000000000
    )

    # After GC only run_id=2 survives; read it back, assert sort order
    # matches the contract.
    part = (
        tmp_path
        / "eval"
        / "canonical_score"
        / "signal_id=1"
        / "run_id=2"
        / "part.parquet"
    )
    table = _read_part(part)
    ts_list = table.column("ts").to_pylist()
    assert ts_list == sorted(ts_list)


# --- TICKET_1292 cut 07-C: path_index schema-parity column -----------------

_EXPECTED_CANONICAL_COLUMNS = {
    "signal_id",
    "symbol",
    "ts",
    "score",
    "confidence",
    "created_at",
    "path_index",
}
_EXPECTED_FORWARD_RETURN_COLUMNS = {
    "signal_id",
    "symbol",
    "ts",
    "r_next",
    "horizon_bars",
    "created_at",
    "path_index",
}


def test_canonical_score_carries_path_index_column_null_by_default(tmp_path):
    """cut 07-C: path_index is present (matches the TS writer) and null when
    the caller supplies no fold attribution (the ingest path)."""
    rows = [
        CanonicalScoreRow(symbol="EURUSD", ts=1000, score=0.5, confidence=0.9),
    ]
    write_eval_parquet(
        tmp_path, "canonical_score", 42, 1, rows, created_at_ms=1700000000000
    )
    part = (
        tmp_path / "eval" / "canonical_score" / "signal_id=42" / "run_id=1"
        / "part.parquet"
    )
    table = _read_part(part)
    assert set(table.schema.names) == _EXPECTED_CANONICAL_COLUMNS
    field = table.schema.field("path_index")
    assert field.type == pa.int32()
    assert field.nullable is True
    assert table.column("path_index").to_pylist() == [None]


def test_forward_return_carries_path_index_column_null_by_default(tmp_path):
    rows = [
        ForwardReturnRow(symbol="EURUSD", ts=1000, r_next=0.01, horizon_bars=1),
    ]
    write_eval_parquet(
        tmp_path, "forward_return", 5, 1, rows, created_at_ms=1700000000000
    )
    part = (
        tmp_path / "eval" / "forward_return" / "signal_id=5" / "run_id=1"
        / "part.parquet"
    )
    table = _read_part(part)
    assert set(table.schema.names) == _EXPECTED_FORWARD_RETURN_COLUMNS
    assert table.schema.field("path_index").type == pa.int32()
    assert table.column("path_index").to_pylist() == [None]


def test_path_index_round_trips_when_supplied(tmp_path):
    """When a fold-attributed caller supplies path_index, it persists as an
    int32 per row -- the TICKET_1133 walk-forward fold value."""
    rows = [
        CanonicalScoreRow(
            symbol="EURUSD", ts=1000, score=0.5, confidence=0.9, path_index=0
        ),
        CanonicalScoreRow(
            symbol="EURUSD", ts=2000, score=0.4, confidence=0.8, path_index=2
        ),
    ]
    write_eval_parquet(
        tmp_path, "canonical_score", 42, 1, rows, created_at_ms=1700000000000
    )
    part = (
        tmp_path / "eval" / "canonical_score" / "signal_id=42" / "run_id=1"
        / "part.parquet"
    )
    table = _read_part(part)
    # Sorted by (symbol, ts): ts=1000 -> path 0, ts=2000 -> path 2.
    assert table.column("path_index").to_pylist() == [0, 2]
