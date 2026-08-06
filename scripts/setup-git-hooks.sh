#!/bin/bash
# TICKET_534/535 Root Cause Fix: Setup Git Hooks
# This script installs pre-commit hooks for lockfile and test validation

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GIT_HOOKS_DIR="$REPO_ROOT/.git/hooks"

echo "🔧 Setting up Git hooks for StratCraft..."

# Check if we're in a git repository
if [ ! -d "$REPO_ROOT/.git" ]; then
  echo "❌ Error: Not in a git repository"
  exit 1
fi

# Create hooks directory if it doesn't exist
mkdir -p "$GIT_HOOKS_DIR"

# Install pre-commit hook
echo "📝 Installing pre-commit hook..."
if [ -f "$GIT_HOOKS_DIR/pre-commit" ]; then
  echo "⚠️  Warning: pre-commit hook already exists, backing up to pre-commit.backup"
  cp "$GIT_HOOKS_DIR/pre-commit" "$GIT_HOOKS_DIR/pre-commit.backup"
fi

cp "$SCRIPT_DIR/git-hooks/pre-commit" "$GIT_HOOKS_DIR/pre-commit"
chmod +x "$GIT_HOOKS_DIR/pre-commit"

echo "✅ Git hooks installed successfully"
echo ""
echo "Installed hooks:"
echo "  - pre-commit: Validates pnpm-lock.yaml integrity (TICKET_534)"
echo "  - pre-commit: Warns about hardcoded error messages in tests (TICKET_535)"
echo ""
echo "To bypass hooks (not recommended):"
echo "  git commit --no-verify"
