"""Public contracts for the StratCraft research process boundary."""

from .evaluation import (
    ENVELOPE_SCHEMA_VERSION,
    EvaluationContractError,
    read_evaluation_envelope,
)
from .io import load_ohlcv
from .storage import (
    CanonicalScoreRow,
    EvalParquetWriteError,
    ForwardReturnRow,
    write_eval_parquet,
)

__version__ = "1.0.0"
__all__ = [
    "CanonicalScoreRow",
    "ENVELOPE_SCHEMA_VERSION",
    "EvalParquetWriteError",
    "EvaluationContractError",
    "ForwardReturnRow",
    "load_ohlcv",
    "read_evaluation_envelope",
    "write_eval_parquet",
]

