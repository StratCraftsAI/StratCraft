#!/bin/bash
# scripts/cleanup-non-ascii.sh
# One-time cleanup: replace non-ASCII characters in docs with ASCII equivalents.
# Deletes lines/blocks that are entirely Chinese (no English content).
# Usage: bash scripts/cleanup-non-ascii.sh [--dry-run]

set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
    DRY_RUN=true
    echo "[DRY RUN] No files will be modified."
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

MODIFIED=0
SKIPPED=0

# Find all .md files under docs/ (exclude node_modules, locales)
FILES=$(find docs/ -name '*.md' -not -path '*/node_modules/*' -not -path '*/locales/*' 2>/dev/null)

for file in $FILES; do
    # Skip if no non-ASCII
    if ! grep -Pq '[^\x00-\x7F]' "$file" 2>/dev/null; then
        continue
    fi

    if $DRY_RUN; then
        echo -e "${YELLOW}WOULD MODIFY${NC}: $file"
        grep -Pn '[^\x00-\x7F]' "$file" | head -3
        echo "  ..."
        MODIFIED=$((MODIFIED + 1))
        continue
    fi

    # Phase 1: Symbol replacements (sed)
    sed -i \
        -e 's/→/->/g' \
        -e 's/←/<-/g' \
        -e 's/↓/v/g' \
        -e 's/↑/^/g' \
        -e 's/—/--/g' \
        -e 's/–/-/g' \
        -e 's/•/*/g' \
        -e 's/✅/[OK]/g' \
        -e 's/❌/[FAIL]/g' \
        -e 's/✓/[OK]/g' \
        -e 's/✗/[FAIL]/g' \
        -e "s/'/'/g" \
        -e "s/'/'/g" \
        -e 's/"/"/g' \
        -e 's/"/"/g' \
        -e 's/…/.../g' \
        -e 's/：/:/g' \
        -e 's/，/, /g' \
        -e 's/。/./g' \
        -e 's/（/(/g' \
        -e 's/）/)/g' \
        -e 's/、/, /g' \
        -e 's/↻/~/g' \
        "$file"

    # Phase 2: Replace box-drawing characters used in ASCII diagrams
    sed -i \
        -e 's/─/-/g' \
        -e 's/│/|/g' \
        -e 's/┌/+/g' \
        -e 's/┐/+/g' \
        -e 's/└/+/g' \
        -e 's/┘/+/g' \
        -e 's/├/+/g' \
        -e 's/┤/+/g' \
        -e 's/┬/+/g' \
        -e 's/┴/+/g' \
        -e 's/┼/+/g' \
        -e 's/╔/+/g' \
        -e 's/╗/+/g' \
        -e 's/╚/+/g' \
        -e 's/╝/+/g' \
        -e 's/═/=/g' \
        -e 's/║/|/g' \
        "$file"

    # Phase 3: Delete lines that are entirely non-ASCII (Chinese-only lines)
    # Keep lines that have at least some ASCII word characters mixed in
    # Delete lines where ALL word-like content is non-ASCII (pure Chinese lines)
    python3 -c "
import re, sys

with open('$file', 'r', encoding='utf-8') as f:
    lines = f.readlines()

out = []
in_chinese_block = False
for line in lines:
    stripped = line.strip()
    # Empty lines: keep (reset block tracking)
    if not stripped:
        in_chinese_block = False
        out.append(line)
        continue
    # Check if line is predominantly non-ASCII
    # Remove markdown syntax, punctuation, whitespace first
    content = re.sub(r'[#*\-_\[\](){}|:;,.\s\d<>=/+\`~!?@&^%]', '', stripped)
    if not content:
        out.append(line)
        continue
    ascii_chars = sum(1 for c in content if ord(c) < 128)
    total_chars = len(content)
    # If less than 20% ASCII content, it's a Chinese-dominant line -> delete
    if total_chars > 0 and (ascii_chars / total_chars) < 0.2:
        in_chinese_block = True
        continue  # skip this line
    else:
        in_chinese_block = False
        out.append(line)

# Remove trailing blank lines that result from deletion
while out and out[-1].strip() == '' and len(out) > 1 and out[-2].strip() == '':
    out.pop()

with open('$file', 'w', encoding='utf-8') as f:
    f.writelines(out)
" 2>/dev/null || true

    # Phase 4: Final check - replace any remaining non-ASCII with '?'
    # (catches edge cases like rare Unicode math symbols)
    if grep -Pq '[^\x00-\x7F]' "$file" 2>/dev/null; then
        python3 -c "
import sys
with open('$file', 'r', encoding='utf-8') as f:
    content = f.read()
out = []
for ch in content:
    if ord(ch) > 127:
        # Skip emoji-like chars in markdown comments (<!-- -->)
        out.append('?')
    else:
        out.append(ch)
with open('$file', 'w', encoding='utf-8') as f:
    f.write(''.join(out))
" 2>/dev/null || true
    fi

    MODIFIED=$((MODIFIED + 1))
done

echo ""
echo -e "${GREEN}Done.${NC} Modified: $MODIFIED files, Skipped: $SKIPPED files."

if ! $DRY_RUN; then
    # Final verification
    REMAINING=$(grep -rPl '[^\x00-\x7F]' --include='*.md' docs/ 2>/dev/null | wc -l)
    if [ "$REMAINING" -eq 0 ]; then
        echo -e "${GREEN}All docs/*.md files are now ASCII-clean.${NC}"
    else
        echo -e "${YELLOW}Warning: $REMAINING files still have non-ASCII characters.${NC}"
        grep -rPl '[^\x00-\x7F]' --include='*.md' docs/ 2>/dev/null | head -10
    fi
fi
