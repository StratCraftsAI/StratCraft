#!/bin/bash
# Setup script for StratCraft development environment

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🔧 Setting up StratCraft development environment..."

# Check prerequisites
echo "📋 Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 20+."
    exit 1
fi
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "❌ Node.js 20+ is required. Current version: $(node -v)"
    exit 1
fi
echo "   ✅ Node.js $(node -v)"

# Check pnpm
if ! command -v pnpm &> /dev/null; then
    echo "   ⚠️  pnpm not found. Installing..."
    npm install -g pnpm
fi
echo "   ✅ pnpm $(pnpm -v)"

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3.11+."
    exit 1
fi
PYTHON_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "   ✅ Python $PYTHON_VERSION"

# Check uv (optional but recommended)
if command -v uv &> /dev/null; then
    echo "   ✅ uv $(uv --version)"
else
    echo "   ⚠️  uv not found. Using pip instead."
    echo "      Install uv for faster Python package management: pip install uv"
fi

# Install Node.js dependencies
echo ""
echo "📦 Installing Node.js dependencies..."
cd "$ROOT_DIR"
pnpm install

# Install Python dependencies
echo ""
echo "🐍 Installing Python dependencies..."
cd "$ROOT_DIR/apps/server"
if command -v uv &> /dev/null; then
    uv sync
else
    pip install -e ".[dev]"
fi

# Create .env file if not exists
if [ ! -f "$ROOT_DIR/.env" ]; then
    echo ""
    echo "📝 Creating .env file..."
    cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "   To start development:"
echo "   $ make dev"
echo ""
echo "   Or run individual services:"
echo "   $ pnpm --filter @StratCraft/desktop dev"
echo "   $ cd apps/server && uv run python -m src.main"
