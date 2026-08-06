# PLUGIN_Remove Tier 1 Same-Tier Import Prohibition

## Status: COMPLETED

## Parent: PLUGIN_TICKET_009 (Third-Party Plugin Directory Structure)

## Related:  (Closed-Source Freemium)

## Problem

PLUGIN_TICKET_009 originally enforced **same-tier import prohibition**: Tier 1 plugins could not import from other Tier 1 plugins. This rule was designed for open-source/marketplace plugin distribution, where isolation between independently distributed plugins is essential.

 confirmed StratCraft is closed-source freemium. All Tier 1 plugins (`strategy-builder-nexus`, `back-test-nexus`, `quant-lab-nexus`) are bundled in the same repository and shipped together. The same-tier prohibition now causes unnecessary code duplication:

- Copied `downsample-utils.ts` between plugins instead of importing
- Duplicated 12 functions between `back-test-nexus` and `quant-lab-nexus`
- `DiscoveryProgressPanel` duplicated ~120 lines of `highlightPython` + `SignalCodeDisplay` that already existed as `CodeDisplay` in `strategy-builder-nexus`

## Solution

Remove the same-tier import prohibition. The updated dependency rule:

```
Tier 0 (Foundation)              <-- Can be imported by any Tier 1 plugin
   ^           ^
   |           |
Tier 1A <---> Tier 1B            <-- Same-tier imports ALLOWED
(builder)   (quant-lab)
```

**Allowed**:
- Tier 1 may import Tier 0 (downward dependency)
- Tier 1 may import other Tier 1 (same-tier dependency)
- Any plugin may call host-layer IPC APIs

**Prohibited**:
- Tier 0 must NOT import Tier 1 (no upward dependency)

## Changes Made

### Documentation (5 files)
1. `CLAUDE.md` (line 28) - Updated tier rule description
2. `scripts/CLAUDE.md.public` (line 22) - Same change for public export
3. `docs/plugin/PLUGIN_TICKET_009_THIRD_PARTY_PLUGIN_DIRECTORY_STRUCTURE.md` - Updated dependency diagram, rules, and enforcement description
4. `docs/plugin/QUICKSTART.md` - Updated tier table and rule text
5. `docs/plugin/PLUGIN_MANIFEST_REFERENCE.md` - Updated tier table and verifier rules

### Code (2 files)
6. `apps/desktop/tests/system/plugin-system.system.test.ts` - Changed `validatePlugin()` to reject upward dependencies (Tier 0 -> Tier 1) instead of same-tier; updated test case; added new "rejects upward dependency" test
7. `plugins/quant-lab-nexus/ui/quant-lab-nexus/src/components/DiscoveryProgressPanel.tsx` - Removed ~120 lines of duplicated `highlightPython` + `SignalCodeDisplay`, replaced with `CodeDisplay` import from `strategy-builder-nexus`

### Config (1 file)
8. `plugins/quant-lab-nexus/ui/quant-lab-nexus/tsconfig.json` - Added `@plugins/strategy-builder-nexus/*` path alias

## Import Pattern

Tier 1 plugins reference other Tier 1 plugins via path alias in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@plugins/strategy-builder-nexus/*": ["../../../strategy-builder-nexus/src/*"]
    }
  }
}
```

## Verification

- Plugin system test: 12/12 tests pass (including new "allows same-tier dependency" and "rejects upward dependency" tests)
- TypeScript: No new errors in `DiscoveryProgressPanel.tsx`
