#!/bin/bash
# scripts/check_code_compliance.sh
# TICKET_636_4: Source code content compliance checks
# Scans source code for violations beyond what check_public_content.sh covers.
# Targets: non-ASCII chars, console.log in main process, debug artifacts, hardcoded URLs.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

EXIT_CODE=0
WARN_COUNT=0

# Collect git-tracked source files (exclude locales, node_modules, dist, test fixtures)
collect_source_files() {
    cd "$PROJECT_ROOT" && git ls-files -- \
        '*.ts' '*.tsx' '*.js' '*.jsx' \
        '*.md' \
        '*.hpp' '*.cpp' '*.h' \
        '*.py' \
        '*.json' \
        2>/dev/null | grep -v 'node_modules/' | \
        grep -v '/dist/' | \
        grep -v 'locales/' | \
        grep -v 'locale/' | \
        grep -v 'i18n/' | \
        grep -v '__fixtures__/' | \
        grep -v '__snapshots__/' | \
        grep -v 'pnpm-lock.yaml' | \
        grep -v 'TICKET_.*FIXES/' | \
        grep -v '^analysis/' | \
        grep -v '^tools-test/' | \
        grep -v '.test.ts' | \
        grep -v '.spec.ts' | \
        grep -v '.test.tsx' | \
        grep -v '.spec.tsx'
}

# ============================================================
# Check 1: Non-ASCII characters in source code (beyond CJK)
# ============================================================
echo "=== Non-ASCII Character Check (Full) ==="

NON_ASCII_FILES=()
while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    NON_ASCII_FILES+=("$PROJECT_ROOT/$f")
done < <(collect_source_files | grep -v '\.json$')

