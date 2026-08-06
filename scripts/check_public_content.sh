#!/bin/bash
# scripts/check_public_content.sh
# TICKET_471_7: Scan public-facing content for prohibited commercial language,
# verify internal links, and check for leaked private references.
# Adapted from StratForge TICKET_220.
# Run before any open-source release (TICKET_468) to verify compliance.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

EXIT_CODE=0

# Prohibited terms pattern (case-insensitive)
PROHIBITED="Enterprise Edition|Commercial Support|Enterprise License|Premium Tier|Pro Edition|Professional Edition|Contact us for pricing|Available upon request"

# Consume the same matrix-derived public candidate set as the release generator
# in the private source tree. The generated clean-slate repository explicitly
# sets STRATCRAFT_PUBLIC_TREE=1 and therefore treats every tracked file as
# public. Do not infer this mode from a missing generator: an explicit mode
# prevents an incomplete private checkout from silently weakening the scan.
PUBLIC_ALLOWLIST_FILE="$(mktemp)"
trap 'rm -f "$PUBLIC_ALLOWLIST_FILE"' EXIT
if [ "${STRATCRAFT_PUBLIC_TREE:-0}" = "1" ]; then
    (cd "$PROJECT_ROOT" && git ls-files) > "$PUBLIC_ALLOWLIST_FILE"
else
    node "$SCRIPT_DIR/ci/public-release-allowlist.mjs" --list > "$PUBLIC_ALLOWLIST_FILE"
fi

filter_public() {
    grep -Fxf "$PUBLIC_ALLOWLIST_FILE" || true
}

# Collect matrix-allowlisted public markdown files.
PUBLIC_FILES=()
while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    PUBLIC_FILES+=("$PROJECT_ROOT/$f")
done < <(cd "$PROJECT_ROOT" && git ls-files -- 'README.md' 'docs/**/*.md' 2>/dev/null | filter_public)

