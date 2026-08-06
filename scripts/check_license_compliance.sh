#!/bin/bash
# Public dependency license compliance entry point.
#
# The policy and decision algorithm are owned by public-release-gates.mjs.
# Keeping a second shell allowlist caused the generated repository to reject
# MIT-0 after the canonical gate had approved it. This wrapper now produces
# the same installed-dependency evidence used by CI and delegates the verdict
# to the authoritative gate.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPORT_FILE="$(mktemp)"
ERROR_FILE="$(mktemp)"
trap 'rm -f "$REPORT_FILE" "$ERROR_FILE"' EXIT

echo "=== Dependency License Audit ==="

if ! node "$SCRIPT_DIR/ci/public-dependency-licenses.mjs" "$PROJECT_ROOT" \
    > "$REPORT_FILE" 2> "$ERROR_FILE"; then
    echo "Dependency license evidence generation failed:" >&2
    sed -n '1,120p' "$ERROR_FILE" >&2
    exit 1
fi

node "$SCRIPT_DIR/ci/public-dependency-license-audit.mjs" \
    "$REPORT_FILE" \
    "$SCRIPT_DIR/ci/public-release-gate-policy.json"
