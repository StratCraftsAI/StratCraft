from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from research_contracts.evaluation import (
    ENVELOPE_SCHEMA_VERSION,
    EvaluationContractError,
    read_evaluation_envelope,
)


ROOT = Path(__file__).resolve().parents[3]
ENVELOPE_PATH = ROOT / "packages/executor/tests/fixtures/evaluation_envelope_v1.json"
PARITY_PATH = ROOT / "packages/executor/tests/fixtures/evaluation_parity_cases_v1.json"
EVALUATION_ARROW_PATH = ROOT / "packages/executor/schemas/evaluation_arrow_schema_v1.json"
MARKET_DATA_ARROW_PATH = ROOT / "packages/executor/schemas/market_data_arrow_schema_v1.json"


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_shared_golden_envelope_is_returned_without_reconstruction() -> None:
    raw = load(ENVELOPE_PATH)
    envelope = read_evaluation_envelope(raw)
    assert envelope is raw
    assert envelope["schema_version"] == ENVELOPE_SCHEMA_VERSION
    assert [row["timestamp_ms"] for row in envelope["rows"]] == [
        0,
        1716901200000,
        253402300799999,
    ]
    assert envelope["missing_symbols"] == ["MISSING"]


def test_shared_exceptional_fixture_and_failure_envelope() -> None:
    parity = load(PARITY_PATH)
    assert parity["fixture_version"] == "qnx.evaluation-parity/1.0.0"
    assert len(parity["non_finite_canonicalization"]) == 3
    assert parity["tie_ranks"]["expected_average_ranks"] == [4.0, 1.5, 1.5, 3.0]
    read_evaluation_envelope(parity["failure_envelope"])
    read_evaluation_envelope(parity["cancelled_envelope"])


def test_frozen_arrow_and_parquet_semantics() -> None:
    evaluation = load(EVALUATION_ARROW_PATH)
    market_data = load(MARKET_DATA_ARROW_PATH)
    assert evaluation["schema_version"] == "qnx.evaluation-arrow/1.0.0"
    assert market_data["schema_version"] == "qnx.market-data-arrow/1.0.0"
    assert evaluation["timestamp_semantics"]["unit"] == "millisecond"
    assert market_data["timestamp_semantics"]["meaning"] == "bar_close"
    assert evaluation["parquet"]["timestamp_logical_type"] == "TIMESTAMP(MILLIS,true)"


def mutations():
    return [
        lambda value: value.update(schema_version="wrong"),
        lambda value: value.update(parallel_contract=True),
        lambda value: value.pop("model_id"),
        lambda value: value.update(model_id=""),
        lambda value: value.update(model_id=42),
        lambda value: value["window"].update(start_ms=value["window"]["end_ms"] + 1),
        lambda value: value["window"].update(end_inclusive=False),
        lambda value: value["rows"][0].update(timestamp_ms=2**63),
        lambda value: value["rows"][0].update(timestamp_ms=-1),
        lambda value: value["window"].update(start_ms=1),
        lambda value: value["rows"].__setitem__(1, value["rows"][0]),
        lambda value: value["rows"][0].update(signal_score=float("inf")),
        lambda value: value["rows"][0].update(forward_return="bad"),
        lambda value: value["rows"][0].update(signal_score=2.0),
        lambda value: value["rows"][0].update(confidence=-1.0),
        lambda value: value.update(status="pending"),
        lambda value: value.update(rows={}),
        lambda value: value["statistics"][0].update(raw_p_value=2.0),
        lambda value: value["verdict_inputs"].update(minimum_sample_count=0),
        lambda value: value["verdict_inputs"].update(passed="yes"),
        lambda value: value["progress"].update(completed_units=4),
        lambda value: value["cancellation"].update(reason=42),
        lambda value: (
            value.update(status="cancelled"),
            value["cancellation"].update(cancelled=True, reason="caller"),
        ),
        lambda value: (
            value.update(status="cancelled"),
            value["cancellation"].update(requested=True, cancelled=True),
        ),
        lambda value: value["missing_symbols"].append("MISSING"),
        lambda value: value.update(errors=[]),
        lambda value: value["errors"][0].update(field=42),
        lambda value: value.update(status="cancelled"),
    ]


@pytest.mark.parametrize("mutate", mutations())
def test_semantic_boundary_violations_fail_actionably(mutate) -> None:
    value = copy.deepcopy(load(ENVELOPE_PATH))
    mutate(value)
    with pytest.raises(EvaluationContractError, match="QNX_EVAL_CONTRACT_INVALID"):
        read_evaluation_envelope(value)


@pytest.mark.parametrize("value", [None, 42, []])
def test_non_object_envelopes_fail_actionably(value) -> None:
    with pytest.raises(EvaluationContractError, match="QNX_EVAL_CONTRACT_INVALID"):
        read_evaluation_envelope(value)
