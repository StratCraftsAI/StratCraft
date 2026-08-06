#!/bin/bash
# Run Electron app in headless mode with virtual display

echo "🚀 Starting StratCraft Desktop in headless mode..."

# Check if Xvfb is installed
if ! command -v Xvfb &> /dev/null; then
    echo "❌ Xvfb not found. Installing..."
    sudo apt-get update
    sudo apt-get install -y xvfb
fi

# Run with virtual display
echo "✅ Running with Xvfb virtual display..."
xvfb-run -a npm run dev

echo "👋 Application stopped"
