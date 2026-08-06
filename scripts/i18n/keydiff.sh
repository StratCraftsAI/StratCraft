#!/usr/bin/env bash
# i18n key-drift audit: diff every non-en_US locale against the en_US baseline.
#
# Usage:
#   scripts/i18n/keydiff.sh                          # audit all known locale roots, print to stdout
#   scripts/i18n/keydiff.sh <out_file>               # audit all, write to file
#   scripts/i18n/keydiff.sh --root <dir> --ns <file> # audit one (root, namespace file)
#
# Dependencies: bash, jq.
#
# Exit codes:
#   0 = success (no drift detected, or drift report written)
#   1 = drift detected (--strict mode only)
#   2 = bad usage / missing dependencies
#
# Background: TICKET_786 Phase 0.3. Drift = keys in en_US baseline missing from a
# non-en_US locale, plus keys in a non-en_US locale absent from en_US. Both are
# bugs: missing keys produce fallback-to-English, extra keys are dead translations.
set -euo pipefail

STRICT=0
SINGLE_ROOT=""
SINGLE_NS=""
OUT_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) SINGLE_ROOT="$2"; shift 2 ;;
    --ns) SINGLE_NS="$2"; shift 2 ;;
    --strict) STRICT=1; shift ;;
    -h|--help)
      sed -n '2,17p' "$0"; exit 0 ;;
    *)
      OUT_FILE="$1"; shift ;;
  esac
done

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required but not installed" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Locale-root inventory. Keep in sync with manifest.contributes.i18n.path declarations.
# Format: <relative-locale-root>:<namespace-filename>
ROOTS=(
  "apps/desktop/src/i18n/locales:ui.json"
  "apps/desktop/src/i18n/locales:trading.json"
  "apps/desktop/src/i18n/locales:settings.json"
  "apps/desktop/src/i18n/locales:marketplace.json"
  "apps/desktop/src/i18n/locales:errors.json"
  "apps/desktop/src/i18n/locales:dialogs.json"
  "plugins/strategy-builder-nexus/locales:strategy-builder.json"
  "plugins/quant-lab-nexus/locales:quant-lab.json"
  "plugins/back-test-nexus/locales:backtest.json"
  "plugins/broker-bridge-nexus/locales:broker.json"
  "plugins/optional/chart/locales:chart.json"
  "plugins/data-plugin/locales:data.json"
  "apps/desktop/src/mcp/standalone/locales:mcp.json"
)

flatten_keys() {
  jq -r '[paths(scalars) | join(".")] | .[]' "$1" 2>/dev/null | LC_ALL=C sort
}

diff_one_namespace() {
  local root="$1"
  local ns="$2"
  local abs_root="$REPO_ROOT/$root"

  if [[ ! -d "$abs_root" ]]; then
    printf '### %s / %s\n  ROOT_MISSING\n\n' "$root" "$ns"
    [[ "$STRICT" -eq 1 ]] && return 1 || return 0
  fi
  if [[ ! -f "$abs_root/en_US/$ns" ]]; then
    printf '### %s / %s\n  BASELINE_MISSING: %s/en_US/%s\n\n' "$root" "$ns" "$root" "$ns"
    [[ "$STRICT" -eq 1 ]] && return 1 || return 0
  fi

  local baseline_tmp
  baseline_tmp=$(mktemp)
  flatten_keys "$abs_root/en_US/$ns" > "$baseline_tmp"
  local baseline_count
  baseline_count=$(wc -l < "$baseline_tmp" | tr -d ' ')

  printf '### %s / %s\nbaseline (en_US) keys: %s\n' "$root" "$ns" "$baseline_count"

  local total_drift=0
  for loc_dir in "$abs_root"/*/; do
    local loc
    loc=$(basename "$loc_dir")
    [[ "$loc" == "en_US" ]] && continue
    if [[ ! -f "$loc_dir/$ns" ]]; then
      printf '  %s: FILE_MISSING\n' "$loc"
      total_drift=$((total_drift + 1))
      continue
    fi
    local tmp
    tmp=$(mktemp)
    flatten_keys "$loc_dir/$ns" > "$tmp"
    local count missing extra missing_count extra_count
    count=$(wc -l < "$tmp" | tr -d ' ')
    missing_count=$(LC_ALL=C comm -23 "$baseline_tmp" "$tmp" | wc -l | tr -d ' ')
    extra_count=$(LC_ALL=C comm -13 "$baseline_tmp" "$tmp" | wc -l | tr -d ' ')
    printf '  %s: %s keys; missing=%s extra=%s\n' "$loc" "$count" "$missing_count" "$extra_count"
    if [[ "$missing_count" -gt 0 ]]; then
      printf '    missing sample:\n'
      LC_ALL=C comm -23 "$baseline_tmp" "$tmp" | head -5 | sed 's/^/      - /'
      [[ "$missing_count" -gt 5 ]] && printf '      (+%s more)\n' "$((missing_count - 5))"
    fi
    if [[ "$extra_count" -gt 0 ]]; then
      printf '    extra sample:\n'
      LC_ALL=C comm -13 "$baseline_tmp" "$tmp" | head -5 | sed 's/^/      + /'
      [[ "$extra_count" -gt 5 ]] && printf '      (+%s more)\n' "$((extra_count - 5))"
    fi
    total_drift=$((total_drift + missing_count + extra_count))
    rm -f "$tmp"
  done

  rm -f "$baseline_tmp"
  printf '\n'
  [[ "$STRICT" -eq 1 && "$total_drift" -gt 0 ]] && return 1 || return 0
}

run_audit() {
  if [[ -n "$SINGLE_ROOT" && -n "$SINGLE_NS" ]]; then
    diff_one_namespace "$SINGLE_ROOT" "$SINGLE_NS"
    return $?
  fi

  local strict_fail=0
  for entry in "${ROOTS[@]}"; do
    local root="${entry%%:*}"
    local ns="${entry##*:}"
    diff_one_namespace "$root" "$ns" || strict_fail=1
  done
  return $strict_fail
}

if [[ -n "$OUT_FILE" ]]; then
  run_audit > "$OUT_FILE"
  status=$?
  printf 'Wrote drift report to %s\n' "$OUT_FILE" >&2
  exit $status
else
  run_audit
fi
