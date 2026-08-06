#!/bin/bash
# scripts/check_architecture_rules.sh
# TICKET_636_5: Architecture rule enforcement
# Validates structural rules: tier imports, preload boundary, prohibited patterns.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

EXIT_CODE=0

# ============================================================
# Rule 1: No direct Node.js API usage in renderer
# ============================================================
echo "=== Renderer Boundary Check ==="

RENDERER_FILES=()
while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    RENDERER_FILES+=("$PROJECT_ROOT/$f")
done < <(cd "$PROJECT_ROOT" && git ls-files -- \
    'apps/desktop/src/renderer/**/*.ts' \
    'apps/desktop/src/renderer/**/*.tsx' \
    2>/dev/null | grep -v 'node_modules/' | \
    grep -v '.test.' | \
    grep -v '.spec.' | \
    grep -v '__tests__/')

NODE_API_IN_RENDERER=""
if [ ${#RENDERER_FILES[@]} -gt 0 ]; then
    NODE_API_IN_RENDERER=$(grep -n "require('fs')\|require('path')\|require('child_process')\|require('os')\|require('crypto')\|from 'fs'\|from 'path'\|from 'child_process'\|from 'os'" "${RENDERER_FILES[@]}" 2>/dev/null | \
        grep -v '// allowed' | \
        grep -v 'type.*import' | \
        head -20 || true)
fi

if [ -n "$NODE_API_IN_RENDERER" ]; then
    echo -e "${RED}FAIL${NC}: Direct Node.js API usage in renderer (must use preload bridge):"
    echo "$NODE_API_IN_RENDERER"
    EXIT_CODE=1
else
    echo -e "${GREEN}PASS${NC}: No direct Node.js API in renderer."
fi

# ============================================================
# Rule 2: No upward tier imports (Tier 0 importing Tier 1)
# ============================================================
echo ""
echo "=== Plugin Tier Import Check ==="

# Tier 0 plugins (foundation)
TIER0_PLUGINS=("data-plugin")
# Tier 1 plugins (business)
TIER1_PLUGINS=("strategy-builder-nexus" "back-test-nexus" "quant-lab-nexus" "signal-generator-nexus")

TIER_VIOLATION=0
for t0_plugin in "${TIER0_PLUGINS[@]}"; do
    T0_DIR="$PROJECT_ROOT/plugins/$t0_plugin"
    if [ ! -d "$T0_DIR" ]; then
        continue
    fi

    T0_FILES=()
    while IFS= read -r f; do
        [[ -z "$f" ]] && continue
        T0_FILES+=("$f")
    done < <(find "$T0_DIR" -name '*.ts' -o -name '*.tsx' 2>/dev/null | grep -v 'node_modules/' | grep -v '/dist/')

    if [ ${#T0_FILES[@]} -eq 0 ]; then
        continue
    fi

    for t1_plugin in "${TIER1_PLUGINS[@]}"; do
        # Match actual import/require statements, not comments
        UPWARD_IMPORTS=$(grep -Pn "^\s*import\s.*$t1_plugin|^\s*from\s.*$t1_plugin|require\(['\"].*$t1_plugin" "${T0_FILES[@]}" 2>/dev/null | \
            grep -v '^\s*//' | \
            grep -v '^\s*\*' | \
            head -5 || true)
        if [ -n "$UPWARD_IMPORTS" ]; then
            echo -e "${RED}FAIL${NC}: Tier 0 plugin '$t0_plugin' imports Tier 1 plugin '$t1_plugin':"
            echo "$UPWARD_IMPORTS"
            TIER_VIOLATION=1
            EXIT_CODE=1
        fi
    done
done

if [ $TIER_VIOLATION -eq 0 ]; then
    echo -e "${GREEN}PASS${NC}: No upward tier import violations."
fi

# ============================================================
# Rule 3: No electron/Node.js imports in shared/ code
# ============================================================
echo ""
echo "=== Shared Module Boundary Check ==="

SHARED_FILES=()
while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    SHARED_FILES+=("$PROJECT_ROOT/$f")
done < <(cd "$PROJECT_ROOT" && git ls-files -- \
    'apps/desktop/src/shared/**/*.ts' \
    2>/dev/null | grep -v 'node_modules/' | \
    grep -v '.test.' | \
    grep -v '.spec.')

ELECTRON_IN_SHARED=""
if [ ${#SHARED_FILES[@]} -gt 0 ]; then
    ELECTRON_IN_SHARED=$(grep -n "from 'electron'\|require('electron')\|from 'electron/main'" "${SHARED_FILES[@]}" 2>/dev/null | \
        grep -v 'type.*import' | \
        head -10 || true)
fi

if [ -n "$ELECTRON_IN_SHARED" ]; then
    echo -e "${RED}FAIL${NC}: Electron imports in shared/ code (shared must be process-agnostic):"
    echo "$ELECTRON_IN_SHARED"
    EXIT_CODE=1
else
    echo -e "${GREEN}PASS${NC}: No Electron imports in shared/ code."
fi

# ============================================================
# Rule 4: No process.env.NODE_ENV checks that bypass security
# ============================================================
echo ""
echo "=== Security Bypass Pattern Check ==="

SECURITY_FILES=()
while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    SECURITY_FILES+=("$PROJECT_ROOT/$f")
done < <(cd "$PROJECT_ROOT" && git ls-files -- \
    'apps/desktop/src/preload/**/*.ts' \
    'apps/desktop/src/main/ipc/**/*.ts' \
    2>/dev/null | grep -v 'node_modules/' | \
    grep -v '.test.' | \
    grep -v '__tests__/')

BYPASS_PATTERNS=""
if [ ${#SECURITY_FILES[@]} -gt 0 ]; then
    BYPASS_PATTERNS=$(grep -n "nodeIntegration.*true\|contextIsolation.*false\|webSecurity.*false\|sandbox.*false" "${SECURITY_FILES[@]}" 2>/dev/null | \
        grep -v '// test-only' | \
        head -10 || true)
fi

if [ -n "$BYPASS_PATTERNS" ]; then
    echo -e "${RED}FAIL${NC}: Security bypass patterns found in IPC/preload:"
    echo "$BYPASS_PATTERNS"
    EXIT_CODE=1
else
    echo -e "${GREEN}PASS${NC}: No security bypass patterns."
fi

# ============================================================
# Rule 5: No require() in ESM-only zones (renderer)
# ============================================================
echo ""
echo "=== ESM Compliance Check ==="

CJS_IN_RENDERER=""
if [ ${#RENDERER_FILES[@]} -gt 0 ]; then
    CJS_IN_RENDERER=$(grep -n "require(" "${RENDERER_FILES[@]}" 2>/dev/null | \
        grep -v 'import.*require' | \
        grep -v '// cjs-allowed' | \
        grep -v 'require.context' | \
        grep -v '__non_webpack_require__' | \
        head -10 || true)
fi

if [ -n "$CJS_IN_RENDERER" ]; then
    CJS_COUNT=$(echo "$CJS_IN_RENDERER" | wc -l)
    echo -e "${YELLOW}WARN${NC}: $CJS_COUNT require() calls in renderer (should use ESM import):"
    echo "$CJS_IN_RENDERER" | head -5
else
    echo -e "${GREEN}PASS${NC}: No CJS require() in renderer."
fi

# ============================================================
# TICKET_809_1 Phase 7 (TICKET_809_7) -- Credential discipline rules
# ============================================================
echo ""
echo "=== Credential Discipline Check (TICKET_809_7) ==="

PLUGIN_FILES=()
while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    PLUGIN_FILES+=("$PROJECT_ROOT/$f")
done < <(cd "$PROJECT_ROOT" && git ls-files -- \
    'plugins/**/*.ts' \
    'plugins/**/*.tsx' \
    2>/dev/null | grep -v 'node_modules/' | \
    grep -v '/dist/' | \
    grep -v '.test.' | \
    grep -v '.spec.' | \
    grep -v '__tests__/' | \
    grep -v '/config/llm-provider-ui\.ts$')

# ------------------------------------------------------------
# Rule 7.1: Plugin code must not call credential.set / credential.delete
# directly. Credentials flow through the host SecretsPanel +
# CredentialRegistry. Reads (credential.get / credential.has /
# credential.list) remain permitted because consuming a configured
# credential is the whole point of having one.
#
# Exemptions (legacy, tracked by TICKET_809_4a follow-up):
#   - plugins/strategy-builder-nexus/src/components/settings/LLMSettingsPanel.tsx
#   - plugins/strategy-builder-nexus/src/components/ui/BYOKSetupDialog.tsx
#   - plugins/back-test-nexus/ui/src/components/settings/SecretsTab.tsx
# These three files retain their own credential UI because the
# plugin loader does not yet support importing host renderer
# components. The lint rule allowlists them by exact path so any
# *new* in-plugin credential mutation is flagged.
# ------------------------------------------------------------

CRED_MUTATION_VIOLATIONS=""
if [ ${#PLUGIN_FILES[@]} -gt 0 ]; then
    CRED_MUTATION_VIOLATIONS=$(grep -nE "credential\.(set|delete|setMasterPassword)\b" "${PLUGIN_FILES[@]}" 2>/dev/null | \
        grep -v 'plugins/strategy-builder-nexus/src/components/settings/LLMSettingsPanel.tsx' | \
        grep -v 'plugins/strategy-builder-nexus/src/components/ui/BYOKSetupDialog.tsx' | \
        grep -v 'plugins/back-test-nexus/ui/src/components/settings/SecretsTab.tsx' | \
        grep -v '// allow-credential-mutation' | \
        head -10 || true)
fi

if [ -n "$CRED_MUTATION_VIOLATIONS" ]; then
    echo -e "${RED}FAIL${NC}: Plugin code mutating credentials directly (use host SecretsPanel via CredentialRegistry, or add a documented exemption):"
    echo "$CRED_MUTATION_VIOLATIONS"
    EXIT_CODE=1
else
    echo -e "${GREEN}PASS${NC}: No new in-plugin credential mutations."
fi

# ------------------------------------------------------------
# Rule 7.2: Renderer code that operates on a credential must reference
# the HOST_PLUGIN_ID constant exported from
# apps/desktop/src/shared/types/credential-contribution.ts rather than
# the bare string literal 'host'. The literal is fine in the contribution
# files themselves (host-side modules already import the constant)
# and inside the three exempt plugin files above (where the literal is
# duplicated per TICKET_809_2 section 6.4 because renderer cannot import
# from main).
# ------------------------------------------------------------

RENDERER_HOST_LITERAL_VIOLATIONS=""
if [ ${#RENDERER_FILES[@]} -gt 0 ]; then
    # Match  credential.<op>(..., 'host' ...)  or  credential.<op>("host" ...)
    RENDERER_HOST_LITERAL_VIOLATIONS=$(grep -nE "credential\.(get|set|has|delete|list|getAuditLog|executeWith)\([^)]*['\"]host['\"]" "${RENDERER_FILES[@]}" 2>/dev/null | \
        grep -v 'credential-contribution\.ts' | \
        grep -v 'credential-registry\.ts' | \
        grep -v '// allow-host-literal' | \
        head -10 || true)
fi

if [ -n "$RENDERER_HOST_LITERAL_VIOLATIONS" ]; then
    echo -e "${RED}FAIL${NC}: Renderer credential calls using bare 'host' string literal (import HOST_PLUGIN_ID from @shared/types instead):"
    echo "$RENDERER_HOST_LITERAL_VIOLATIONS"
    EXIT_CODE=1
else
    echo -e "${GREEN}PASS${NC}: Renderer credential calls use HOST_PLUGIN_ID constant."
fi

# ------------------------------------------------------------
# Rule 7.3: No new in-plugin "Settings -> Secrets" or "Settings -> LLM"
# nav items. The canonical surface is System Settings -> Config ->
# Credentials. Detected by grep for nav-item declarations with
# secrets/credential labels added after this rule lands.
#
# Implementation: look for object literals of shape
#   { id: 'secrets', ... }  or  { id: 'credentials', ... }
# inside plugin files. The existing back-test SecretsTab consumer
# is exempt by path because removing it is the deferred TICKET_809_4a
# follow-up.
# ------------------------------------------------------------

PLUGIN_NAV_VIOLATIONS=""
if [ ${#PLUGIN_FILES[@]} -gt 0 ]; then
    PLUGIN_NAV_VIOLATIONS=$(grep -nE "id:\s*['\"](secrets|credentials)['\"]" "${PLUGIN_FILES[@]}" 2>/dev/null | \
        grep -vE 'plugins/back-test-nexus/ui/src/components/settings/SecretsTab\.tsx' | \
        grep -vE 'plugins/strategy-builder-nexus/src/components/settings/PluginSettingsPage\.tsx' | \
        grep -v '// allow-credentials-nav' | \
        head -10 || true)
fi

if [ -n "$PLUGIN_NAV_VIOLATIONS" ]; then
    echo -e "${RED}FAIL${NC}: New in-plugin Settings nav item for secrets/credentials (use the host System Settings -> Credentials surface):"
    echo "$PLUGIN_NAV_VIOLATIONS"
    EXIT_CODE=1
else
    echo -e "${GREEN}PASS${NC}: No new in-plugin secrets/credentials nav items."
fi

# ============================================================
# TICKET_846: TrainingBars unit-contract guardrail
# ============================================================
# After TICKET_845 renamed the Tool Sweep slider from "lookback days" to
# "Training bars", the orchestrator's `lookbackBars * 86400000` arithmetic
# kept treating the value as days and inflated every data window by the
# bars-per-day ratio (24x for 1h, ~7x for 1d). Fix 4 of TICKET_846
# introduced a `TrainingBars` brand that turns this class of unit
# confusion into a TypeScript error -- but only at the brand boundary.
# This grep guard reinforces the boundary on grep-able call shapes so a
# stray `* 86400000` outside the canonical conversion helper is caught
# at commit time rather than at the next degenerate-window failure.
#
# The literal `86400000` (and the underscore-separated form `86_400_000`)
# is allowed ONLY in:
#   - apps/desktop/src/shared/constants/signal-discovery.ts  (definition site)
#   - apps/desktop/src/shared/constants/timing.ts             (MS_PER_DAY)
#   - apps/desktop/src/shared/utils/lookback-constraints.ts   (unrelated "60d" parser)
#   - apps/desktop/src/main/services/data-providers/ccxt-provider.ts (CCXT bar-interval table)
#   - comments / migration banners (line starts with `*` or contains `// allow-86400000`)
# Anywhere else, use `trainingBarsToCalendarMs(bars, timeframe, assetClass)`.
echo ""
echo "=== TrainingBars Unit-Contract Check (TICKET_846) ==="

DAY_LITERAL_VIOLATIONS=""
DAY_LITERAL_FILES=()
while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    DAY_LITERAL_FILES+=("$PROJECT_ROOT/$f")
done < <(cd "$PROJECT_ROOT" && git ls-files -- \
    'apps/desktop/src/main/**/*.ts' \
    'apps/desktop/src/preload/**/*.ts' \
    'apps/desktop/src/shared/**/*.ts' \
    'apps/desktop/src/renderer/**/*.ts' \
    'apps/desktop/src/renderer/**/*.tsx' \
    2>/dev/null | \
    grep -v 'node_modules/' | \
    grep -v '.test.' | \
    grep -v '.spec.' | \
    grep -v '__tests__/' | \
    grep -v 'shared/constants/signal-discovery.ts$' | \
    grep -v 'shared/constants/timing.ts$' | \
    grep -v 'shared/utils/lookback-constraints.ts$' | \
    grep -v 'data-providers/ccxt-provider.ts$')

if [ ${#DAY_LITERAL_FILES[@]} -gt 0 ]; then
    DAY_LITERAL_VIOLATIONS=$(grep -nE "(\*[[:space:]]*86_?400_?000|86_?400_?000[[:space:]]*\*)" "${DAY_LITERAL_FILES[@]}" 2>/dev/null | \
        grep -Ei '(trainingbars|lookbackbars)' | \
        grep -vE '^\s*[A-Za-z0-9_/.-]+:[0-9]+:\s*[/*]' | \
        grep -v '// allow-86400000' | \
        head -20 || true)
fi

if [ -n "$DAY_LITERAL_VIOLATIONS" ]; then
    echo -e "${RED}FAIL${NC}: 'X * 86400000' style ms-per-day arithmetic outside the canonical helper."
    echo "  Use trainingBarsToCalendarMs(bars, timeframe, assetClass) from shared/constants/signal-discovery.ts."
    echo "  (TICKET_846 Fix 4 -- prevents the unit-confusion regression that produced Run #51.)"
    echo "$DAY_LITERAL_VIOLATIONS"
    EXIT_CODE=1
else
    echo -e "${GREEN}PASS${NC}: No raw ms-per-day arithmetic outside the canonical helper."
fi

# ============================================================
# Rule: MCP bridge call-site anti-regression ratchet (TICKET_1276 P2 gate 1)
# ============================================================
echo ""
echo "=== MCP Bridge Call-Site Ratchet ==="

# The ratchet exits non-zero if the live `discoverServiceApi(` count exceeds
# the committed baseline (a new bridge site slipped in). It is a self-contained
# Node ESM script so it needs no build/install step.
if [ "${STRATCRAFT_PUBLIC_TREE:-0}" = "1" ]; then
    echo -e "${GREEN}PASS${NC}: Private bridge migration ratchet is not applicable to the generated public boundary."
elif node "$PROJECT_ROOT/scripts/ci/bridge-call-site-count.mjs"; then
    echo -e "${GREEN}PASS${NC}: MCP bridge call-site count within baseline."
else
    echo -e "${RED}FAIL${NC}: MCP bridge call-site count exceeds baseline (TICKET_1276 P2 gate 1)."
    EXIT_CODE=1
fi

# ============================================================
# Rule: production language/process boundary freeze (TICKET_1292 Phase 0)
# ============================================================
echo ""
echo "=== Modern C++ Production Boundary Freeze ==="

if [ "${STRATCRAFT_PUBLIC_TREE:-0}" = "1" ]; then
    echo -e "${GREEN}PASS${NC}: Private cross-language migration evidence is not applicable to the generated public boundary."
elif node "$PROJECT_ROOT/scripts/ci/modern-cpp-boundary-audit.mjs"; then
    echo -e "${GREEN}PASS${NC}: No unreviewed production boundary was added."
else
    echo -e "${RED}FAIL${NC}: Review and classify the new production boundary in TICKET_1292 evidence."
    EXIT_CODE=1
fi

if [ "${STRATCRAFT_PUBLIC_TREE:-0}" = "1" ]; then
    echo -e "${GREEN}PASS${NC}: Private Phase 0 migration evidence is not applicable to the generated public boundary."
elif node "$PROJECT_ROOT/scripts/ci/modern-cpp-phase0-evidence.mjs"; then
    echo -e "${GREEN}PASS${NC}: Every Modern C++ audit candidate has recorded Phase 0 evidence."
else
    echo -e "${RED}FAIL${NC}: Modern C++ Phase 0 evidence is incomplete or inconsistent."
    EXIT_CODE=1
fi

# ============================================================
# Summary
# ============================================================
echo ""
echo "=== Architecture Rule Summary ==="
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}OK: All architecture rules passed.${NC}"
else
    echo -e "${RED}FAILED: Fix architecture violations above.${NC}"
fi

exit $EXIT_CODE
