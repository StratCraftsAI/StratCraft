#!/usr/bin/env bash
#
# TICKET_813: epoch-unit discipline lint
#
# Enforces the "document the seam" decision recorded in
# TICKET_813 section 11: there is exactly one legal seam between
# Unix seconds (the parquet column + every IDataProvider) and
# epoch milliseconds (the orchestrator + signal_run). The seam
# lives in two functions:
#
#   - research_contracts.io.load_ohlcv (Python side -- seconds parquet
#     column -> DatetimeIndex)
#   - nona_algorithm.signal_sweep.fit_universe._fold_window_split
#     (Python side -- ms IS/OOS bounds -> Timestamp comparison
#     against the DatetimeIndex)
#
# Any other call to `pd.to_datetime(unit=...)` or
# `pd.Timestamp(..., unit=...)` is a new seam by definition, which
# means a new place where the seconds-vs-ms invariant is one typo
# away from a 1970 DatetimeIndex bug like TICKET_812 R1.
#
# This script greps for those calls and fails (exit 1) if it
# finds any outside the two allowed files. To run:
#
#   bash scripts/check-epoch-unit-discipline.sh
#
# Wire it into pre-commit / CI alongside the other check-* scripts.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Files allowed to call pd.to_datetime(unit=...) / pd.Timestamp(unit=...).
# These are the canonical seam locations; everything else is forbidden.
#
# score_alt_one.py is on the allow list as TECH DEBT: it currently
# claims the parquet timestamp column is ms (line 210, comment
# block says "YFinance / Dukascopy parquet output"), but the
# IDataProvider contract (and the actual provider implementations)
# ship SECONDS. The TICKET_813 lint surfaced this discrepancy --
# rather than silently breaking the alt-data scoring path in this
# ticket's diff, we tracked the fix as a follow-up. Remove
# score_alt_one.py from this allow list once the unit there is
# corrected (probably by routing through load_ohlcv).
ALLOW_PATTERN='packages/research-contracts/research_contracts/io/ohlcv_parquet\.py|packages/nona-algorithm/nona_algorithm/signal_sweep/fit_universe\.py|packages/nona-algorithm/nona_algorithm/scoreboard/score_alt_one\.py'

# Find all production-code occurrences of either signature.
# Exclude:
#   - Tests (allowed to construct any fixture they want)
#   - The allow-list files
#   - vcpkg / third-party installs
#   - This script itself
HITS=$(
  grep -rnE \
    --include='*.py' \
    --exclude-dir='vcpkg_installed' \
    --exclude-dir='__pycache__' \
    --exclude-dir='tests' \
    --exclude-dir='.git' \
    'pd\.to_datetime\([^)]*unit=|pd\.Timestamp\([^)]*unit=' \
    packages/research-contracts/ packages/nona-algorithm/ 2>/dev/null \
  | grep -vE "$ALLOW_PATTERN" \
  || true
)

if [[ -n "$HITS" ]]; then
  echo "[check-epoch-unit-discipline] FAIL: unit= calls outside the canonical seam"
  echo ""
  echo "TICKET_813 pins exactly two seams between seconds and ms:"
  echo "  - packages/research-contracts/research_contracts/io/ohlcv_parquet.py"
  echo "  - packages/nona-algorithm/nona_algorithm/signal_sweep/fit_universe.py"
  echo ""
  echo "Found pd.to_datetime(unit=...) / pd.Timestamp(unit=...) outside"
  echo "those files. Each call site is a new seam that can re-introduce"
  echo "the seconds-vs-ms confusion R1 of TICKET_812 hit. Either:"
  echo ""
  echo "  (a) use research_contracts.io.load_ohlcv to load the parquet"
  echo "      (it already handles the seconds -> DatetimeIndex promote),"
  echo "  (b) move the new logic into fit_universe._fold_window_split"
  echo "      if it is genuinely about IS/OOS window slicing, or"
  echo "  (c) document why this is a new legal seam and add it to the"
  echo "      ALLOW_PATTERN at the top of this script (and to TICKET_813"
  echo "      section 11 -- the team decided seams are tracked, not"
  echo "      proliferated)."
  echo ""
  echo "Offending lines:"
  echo "$HITS"
  exit 1
fi

echo "[check-epoch-unit-discipline] OK -- no new epoch-unit seams found."
