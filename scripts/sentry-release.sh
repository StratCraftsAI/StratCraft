#!/usr/bin/env bash
# TICKET_573_2 Phase 2: Sentry Release & Source Map Upload
#
# Creates a Sentry release, associates commits, uploads source maps, and finalizes.
# Run after `npm run build` (or as part of packaging pipeline).
#
# Required environment variables:
#   SENTRY_AUTH_TOKEN  - Sentry API auth token (from sentry.io > Settings > Auth Tokens)
#   SENTRY_ORG        - Sentry organization slug (default: stratcraftsai)
#   SENTRY_PROJECT    - Sentry project slug (default: electron)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env if present
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
fi
DESKTOP_DIR="$PROJECT_ROOT/apps/desktop"

# Read version from package.json
VERSION=$(node -p "require('$DESKTOP_DIR/package.json').version")
RELEASE="stratcraft@${VERSION}"

# Defaults
SENTRY_ORG="${SENTRY_ORG:-stratcraftsai}"
SENTRY_PROJECT="${SENTRY_PROJECT:-electron}"

echo "=== Sentry Release: $RELEASE ==="
echo "Org: $SENTRY_ORG | Project: $SENTRY_PROJECT"

# Validate environment
if [ -z "${SENTRY_AUTH_TOKEN:-}" ]; then
  echo "ERROR: SENTRY_AUTH_TOKEN is not set."
  echo "Get a token from: https://sentry.io/settings/auth-tokens/"
  exit 1
fi

# Check sentry-cli is available
if ! command -v sentry-cli &> /dev/null; then
  echo "ERROR: sentry-cli not found. Install with: npm install -g @sentry/cli"
  exit 1
fi

# Check dist directory exists
if [ ! -d "$DESKTOP_DIR/dist" ]; then
  echo "ERROR: $DESKTOP_DIR/dist not found. Run 'npm run build' first."
  exit 1
fi

# 1. Create release
echo "Creating release..."
sentry-cli releases new "$RELEASE" \
  --org "$SENTRY_ORG" \
  --project "$SENTRY_PROJECT"

# 2. Associate commits (auto-detect from git)
echo "Associating commits..."
sentry-cli releases set-commits "$RELEASE" --auto \
  --org "$SENTRY_ORG"

# 3. Upload source maps (sentry-cli v3: sourcemaps upload)
echo "Uploading source maps from dist/..."
sentry-cli sourcemaps upload "$DESKTOP_DIR/dist" \
  --release "$RELEASE" \
  --org "$SENTRY_ORG" \
  --project "$SENTRY_PROJECT"

# 4. Finalize release
echo "Finalizing release..."
sentry-cli releases finalize "$RELEASE" \
  --org "$SENTRY_ORG"

echo "=== Sentry release $RELEASE complete ==="
