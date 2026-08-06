#!/bin/bash
# Build lifecycle scripts (TypeScript -> JavaScript)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Building lifecycle scripts..."

# Compile TypeScript files
npx tsc \
  --target ES2020 \
  --module commonjs \
  --moduleResolution node \
  --esModuleInterop \
  --skipLibCheck \
  --outDir "$SCRIPT_DIR" \
  "$SCRIPT_DIR"/*.ts

echo "✓ Lifecycle scripts compiled"
