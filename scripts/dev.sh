#!/bin/bash
# Development startup script for StratCraft
# Starts all services in development mode

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🚀 Starting StratCraft Development Environment..."

# Clean plugin data in development (trigger onInstall every time)
# Set KEEP_PLUGIN_DATA=1 to skip cleanup
if [ "${KEEP_PLUGIN_DATA:-0}" = "0" ]; then
    PLUGIN_DATA_DIR="$HOME/.config/@StratCraft/desktop/plugin-data"
    if [ -d "$PLUGIN_DATA_DIR" ]; then
        echo "🗑️  Cleaning plugin data (to trigger onInstall)..."
        echo "   Path: $PLUGIN_DATA_DIR"
        rm -rf "$PLUGIN_DATA_DIR"
        echo "   Tip: Use KEEP_PLUGIN_DATA=1 ./scripts/dev.sh to keep data"
    fi
else
    echo "📦 Keeping plugin data (skipping onInstall)"
fi

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down services..."
    kill 0 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Start Python server
echo "📦 Starting Python server..."
cd "$ROOT_DIR/apps/server"
if command -v uv &> /dev/null; then
    uv run python -m src.main &
else
    python -m src.main &
fi
SERVER_PID=$!

# Wait for server to be ready
echo "⏳ Waiting for server to start..."
for i in {1..30}; do
    if curl -s http://127.0.0.1:8765/health > /dev/null 2>&1; then
        echo "✅ Server is ready!"
        break
    fi
    sleep 1
done

# Verify plugin initialization scripts
echo "🔍 Verifying plugin initialization..."
"$SCRIPT_DIR/verify-plugin-init.sh" || {
    echo "❌ Plugin verification failed. Please fix the issues above."
    kill $SERVER_PID 2>/dev/null
    exit 1
}

# Start Electron app
echo "🖥️  Starting Electron app..."
cd "$ROOT_DIR/apps/desktop"
pnpm run dev &
ELECTRON_PID=$!

echo ""
echo "✅ StratCraft is running!"
echo "   - Server: http://127.0.0.1:8765"
echo "   - Press Ctrl+C to stop all services"
echo ""

# Wait for all processes
wait
