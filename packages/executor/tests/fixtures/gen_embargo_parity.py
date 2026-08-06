"""
TICKET_1292 Phase 5 5B (MC-11) -- Python embargo golden parity generator.

Captures nona_algorithm.signal_sweep.embargo.auto_embargo /
effective_memory_bars across every template family + representative params,
so the C++ planning-geometry embargo port can be proven value-identical to
the Python authority it removes (resolve_embargo.py subprocess) BEFORE the
rewire.

Run from repo root:
    PYTHONPATH=packages/nona-algorithm python \
      packages/executor/tests/fixtures/gen_embargo_parity.py \
      > packages/executor/tests/fixtures/embargo_parity_v1.json
"""

from __future__ import annotations

import json
import sys

from nona_algorithm.signal_sweep.embargo import (
    auto_embargo,
    effective_memory_bars,
)

# (template_id, params) matrix. Covers hmm/gmm (n_states/window caps),
# ngram (k/tau), ml (lookback/window fallback), xgboost_v3
# (lookback/horizon/multi_tf), the classical_ta recommended-embargo
# templates, and an unknown template (registry miss -> min-bars floor).
CASES: list[tuple[str, dict]] = [
    ("hmm_regime_v1", {"n_states": 3}),
    ("hmm_regime_v1", {"n_states": 5, "window": 20}),
    ("hmm_regime_v1", {"n_states": 3, "window": 256}),
    ("gmm_regime_v1", {"n_components": 3}),
    ("gmm_regime_v1", {"n_components": 4, "window": 15}),
    ("ngram_next_bar_v1", {"k": 3}),
    ("ngram_next_bar_v1", {"k": 3, "tau": 5}),
    ("ngram_next_bar_v1", {"k": 5, "tau": 2}),
    ("sklearn_ridge_return_v1", {"lookback": 64}),
    ("sklearn_ridge_return_v1", {"window": 32}),
    ("sklearn_ridge_return_v1", {}),
    ("xgboost_return_v1", {"lookback": 128}),
    ("lightgbm_return_v1", {"lookback": 0}),
    ("xgboost_return_v3", {"lookback": 64, "horizon": 5}),
    ("xgboost_return_v3", {"lookback": 8, "horizon": 5}),
    ("xgboost_return_v3", {"lookback": 8, "horizon": 3}),
    ("xgboost_return_v3", {"lookback": 8, "horizon": 5, "multi_tf": "1d"}),
    ("xgboost_return_v3", {"lookback": 8, "horizon": 5, "multi_tf": "4h"}),
    ("xgboost_return_v3", {"lookback": 8, "horizon": 5, "multi_tf": "1d,4h"}),
    ("catboost_return_v2", {"lookback": 32, "horizon": 10}),
    ("lightgbm_return_v2", {"lookback": 16, "horizon": 5, "multi_tf": "4h"}),
    ("rsi_v1", {"period": 14}),
    ("macd_v1", {"fast_period": 12}),
    ("sma_cross_v1", {"fast_period": 10}),
    ("unknown_template_xyz", {"lookback": 99}),
]


def main() -> int:
    out = []
    for template_id, params in CASES:
        out.append(
            {
                "templateId": template_id,
                "params": params,
                "effectiveMemoryBars": int(effective_memory_bars(template_id, params)),
                "embargoBars": int(auto_embargo(template_id, params)),
            }
        )
    sys.stdout.write(json.dumps({"version": 1, "cases": out}, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
