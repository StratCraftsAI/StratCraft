#!/bin/bash
# Plugin Initialization Verification Script
# Checks if default plugins have properly compiled lifecycle scripts

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PLUGINS_DIR="$ROOT_DIR/plugins"

echo "🔍 Verifying plugin initialization scripts..."
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track verification status
ALL_OK=true

# Function to check a single plugin
check_plugin() {
    local plugin_path="$1"
    local plugin_name=$(basename "$plugin_path")

    echo "Checking plugin: $plugin_name"

    # Check manifest.json
    local manifest_path="$plugin_path/manifest.json"
    if [ ! -f "$manifest_path" ]; then
        echo -e "  ${YELLOW}⚠${NC}  No manifest.json found (skipping)"
        echo ""
        return 0
    fi

    # Check if plugin has onInstall lifecycle hook declared
    local has_oninstall=$(node -pe "
        const fs = require('fs');
        const manifest = JSON.parse(fs.readFileSync('$manifest_path', 'utf-8'));
        manifest.lifecycle?.onInstall ? 'yes' : 'no';
    ")

    if [ "$has_oninstall" = "no" ]; then
        echo -e "  ${GREEN}✓${NC}  No onInstall hook declared (OK)"
        echo ""
        return 0
    fi

    # Get the script path from manifest
    local script_path=$(node -pe "
        const fs = require('fs');
        const manifest = JSON.parse(fs.readFileSync('$manifest_path', 'utf-8'));
        manifest.lifecycle?.onInstall || '';
    ")

    if [ -z "$script_path" ]; then
        echo -e "  ${RED}✗${NC}  onInstall hook path is empty"
        ALL_OK=false
        echo ""
        return 1
    fi

    # Check if script file exists (should be .js, not .ts)
    local full_script_path="$plugin_path/$script_path"
    if [ ! -f "$full_script_path" ]; then
        echo -e "  ${RED}✗${NC}  Script file not found: $script_path"
        echo -e "      ${YELLOW}Hint:${NC} Run 'npm run compile:plugins' to compile lifecycle scripts"
        ALL_OK=false
        echo ""
        return 1
    fi

    # Check if it's a compiled .js file
    if [[ "$script_path" != *.js ]]; then
        echo -e "  ${YELLOW}⚠${NC}  Script path points to non-.js file: $script_path"
        echo -e "      ${YELLOW}Hint:${NC} Manifest should point to compiled .js file, not .ts"
        ALL_OK=false
        echo ""
        return 1
    fi

    # Check if script contains Database Protocol usage (basic check)
    # Look for either "context.database" or "database" (from destructuring)
    if grep -qE "(context\.database|const \{ database \}|database\.(execute|query|transaction))" "$full_script_path" 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC}  Script exists: $script_path"
        echo -e "  ${GREEN}✓${NC}  Database Protocol usage found"
    else
        echo -e "  ${GREEN}✓${NC}  Script exists: $script_path"
        echo -e "  ${YELLOW}⚠${NC}  No Database Protocol usage detected (might be intentional)"
    fi

    echo ""
    return 0
}

# Check if plugins directory exists
if [ ! -d "$PLUGINS_DIR" ]; then
    echo -e "${RED}✗ Plugins directory not found: $PLUGINS_DIR${NC}"
    exit 1
fi

# Check all plugins in the plugins directory
plugin_count=0
for plugin_dir in "$PLUGINS_DIR"/*; do
    if [ -d "$plugin_dir" ]; then
        check_plugin "$plugin_dir"
        plugin_count=$((plugin_count + 1))
    fi
done

if [ $plugin_count -eq 0 ]; then
    echo -e "${YELLOW}⚠ No plugins found in $PLUGINS_DIR${NC}"
    exit 0
fi

# Final summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$ALL_OK" = true ]; then
    echo -e "${GREEN}✓ All plugin lifecycle scripts verified successfully${NC}"
    echo ""
    exit 0
else
    echo -e "${RED}✗ Plugin verification failed${NC}"
    echo ""
    echo "Possible fixes:"
    echo "  1. Compile plugin lifecycle scripts:"
    echo "     cd plugins/<plugin-name>"
    echo "     npx tsc scripts/install.ts --target ES2020 --module commonjs"
    echo ""
    echo "  2. Verify manifest.json points to .js file, not .ts"
    echo ""
    exit 1
fi
