#!/bin/bash
# scripts/install_hooks.sh
# TICKET_471_3: Install StratCraft git hooks from .githooks/ to .git/hooks/
# Usage: ./scripts/install_hooks.sh

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_SRC="${PROJECT_DIR}/.githooks"
HOOKS_DST="${PROJECT_DIR}/.git/hooks"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}[INFO]${NC} Installing StratCraft git hooks..."

if [ ! -d "${HOOKS_DST}" ]; then
    echo -e "${RED}[ERROR]${NC} Not a git repository: ${PROJECT_DIR}"
    exit 1
fi

if [ ! -d "${HOOKS_SRC}" ]; then
    echo -e "${RED}[ERROR]${NC} Hooks source directory not found: ${HOOKS_SRC}"
    exit 1
fi

INSTALLED=0
for hook in "${HOOKS_SRC}"/*; do
    [ -f "${hook}" ] || continue
    hook_name="$(basename "${hook}")"
    cp "${hook}" "${HOOKS_DST}/${hook_name}"
    chmod +x "${HOOKS_DST}/${hook_name}"
    echo -e "${GREEN}[INSTALLED]${NC} ${hook_name}"
    INSTALLED=$((INSTALLED + 1))
done

if [ $INSTALLED -eq 0 ]; then
    echo -e "${RED}[ERROR]${NC} No hooks found in ${HOOKS_SRC}"
    exit 1
fi

echo -e "${GREEN}[SUCCESS]${NC} ${INSTALLED} git hook(s) installed"
