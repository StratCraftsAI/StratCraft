/**
 * TICKET_1298 Phase 0 integration boundary:
 * bundled catalog -> validation -> platform selection -> shared path identity
 * -> immutable plan. No external boundary is mocked because this slice must
 * remain deterministic and mutation-free.
 */
import { describe, expect, it } from 'vitest';
import {
  BUNDLED_MANAGED_TOOL_CATALOG,
  planManagedToolInstall,
  resolveManagedToolStorePaths,
} from './index';

describe('managed-tool Phase 0 integration', () => {
  it('gives Electron and standalone MCP the same authoritative plan', () => {
    const electronUserDataRoot = '/home/alice/.config/@StratCraft/desktop';
    const standaloneUserDataRoot = '/home/alice/.config/@StratCraft/desktop';
    const sharedInput = {
      catalog: BUNDLED_MANAGED_TOOL_CATALOG,
      toolId: 'duckdb-cli',
      platform: 'linux' as const,
      architecture: 'x64' as const,
    };

    const electronPlan = planManagedToolInstall({
      ...sharedInput,
      userDataRoot: electronUserDataRoot,
    });
    const standalonePlan = planManagedToolInstall({
      ...sharedInput,
      userDataRoot: standaloneUserDataRoot,
    });

    expect(electronPlan).toEqual(standalonePlan);
    expect(
      resolveManagedToolStorePaths({
        userDataRoot: standaloneUserDataRoot,
        toolId: standalonePlan.toolId,
        version: standalonePlan.targetVersion,
        platform: standalonePlan.platform,
        architecture: standalonePlan.architecture,
        artifactSha256: standalonePlan.artifact.sha256,
      }),
    ).toEqual(standalonePlan.pathIdentity);
  });
});

