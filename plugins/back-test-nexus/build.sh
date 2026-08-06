#!/bin/bash
#
# back-test-nexus Plugin Build Script
#
# Backtest engine is the C++ stratforge-runner (TICKET_681). No engine build
# is required from this plugin; only the UI build is meaningful here.
#
# Usage:
#   ./build.sh          # No-op (C++ executor handles backtest)
#   ./build.sh ui       # Build UI components
#   ./build.sh clean    # Clean UI build artifacts
#   ./build.sh all      # Build UI (alias for ./build.sh ui)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Engine build is a no-op: C++ executor (stratforge-runner) owns backtest
# execution per TICKET_681.
build_engine() {
    log_info "No engine build required (C++ executor handles backtest, see TICKET_681)"
}

# Build UI
build_ui() {
    log_info "Building UI components..."

    local UI_DIR="$SCRIPT_DIR/ui"

    if [ ! -f "$UI_DIR/package.json" ]; then
        log_warn "UI package.json not found, skipping"
        return 0
    fi

    # Detect package manager
    if command -v pnpm &> /dev/null; then
        PM="pnpm"
    else
        PM="npm"
    fi

    (cd "$UI_DIR" && $PM install && $PM run build) || {
        log_error "UI build failed"
        return 1
    }

    log_info "UI build complete"
}

# Clean UI build artifacts only (engine build was removed under TICKET_751_2).
clean() {
    log_info "Cleaning UI build artifacts..."

    local UI_DIST="$SCRIPT_DIR/ui/dist"

    if [ -d "$UI_DIST" ]; then
        rm -rf "$UI_DIST"
        log_info "Removed $UI_DIST"
    fi

    log_info "Clean complete"
}

# Show help
show_help() {
    echo "back-test-nexus Plugin Build Script"
    echo ""
    echo "Usage: ./build.sh [command]"
    echo ""
    echo "Commands:"
    echo "  (none)    No-op (C++ executor handles backtest, see TICKET_681)"
    echo "  ui        Build UI components"
    echo "  clean     Clean UI build artifacts"
    echo "  all       Build UI (alias for ./build.sh ui)"
    echo "  help      Show this help"
}

# Main
case "${1:-}" in
    ui|u)
        build_ui
        ;;
    clean|c)
        clean
        ;;
    all|a)
        build_ui
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        build_engine
        ;;
esac
