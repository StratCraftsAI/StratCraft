"""Reader for the C++-owned TICKET_1292 evaluation envelope.

Extracted from the commercial research package by TICKET_1304_5A. The
authoritative wire schema lives in
``packages/executor/schemas/evaluation_envelope.schema.json``. Python remains
a consumer for retained research/training boundaries and must not reconstruct
rows, statistics, verdicts, timestamps, progress, cancellation, or errors.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Mapping, TypeGuard, cast


ENVELOPE_SCHEMA_VERSION = "qnx.evaluation-envelope/1.0.0"
TOP_LEVEL_FIELDS = frozenset(
    {
        "schema_version",
        "evaluation_id",
        "model_id",
        "window",
        "status",
        "rows",
        "statistics",
        "verdict_inputs",
        "progress",
        "cancellation",
        "missing_symbols",
        "errors",
    }
)


class EvaluationContractError(ValueError):
    """Actionable contract violation at a retained Python boundary."""


def _fail(message: str) -> None:
    raise EvaluationContractError(f"QNX_EVAL_CONTRACT_INVALID: {message}")


def _is_mapping(value: object) -> TypeGuard[Mapping[str, Any]]:
    return isinstance(value, Mapping)


def _object(value: object, path: str) -> Mapping[str, Any]:
    if not _is_mapping(value):
        _fail(f"{path} must be an object")
    return value


def _exact(value: Mapping[str, Any], fields: set[str] | frozenset[str], path: str) -> None:
    actual = set(value)
    unknown = actual - fields
    missing = fields - actual
    if unknown:
        _fail(f"{path} contains unknown field {sorted(unknown)[0]}")
    if missing:
        _fail(f"{path} is missing required field {sorted(missing)[0]}")


def _identifier(value: object, path: str) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= 256:
        _fail(f"{path} must contain 1..256 characters")
    return value


def _finite(value: object, path: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        _fail(f"{path} must be finite")
    result = float(value)
    if not math.isfinite(result):
        _fail(f"{path} must be finite")
    return result


def _integer(value: object, path: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        _fail(f"{path} must be a non-negative integer")
    if value > 2**63 - 1:
        _fail(f"{path} exceeds int64")
    return value


def _probability(value: object, path: str) -> float:
    result = _finite(value, path)
    if not 0.0 <= result <= 1.0:
        _fail(f"{path} must be within [0, 1]")
    return result


def _nullable_probability(value: object, path: str) -> None:
    if value is not None:
        _probability(value, path)


def _boolean(value: object, path: str) -> bool:
    if not isinstance(value, bool):
        _fail(f"{path} must be boolean")
    return value


def _array(value: object, path: str) -> List[Any]:
    if not isinstance(value, list):
        _fail(f"{path} must be an array")
    return value


def read_evaluation_envelope(document: object) -> Dict[str, Any]:
    """Validate and return the original versioned envelope without reshaping."""

    envelope = _object(document, "envelope")
    _exact(envelope, TOP_LEVEL_FIELDS, "envelope")
    if envelope["schema_version"] != ENVELOPE_SCHEMA_VERSION:
        _fail(f"schema_version must equal {ENVELOPE_SCHEMA_VERSION}")
    _identifier(envelope["evaluation_id"], "evaluation_id")
    _identifier(envelope["model_id"], "model_id")

    window = _object(envelope["window"], "window")
    _exact(window, {"start_ms", "end_ms", "end_inclusive"}, "window")
    start = _integer(window["start_ms"], "window.start_ms")
    end = _integer(window["end_ms"], "window.end_ms")
    if start > end or window["end_inclusive"] is not True:
        _fail("window must be an inclusive interval")

    status = envelope["status"]
    if status not in {"completed", "partial", "failed", "cancelled"}:
        _fail("status is not a supported evaluation state")

    previous: tuple[str, int] | None = None
    for index, raw in enumerate(_array(envelope["rows"], "rows")):
        row = _object(raw, f"rows[{index}]")
        _exact(row, {"symbol", "timestamp_ms", "signal_score", "confidence", "forward_return"}, f"rows[{index}]")
        symbol = _identifier(row["symbol"], f"rows[{index}].symbol")
        timestamp = _integer(row["timestamp_ms"], f"rows[{index}].timestamp_ms")
        if not start <= timestamp <= end:
            _fail(f"rows[{index}] falls outside window")
        score = _finite(row["signal_score"], f"rows[{index}].signal_score")
        if not -1.0 <= score <= 1.0:
            _fail(f"rows[{index}].signal_score must be within [-1, 1]")
        _probability(row["confidence"], f"rows[{index}].confidence")
        if row["forward_return"] is not None:
            _finite(row["forward_return"], f"rows[{index}].forward_return")
        key = (symbol, timestamp)
        if previous is not None and key <= previous:
            _fail("rows must be uniquely ordered by symbol then timestamp_ms")
        previous = key

    for index, raw in enumerate(_array(envelope["statistics"], "statistics")):
        statistic = _object(raw, f"statistics[{index}]")
        _exact(statistic, {"name", "value", "sample_count", "raw_p_value", "adjusted_p_value"}, f"statistics[{index}]")
        _identifier(statistic["name"], f"statistics[{index}].name")
        _finite(statistic["value"], f"statistics[{index}].value")
        _integer(statistic["sample_count"], f"statistics[{index}].sample_count")
        _nullable_probability(statistic["raw_p_value"], f"statistics[{index}].raw_p_value")
        _nullable_probability(statistic["adjusted_p_value"], f"statistics[{index}].adjusted_p_value")

    verdict = _object(envelope["verdict_inputs"], "verdict_inputs")
    _exact(verdict, {"observed_sample_count", "minimum_sample_count", "effect_size", "raw_p_value", "adjusted_p_value", "significance_level", "passed"}, "verdict_inputs")
    _integer(verdict["observed_sample_count"], "verdict_inputs.observed_sample_count")
    if _integer(verdict["minimum_sample_count"], "verdict_inputs.minimum_sample_count") < 1:
        _fail("verdict_inputs.minimum_sample_count must be at least one")
    _finite(verdict["effect_size"], "verdict_inputs.effect_size")
    _nullable_probability(verdict["raw_p_value"], "verdict_inputs.raw_p_value")
    _nullable_probability(verdict["adjusted_p_value"], "verdict_inputs.adjusted_p_value")
    _probability(verdict["significance_level"], "verdict_inputs.significance_level")
    _boolean(verdict["passed"], "verdict_inputs.passed")

    progress = _object(envelope["progress"], "progress")
    _exact(progress, {"completed_units", "total_units", "stage"}, "progress")
    completed = _integer(progress["completed_units"], "progress.completed_units")
    total = _integer(progress["total_units"], "progress.total_units")
    if completed > total:
        _fail("progress.completed_units exceeds total_units")
    _identifier(progress["stage"], "progress.stage")

    cancellation = _object(envelope["cancellation"], "cancellation")
    _exact(cancellation, {"requested", "cancelled", "reason"}, "cancellation")
    requested = _boolean(cancellation["requested"], "cancellation.requested")
    cancelled = _boolean(cancellation["cancelled"], "cancellation.cancelled")
    reason = cancellation["reason"]
    if reason is not None and not isinstance(reason, str):
        _fail("cancellation.reason must be string or null")
    if cancelled and (not requested or not reason):
        _fail("cancelled evaluation requires requested=true and an actionable reason")

    seen_missing: set[str] = set()
    for index, raw in enumerate(_array(envelope["missing_symbols"], "missing_symbols")):
        symbol = _identifier(raw, f"missing_symbols[{index}]")
        if symbol in seen_missing:
            _fail("missing_symbols must be unique")
        seen_missing.add(symbol)

    errors = _array(envelope["errors"], "errors")
    for index, raw in enumerate(errors):
        error = _object(raw, f"errors[{index}]")
        _exact(error, {"code", "message", "field", "retryable"}, f"errors[{index}]")
        _identifier(error["code"], f"errors[{index}].code")
        _identifier(error["message"], f"errors[{index}].message")
        if error["field"] is not None and not isinstance(error["field"], str):
            _fail(f"errors[{index}].field must be string or null")
        _boolean(error["retryable"], f"errors[{index}].retryable")
    if status in {"failed", "partial"} and not errors:
        _fail("failed and partial envelopes require at least one actionable error")
    if (status == "cancelled") != cancelled:
        _fail("cancelled status and cancellation state must agree")

    return cast(Dict[str, Any], document)