if [ ${#PUBLIC_FILES[@]} -eq 0 ]; then
    echo -e "${YELLOW}WARNING${NC}: No public markdown files found to scan."
    exit 0
fi

# ============================================================
# Check 1: Prohibited commercial terms
# ============================================================
echo "=== Prohibited Terms Scan ==="
MATCHES=$(grep -riEn "$PROHIBITED" "${PUBLIC_FILES[@]}" 2>/dev/null || true)
if [ -n "$MATCHES" ]; then
    echo -e "${RED}FAIL${NC}: Prohibited commercial language found:"
    echo "$MATCHES"
    EXIT_CODE=1
else
    echo -e "${GREEN}PASS${NC}: No prohibited terms found."
fi

# ============================================================
# Check 2: Non-English (CJK) characters in public files
# ============================================================
echo ""
echo "=== Non-English Character Check ==="

# Collect git-tracked code + doc files for character scan
TRACKED_CODE=()
while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    TRACKED_CODE+=("$PROJECT_ROOT/$f")
done < <(cd "$PROJECT_ROOT" && git ls-files -- \
    'README.md' \
    'docs/**/*.md' \
    'packages/executor/include/**/*.hpp' \
    'packages/executor/src/**/*.cpp' \
    'packages/executor/benchmark/**/*.cpp' \
    'packages/executor/benchmark/**/*.hpp' \
    2>/dev/null | filter_public)

CJK_TEXT=""
if [ ${#TRACKED_CODE[@]} -gt 0 ]; then
    CJK_TEXT=$(grep -Pn '[\p{Han}\p{Hiragana}\p{Katakana}\p{Hangul}]' "${TRACKED_CODE[@]}" 2>/dev/null || true)
fi

if [ -n "$CJK_TEXT" ]; then
    echo -e "${RED}FAIL${NC}: Non-English natural language text (CJK) found:"
    echo "$CJK_TEXT"
    EXIT_CODE=1
else
    echo -e "${GREEN}PASS${NC}: No CJK characters found."
fi

# ============================================================
# Check 3: README anchor link validation
# ============================================================
echo ""
echo "=== README Anchor Link Check ==="
README="$PROJECT_ROOT/README.md"
ANCHOR_FAIL=0

if [ -f "$README" ]; then
    ANCHORS=$(grep -E '^#{1,6} ' "$README" | \
        sed 's/^#* //' | \
        tr '[:upper:]' '[:lower:]' | \
        sed 's/ /-/g' | \
        sed 's/[^a-z0-9_-]//g')

    REFS=$(grep -oE '(href="|]\()#[a-zA-Z0-9_-]+' "$README" 2>/dev/null | \
        grep -oE '#[a-zA-Z0-9_-]+' | \
        sed 's/^#//' | sort -u || true)

    REF_COUNT=0
    for ref in $REFS; do
        REF_COUNT=$((REF_COUNT + 1))
        if ! echo "$ANCHORS" | grep -qx "$ref"; then
            echo -e "${RED}FAIL${NC}: Broken anchor link: #$ref"
            ANCHOR_FAIL=1
            EXIT_CODE=1
        fi
    done

    if [ $ANCHOR_FAIL -eq 0 ]; then
        echo -e "${GREEN}PASS${NC}: All anchor links resolve. ($REF_COUNT checked)"
    fi
else
    echo -e "${YELLOW}WARN${NC}: README.md not found."
fi

# ============================================================
# Check 4: README relative file link validation
# ============================================================
echo ""
echo "=== README File Link Check ==="
FILE_FAIL=0

if [ -f "$README" ]; then
    FILE_LINKS=$(grep -oE ']\([^)]+\)' "$README" | \
        grep -oE '\([^)]+\)' | \
        sed 's/^(//; s/)$//' | \
        grep -v '^http' | \
        grep -v '^#' | \
        sort -u)

    LINK_COUNT=0
    for link in $FILE_LINKS; do
        LINK_COUNT=$((LINK_COUNT + 1))
        TARGET="$PROJECT_ROOT/$link"
        if [ ! -e "$TARGET" ]; then
            echo -e "${RED}FAIL${NC}: Broken file link: $link"
            FILE_FAIL=1
            EXIT_CODE=1
        fi
    done

    if [ $FILE_FAIL -eq 0 ]; then
        echo -e "${GREEN}PASS${NC}: All file links resolve. ($LINK_COUNT checked)"
    fi
fi

# ============================================================
# Check 5: Private repository references
# ============================================================
echo ""
echo "=== Private Repository Reference Check ==="
PRIVATE_REFS=""
if [ ${#TRACKED_CODE[@]} -gt 0 ]; then
    PRIVATE_REFS=$(grep -n "StratCraft-dev" "${TRACKED_CODE[@]}" 2>/dev/null || true)
fi

if [ -n "$PRIVATE_REFS" ]; then
    echo -e "${RED}FAIL${NC}: StratCraft-dev references found in public files:"
    echo "$PRIVATE_REFS"
    EXIT_CODE=1
else
    echo -e "${GREEN}PASS${NC}: No private repository references found."
fi

# ============================================================
# Check 6: Hardcoded local workspace paths
# ============================================================
echo ""
echo "=== Hardcoded Path Check ==="
HARDCODED_PATHS=""
if [ ${#TRACKED_CODE[@]} -gt 0 ]; then
    HARDCODED_PATHS=$(grep -n "/data/ws/" "${TRACKED_CODE[@]}" 2>/dev/null || true)
fi

if [ -n "$HARDCODED_PATHS" ]; then
    echo -e "${RED}FAIL${NC}: Hardcoded workspace paths found:"
    echo "$HARDCODED_PATHS"
    EXIT_CODE=1
else
    echo -e "${GREEN}PASS${NC}: No hardcoded workspace paths found."
fi

# ============================================================
# Check 7: Internal ticket references
# ============================================================
echo ""
echo "=== Internal Ticket Reference Check ==="
INTERNAL_REFS=""
if [ ${#TRACKED_CODE[@]} -gt 0 ]; then
    INTERNAL_REFS=$(grep -n "TICKET_INTERNAL" "${TRACKED_CODE[@]}" 2>/dev/null || true)
fi

if [ -n "$INTERNAL_REFS" ]; then
    echo -e "${RED}FAIL${NC}: TICKET_INTERNAL references found in public files:"
    echo "$INTERNAL_REFS"
    EXIT_CODE=1
else
    echo -e "${GREEN}PASS${NC}: No internal ticket references found."
fi

# ============================================================
# Check 8: PII patterns (real user identifiers)
# ============================================================
echo ""
echo "=== PII Pattern Check ==="
PII_FOUND=0

# Check for known PII patterns (same as publish-open-source.sh)
if [ ${#TRACKED_CODE[@]} -gt 0 ]; then
    if grep -rn "starvian" "${TRACKED_CODE[@]}" 2>/dev/null; then
        echo -e "${RED}FAIL${NC}: PII pattern 'starvian' found"
        PII_FOUND=1
    fi
    if grep -rn "8c5e9aa8-f608-40bc-9b1e-2d042db5c036" "${TRACKED_CODE[@]}" 2>/dev/null; then
        echo -e "${RED}FAIL${NC}: PII pattern (real UUID) found"
        PII_FOUND=1
    fi
fi

if [ $PII_FOUND -eq 1 ]; then
    EXIT_CODE=1
else
    echo -e "${GREEN}PASS${NC}: No PII patterns found."
fi

# ============================================================
# Summary
# ============================================================
echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}OK: All public content compliance checks passed.${NC}"
else
    echo -e "${RED}FAILED: Fix the issues above before publishing.${NC}"
fi

exit $EXIT_CODE
