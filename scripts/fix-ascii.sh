#!/bin/bash
# scripts/fix-ascii.sh
# Replace common non-ASCII characters with ASCII equivalents in staged files.
# Usage:
#   scripts/fix-ascii.sh              # fix all staged files
#   scripts/fix-ascii.sh file1 file2  # fix specific files

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

FILES=("$@")

# Default: all staged files matching ts/tsx/js/jsx/md
if [ ${#FILES[@]} -eq 0 ]; then
    while IFS= read -r f; do
        [[ -z "$f" ]] && continue
        FILES+=("$f")
    done < <(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|js|jsx|md)$' || true)
fi

if [ ${#FILES[@]} -eq 0 ]; then
    echo -e "${GREEN}No staged files to fix.${NC}"
    exit 0
fi

FIXED=0

for file in "${FILES[@]}"; do
    # Skip locale/i18n files
    if echo "$file" | grep -qE '(locales?/|i18n/|\.json$)'; then
        continue
    fi

    # Skip binary files
    if file "$file" 2>/dev/null | grep -q 'binary'; then
        continue
    fi

    # Skip missing files
    if [ ! -f "$file" ]; then
        continue
    fi

    # Check if file has non-ASCII
    if ! grep -Pq '[^\x00-\x7F]' "$file" 2>/dev/null; then
        continue
    fi

    echo -e "${YELLOW}Fixing${NC}: $file"

    # --- Replacements ---
    # Em dash, en dash -> hyphen
    sed -i 's/\xe2\x80\x94/-/g' "$file"   # em dash (U+2014)
    sed -i 's/\xe2\x80\x93/-/g' "$file"   # en dash (U+2013)

    # Curly quotes -> straight quotes
    sed -i "s/\xe2\x80\x98/'/g" "$file"   # left single quote (U+2018)
    sed -i "s/\xe2\x80\x99/'/g" "$file"   # right single quote (U+2019)
    sed -i 's/\xe2\x80\x9c/"/g' "$file"   # left double quote (U+201C)
    sed -i 's/\xe2\x80\x9d/"/g' "$file"   # right double quote (U+201D)

    # Ellipsis -> three dots
    sed -i 's/\xe2\x80\xa6/.../g' "$file"  # horizontal ellipsis (U+2026)

    # Non-breaking space -> regular space
    sed -i 's/\xc2\xa0/ /g' "$file"        # NBSP (U+00A0)

    # Bullet -> asterisk
    sed -i 's/\xe2\x80\xa2/*/g' "$file"    # bullet (U+2022)

    # Check if non-ASCII still remains (e.g. Chinese chars that need manual fix)
    REMAINING=$(grep -Pn '[^\x00-\x7F]' "$file" 2>/dev/null | head -5 || true)
    if [ -n "$REMAINING" ]; then
        echo -e "  ${RED}Remaining non-ASCII (manual fix needed):${NC}"
        echo "  $REMAINING"
    fi

    FIXED=$((FIXED + 1))
done

if [ $FIXED -gt 0 ]; then
    echo -e "${GREEN}Fixed $FIXED file(s).${NC} Run ${YELLOW}git add${NC} to re-stage."
else
    echo -e "${GREEN}No non-ASCII characters found.${NC}"
fi
