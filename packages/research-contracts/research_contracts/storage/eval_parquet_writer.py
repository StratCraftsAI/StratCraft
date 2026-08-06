"""Thin Python adapter for the C++ eval Parquet owner.

TICKET_1292_07 owns the C++ data plane. TICKET_1304_5A extracts this bounded
adapter from the commercial research implementation.
"""

from __future__ import annotations

import dataclasses
import json
import math
import os
import struct
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Literal, Optional, Sequence


EvalParquetTable = Literal["canonical_score", "forward_return"]
EvalParquetWritePhase = Literal["encode_rows", "invoke_cpp"]

_CONTRACT_VERSION = "qnx.eval-parquet/1.0.0"
_ROW_MAGIC = b"QNXEVL10"
_TABLE_CODE: dict[EvalParquetTable, int] = {
    "canonical_score": 1,
    "forward_return": 2,
}
_EXECUTOR_NAME = "StratCraft-executor.exe" if os.name == "nt" else "StratCraft-executor"
_PACKAGE_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = _PACKAGE_ROOT.parent.parent


class EvalParquetWriteError(Exception):
    """Structured failure propagated by the C++ writer boundary."""

    def __init__(
        self,
        table: EvalParquetTable,
        signal_id: int,
        run_id: int,
        phase: EvalParquetWritePhase,
        cause: BaseException,
    ) -> None:
        self.table = table
        self.signal_id = signal_id
        self.run_id = run_id
        self.phase = phase
        super().__init__(
            f"[eval-parquet-writer] {table} write failed: "
            f"signal_id={signal_id} run_id={run_id} phase={phase}: {cause!s}"
        )


@dataclasses.dataclass(frozen=True)
class CanonicalScoreRow:
    symbol: str
    ts: int
    score: float
    confidence: float
    path_index: Optional[int] = None


@dataclasses.dataclass(frozen=True)
class ForwardReturnRow:
    symbol: str
    ts: int
    r_next: float
    horizon_bars: int
    path_index: Optional[int] = None


def _resolve_executor() -> Path:
    configured = os.environ.get("STRATCRAFT_EXECUTOR")
    if configured:
        path = Path(configured)
        if path.is_file():
            return path
    dev_path = _REPO_ROOT / "packages" / "executor" / "build" / _EXECUTOR_NAME
    if dev_path.is_file():
        return dev_path
    raise RuntimeError(
        "StratCraft-executor not resolved; rebuild through start.sh executor "
        f"or set STRATCRAFT_EXECUTOR (looked for {dev_path})"
    )


def _require_int(value: object, field: str, *, positive: bool) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{field} must be an integer; got {value!r}")
    if positive and value <= 0:
        raise ValueError(f"{field} must be a positive integer; got {value}")
    return value


def _write_symbol(output: object, symbol: str) -> None:
    if not isinstance(symbol, str):
        raise ValueError("symbol must be a string")
    encoded = symbol.encode("utf-8")
    output.write(struct.pack("<I", len(encoded)))
    output.write(encoded)


def _write_rows(
    path: Path,
    table: EvalParquetTable,
    rows: Sequence[CanonicalScoreRow] | Sequence[ForwardReturnRow],
) -> None:
    with path.open("xb") as output:
        output.write(_ROW_MAGIC)
        output.write(struct.pack("<BQ", _TABLE_CODE[table], len(rows)))
        for index, row in enumerate(rows):
            _write_symbol(output, row.symbol)
            ts = _require_int(row.ts, f"row[{index}].ts", positive=False)
            output.write(struct.pack("<q", ts))
            if table == "canonical_score":
                if not isinstance(row, CanonicalScoreRow):
                    raise ValueError(f"row[{index}] must be CanonicalScoreRow")
                if not math.isfinite(row.score) or not math.isfinite(row.confidence):
                    raise ValueError(f"row[{index}] score and confidence must be finite")
                output.write(struct.pack("<dd", row.score, row.confidence))
            else:
                if not isinstance(row, ForwardReturnRow):
                    raise ValueError(f"row[{index}] must be ForwardReturnRow")
                if not math.isfinite(row.r_next):
                    raise ValueError(f"row[{index}].r_next must be finite")
                horizon = _require_int(
                    row.horizon_bars, f"row[{index}].horizon_bars", positive=True
                )
                output.write(struct.pack("<di", row.r_next, horizon))
            path_index = -1 if row.path_index is None else _require_int(
                row.path_index, f"row[{index}].path_index", positive=False
            )
            if path_index < -1 or path_index > 2_147_483_647:
                raise ValueError(f"row[{index}].path_index must fit nullable int32")
            output.write(struct.pack("<i", path_index))
        output.flush()
        os.fsync(output.fileno())


def write_eval_parquet(
    root: Path,
    table: EvalParquetTable,
    signal_id: int,
    run_id: int,
    rows: Sequence[CanonicalScoreRow] | Sequence[ForwardReturnRow],
    *,
    created_at_ms: Optional[int] = None,
) -> Path:
    """Write through the single C++ owner and return the final partition dir."""

    signal_id = _require_int(signal_id, "signal_id", positive=True)
    run_id = _require_int(run_id, "run_id", positive=True)
    if table not in _TABLE_CODE:
        raise ValueError(f"unknown eval table: {table!r}")
    created_at = (
        int(time.time() * 1000)
        if created_at_ms is None
        else _require_int(created_at_ms, "created_at_ms", positive=False)
    )

    with tempfile.TemporaryDirectory(prefix="qnx_eval_parquet_") as work:
        work_dir = Path(work)
        rows_path = work_dir / "rows.bin"
        request_path = work_dir / "request.json"
        try:
            _write_rows(rows_path, table, rows)
        except Exception as exc:
            raise EvalParquetWriteError(
                table, signal_id, run_id, "encode_rows", exc
            ) from exc
        request_path.write_text(
            json.dumps(
                {
                    "version": _CONTRACT_VERSION,
                    "operation": "write",
                    "root": str(Path(root) / "eval"),
                    "table": table,
                    "signal_id": signal_id,
                    "run_id": run_id,
                    "created_at_ms": created_at,
                    "rows_path": str(rows_path),
                },
                allow_nan=False,
            ),
            encoding="utf-8",
        )
        try:
            result = subprocess.run(
                [_resolve_executor(), f"--eval-parquet={request_path}"],
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode != 0:
                raise RuntimeError(
                    f"StratCraft-executor --eval-parquet exited "
                    f"{result.returncode}: "
                    f"{result.stderr.strip() or result.stdout.strip() or '(empty output)'}"
                )
            line = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else ""
            response = json.loads(line)
            if (
                response.get("status") != "ok"
                or response.get("version") != _CONTRACT_VERSION
            ):
                raise RuntimeError(f"unexpected C++ response: {line[:500]}")
        except Exception as exc:
            raise EvalParquetWriteError(
                table, signal_id, run_id, "invoke_cpp", exc
            ) from exc

    return (
        Path(root)
        / "eval"
        / table
        / f"signal_id={signal_id}"
        / f"run_id={run_id}"
    )