NON_ASCII=""
if [ ${#NON_ASCII_FILES[@]} -gt 0 ]; then
    # Focus on CJK characters, emojis, and other non-Latin scripts
    # Allow common typographic chars (em-dash, copyright, etc.) which are harmless
    NON_ASCII=$(grep -Pn '[\p{Han}\p{Hiragana}\p{Katakana}\p{Hangul}\p{Emoji_Presentation}]' "${NON_ASCII_FILES[@]}" 2>/dev/null | \
        grep -v '\.md:' | \
        grep -v 'CLAUDE.md' | \
        grep -v 'baostock' | \
        grep -v 'docs/back-source/' | \
        grep -v 'scripts/seed-' | \
        head -50 || true)
fi

if [ -n "$NON_ASCII" ]; then
    echo -e "${RED}FAIL${NC}: Non-ASCII characters found in source code:"
    echo "$NON_ASCII"
    EXIT_CODE=1
else
    echo -e "${GREEN}PASS${NC}: No non-ASCII characters in source code."
fi

# ============================================================
# Check 2: console.log/console.error in Electron main process
# ============================================================
echo ""
echo "=== Console.log in Main Process Check ==="

MAIN_PROCESS_FILES=()
while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    MAIN_PROCESS_FILES+=("$PROJECT_ROOT/$f")
done < <(cd "$PROJECT_ROOT" && git ls-files -- \
    'apps/desktop/src/main/**/*.ts' \
    2>/dev/null | grep -v 'node_modules/' | \
    grep -v '.test.ts' | \
    grep -v '.spec.ts' | \
    grep -v '__tests__/')

CONSOLE_USAGE=""
if [ ${#MAIN_PROCESS_FILES[@]} -gt 0 ]; then
    CONSOLE_USAGE=$(grep -n 'console\.\(log\|error\|warn\|debug\|info\)(' "${MAIN_PROCESS_FILES[@]}" 2>/dev/null | \
        grep -v '// eslint-disable' | \
        grep -v '// console allowed' | \
        grep -v 'noinspection' | \
        head -30 || true)
fi

if [ -n "$CONSOLE_USAGE" ]; then
    CONSOLE_COUNT=$(echo "$CONSOLE_USAGE" | wc -l)
    echo -e "${YELLOW}WARN${NC}: $CONSOLE_COUNT console.* calls in main process (should use electron-log):"
    echo "$CONSOLE_USAGE" | head -10
    if [ "$CONSOLE_COUNT" -gt 10 ]; then
        echo "  ... and $((CONSOLE_COUNT - 10)) more"
    fi
    WARN_COUNT=$((WARN_COUNT + 1))
else
    echo -e "${GREEN}PASS${NC}: No console.log in main process."
fi

# ============================================================
# Check 3: Debugger statements
# ============================================================
echo ""
echo "=== Debugger Statement Check ==="

ALL_TS_FILES=()
while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    ALL_TS_FILES+=("$PROJECT_ROOT/$f")
done < <(cd "$PROJECT_ROOT" && git ls-files -- \
    '*.ts' '*.tsx' '*.js' '*.jsx' \
    2>/dev/null | grep -v 'node_modules/' | \
    grep -v '/dist/' | \
    grep -v '.test.ts' | \
    grep -v '.spec.ts')

DEBUGGER_STMTS=""
if [ ${#ALL_TS_FILES[@]} -gt 0 ]; then
    DEBUGGER_STMTS=$(grep -n '^\s*debugger\s*;' "${ALL_TS_FILES[@]}" 2>/dev/null || true)
fi

if [ -n "$DEBUGGER_STMTS" ]; then
    echo -e "${RED}FAIL${NC}: Debugger statements found:"
    echo "$DEBUGGER_STMTS"
    EXIT_CODE=1
else
    echo -e "${GREEN}PASS${NC}: No debugger statements."
fi

# ============================================================
# Check 4: Hardcoded localhost/staging URLs (non-test code)
# ============================================================
echo ""
echo "=== Hardcoded URL Check ==="

HARDCODED_URLS=""
if [ ${#ALL_TS_FILES[@]} -gt 0 ]; then
    HARDCODED_URLS=$(grep -n 'http://localhost:[0-9]\{4,\}' "${ALL_TS_FILES[@]}" 2>/dev/null | \
        grep -v '\.test\.' | \
        grep -v '__tests__' | \
        grep -v '\.spec\.' | \
        grep -v 'vite.config' | \
        grep -v 'electron.vite' | \
        grep -v 'webpack' | \
        grep -v '// dev-only' | \
        grep -v 'process.env' | \
        head -20 || true)
fi

if [ -n "$HARDCODED_URLS" ]; then
    URL_COUNT=$(echo "$HARDCODED_URLS" | wc -l)
    echo -e "${YELLOW}WARN${NC}: $URL_COUNT hardcoded localhost URLs found (review for production leaks):"
    echo "$HARDCODED_URLS" | head -10
    WARN_COUNT=$((WARN_COUNT + 1))
else
    echo -e "${GREEN}PASS${NC}: No hardcoded localhost URLs."
fi

# ============================================================
# Check 5: CE/Community Edition terminology in source code
# ============================================================
echo ""
echo "=== CE/Community Edition Terminology Check ==="

CE_TERMS=""
if [ ${#ALL_TS_FILES[@]} -gt 0 ]; then
    CE_TERMS=$(grep -inE '\bCommunity Edition\b|\bCE edition\b|\bopen.source edition\b' "${ALL_TS_FILES[@]}" 2>/dev/null | \
        grep -v 'TICKET_635' | \
        grep -v 'check_.*compliance' | \
        grep -v 'check_.*content' | \
        head -20 || true)
fi

if [ -n "$CE_TERMS" ]; then
    echo -e "${RED}FAIL${NC}: CE/Community Edition terminology found in source code:"
    echo "$CE_TERMS"
    EXIT_CODE=1
else
    echo -e "${GREEN}PASS${NC}: No CE/Community Edition terminology."
fi

# ============================================================
# Check 6: TODO/FIXME/HACK markers (advisory only)
# ============================================================
echo ""
echo "=== Tech Debt Marker Audit ==="

TECH_DEBT=""
if [ ${#ALL_TS_FILES[@]} -gt 0 ]; then
    TECH_DEBT=$(grep -rcE '\b(TODO|FIXME|HACK|XXX)\b' "${ALL_TS_FILES[@]}" 2>/dev/null | \
        awk -F: '$NF > 0' | sort -t: -k2 -rn | head -20 || true)
fi

if [ -n "$TECH_DEBT" ]; then
    TOTAL_MARKERS=$(echo "$TECH_DEBT" | awk -F: '{sum += $NF} END {print sum}')
    echo -e "${YELLOW}INFO${NC}: $TOTAL_MARKERS TODO/FIXME/HACK markers across codebase (advisory):"
    echo "$TECH_DEBT" | head -10
    # Advisory only, does not fail the check
else
    echo -e "${GREEN}PASS${NC}: No tech debt markers found."
fi

# ============================================================
# Summary
# ============================================================
echo ""
echo "=== Source Code Compliance Summary ==="
if [ $EXIT_CODE -eq 0 ] && [ $WARN_COUNT -eq 0 ]; then
    echo -e "${GREEN}OK: All source code compliance checks passed.${NC}"
elif [ $EXIT_CODE -eq 0 ]; then
    echo -e "${YELLOW}OK with $WARN_COUNT warning(s). Review above.${NC}"
else
    echo -e "${RED}FAILED: Fix the compliance issues above.${NC}"
fi

exit $EXIT_CODE
