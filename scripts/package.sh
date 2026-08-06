#!/bin/bash
# Package script for creating distributable StratCraft installers

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

PLATFORM=${1:-"all"}

echo "📦 Packaging StratCraft..."

# Build first
"$SCRIPT_DIR/build.sh"

# Package
cd "$ROOT_DIR/apps/desktop"

case $PLATFORM in
    "win" | "windows")
        echo "🪟 Packaging for Windows..."
        pnpm run package:win
        ;;
    "mac" | "macos")
        echo "🍎 Packaging for macOS..."
        pnpm run package:mac
        ;;
    "linux")
        echo "🐧 Packaging for Linux..."
        pnpm run package:linux
        ;;
    "all")
        echo "📦 Packaging for all platforms..."
        pnpm run package
        ;;
    *)
        echo "❌ Unknown platform: $PLATFORM"
        echo "Usage: $0 [win|mac|linux|all]"
        exit 1
        ;;
esac

echo ""
echo "✅ Packaging complete!"
echo "   Output: apps/desktop/release/"
