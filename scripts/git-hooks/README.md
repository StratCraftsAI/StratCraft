# Git Hooks for StratCraft

535 Root Cause Fix**: Automated validation hooks to prevent lockfile corruption and test inconsistencies.

## Installation

Run the setup script to install hooks:

```bash
./scripts/setup-git-hooks.sh
```

This will install the following hooks:
- `pre-commit`: Validates pnpm-lock.yaml integrity and checks for test issues

## Hooks Overview

### Pre-commit Hook

Runs before every commit to validate:

#### Lockfile Validation
1. **Merge Conflict Detection**: Checks for `<<<<<<<`, `=======`, `>>>>>>>` markers
2. **Lockfile Integrity**: Validates with `pnpm install --frozen-lockfile --dry-run`
3. **Missing Git Dependencies**: Ensures all git dependencies have lockfile entries

**What it prevents**:
- Committing broken lockfiles after merge conflicts
- Committing out-of-sync lockfiles
- Missing dependency entries (like the @electron/node-gyp incident)

**Example failure**:
```
[FAIL] ERROR: pnpm-lock.yaml contains merge conflict markers
   Resolve merge conflicts and regenerate lockfile with:
   pnpm install --no-frozen-lockfile
```

#### Test Assertion Validation
1. **Hardcoded Error Messages**: Warns when tests use hardcoded error strings instead of constants

**What it prevents**:
- Test failures after error message refactoring
- Inconsistencies between production and test code

**Example warning**:
```
??  WARNING: Tests may contain hardcoded error messages:
  - apps/desktop/src/main/ipc/__tests__/plugin-handlers.test.ts
   Consider using ERROR_MESSAGES constants instead
   Example: toThrow(ERROR_MESSAGES.PLUGIN_ACCESS_DENIED)
```

## Bypassing Hooks

**Not recommended**, but if absolutely necessary:

```bash
git commit --no-verify
```

?? **Warning**: Bypassing hooks may result in CI failures and broken builds.

## Troubleshooting

### Hook not running

Check if hook is executable:
```bash
ls -la .git/hooks/pre-commit
```

If not, make it executable:
```bash
chmod +x .git/hooks/pre-commit
```

### Lockfile validation fails

If the hook reports lockfile issues:

1. **Merge conflicts**: Resolve conflicts, then run:
   ```bash
   pnpm install --no-frozen-lockfile
   git add pnpm-lock.yaml
   ```

2. **Out of sync**: Regenerate lockfile:
   ```bash
   pnpm install
   git add pnpm-lock.yaml
   ```

3. **Missing git dependencies**: Full regeneration:
   ```bash
   pnpm install --no-frozen-lockfile
   git add pnpm-lock.yaml
   ```

### Test validation warnings

If the hook warns about hardcoded error messages:

1. Create/use centralized error constants:
   ```typescript
   import { ERROR_MESSAGES } from '../constants/error-messages';
   ```

2. Replace hardcoded strings:
   ```typescript
   // Before
   expect(() => fn()).toThrow('Access denied');

   // After
   expect(() => fn()).toThrow(ERROR_MESSAGES.PLUGIN_ACCESS_DENIED);
   ```

## CI Integration

These validations also run in CI via GitHub Actions:

- **Workflow**: `.github/workflows/lockfile-validation.yml`
- **Runs on**: All PRs touching `pnpm-lock.yaml` or `package.json`
- **Required check**: Yes (blocks merge if fails)

## Manual Testing

Test the pre-commit hook manually:

```bash
# Test lockfile validation
git add pnpm-lock.yaml
git commit -m "test" --dry-run

# Test test validation
git add apps/desktop/src/**/*.test.ts
git commit -m "test" --dry-run
```

## Maintenance

### Updating Hooks

1. Edit `scripts/git-hooks/pre-commit`
2. Run `./scripts/setup-git-hooks.sh` to reinstall
3. Test with a dry-run commit

### Disabling Hooks Temporarily

```bash
# Disable for single commit
git commit --no-verify

# Disable globally (not recommended)
git config --local core.hooksPath /dev/null
```

## References

- [Dependabot Lockfile Merge Conflict](../../docs/design/_DEPENDABOT_LOCKFILE_MERGE_CONFLICT.md)
- [Test Assertions Error Constant Mismatch](../../docs/design/_TEST_ASSERTIONS_ERROR_CONSTANT_MISMATCH.md)
