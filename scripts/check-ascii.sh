#!/bin/bash
# scripts/check-ascii.sh
# TICKET_636_3: Pre-commit hook for non-ASCII character detection
# Usage: scripts/check-ascii.sh [file1] [file2] ...
# If no files given, reads from stdin (one file per line).

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

EXIT_CODE=0
FILES=("$@")

# If no args, read file list from stdin
if [ ${#FILES[@]} -eq 0 ]; then
    while IFS= read -r f; do
        [[ -z "$f" ]] && continue
        FILES+=("$f")
    done
fi

for file in "${FILES[@]}"; do
    # Skip locale/i18n files (allowed to have non-English chars)
    if echo "$file" | grep -qE '(locales?/|i18n/|\.json$)'; then
        continue
    fi

    # Skip binary files
    if file "$file" 2>/dev/null | grep -q 'binary'; then
        continue
    fi

    # Check for non-ASCII
    MATCHES=$(grep -Pn '[^\x00-\x7F]' "$file" 2>/dev/null | head -5 || true)
    if [ -n "$MATCHES" ]; then
        echo -e "${RED}FAIL${NC}: Non-ASCII characters in $file:"
        echo "$MATCHES"
        EXIT_CODE=1
    fi
done

if [ $EXIT_CODE -eq 0 ] && [ ${#FILES[@]} -gt 0 ]; then
    echo -e "${GREEN}PASS${NC}: ASCII check passed for ${#FILES[@]} file(s)."
fi

exit $EXIT_CODE
