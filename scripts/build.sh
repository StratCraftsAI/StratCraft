#!/bin/bash
# Production build script for StratCraft

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🔨 Building StratCraft..."

# Build shared packages first
echo "📦 Building shared packages..."
cd "$ROOT_DIR"
pnpm run build --filter=@StratCraft/types --filter=@StratCraft/sdk-core

# Build server (if needed)
echo "📦 Building server..."
cd "$ROOT_DIR/apps/server"
if command -v uv &> /dev/null; then
    uv pip compile pyproject.toml -o requirements.txt
fi

# Build desktop app
echo "🖥️  Building desktop app..."
cd "$ROOT_DIR/apps/desktop"
pnpm run build

# Verify plugin initialization scripts
echo ""
echo "🔍 Verifying plugin initialization..."
"$SCRIPT_DIR/verify-plugin-init.sh" || {
    echo ""
    echo "❌ Plugin verification failed. Build completed but plugins may not work correctly."
    echo "   Please fix the issues above before packaging or deploying."
    exit 1
}

echo ""
echo "✅ Build complete!"
echo "   Output: apps/desktop/dist/"
