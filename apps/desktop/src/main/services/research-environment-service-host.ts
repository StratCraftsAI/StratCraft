/**
 * TICKET_1335 L5: the one process-wide `ResearchEnvironmentService` instance.
 *
 * Every surface in this process -- Electron IPC, the Service API (and through
 * it, MCP) -- resolves the service here. That is not tidiness: the service
 * holds in-memory state that only works if it is singular. `consumedApprovals`
 * enforces single-use of a human decision, and `lostClaims` records claims
 * reclaimed mid-operation. A second instance would have empty sets, so one
 * approval could authorize two installs and a lost claim would go unnoticed --
 * which is the concurrent-materialization hazard against one `.pixi` directory
 * that TICKET_1335 D4 exists to prevent.
 *
 * The repository root is resolved by searching upward for the governed
 * `pixi.toml`/`pixi.lock` pair rather than by `app.getAppPath()` arithmetic,
 * because this module is loaded by both the Electron host and the headless
 * `serve` host, and neither may assume the other's directory layout. It imports
 * no `electron` for the same reason.
 */

import { randomUUID } from 'node:crypto';

import {
  parseResearchEnvironmentFailure,
  parsePersistedResearchEnvironmentStatus,
  parseResearchEnvironmentStatus,
} from '@StratCraft/types';
import {
  ResearchEnvironmentJobRepository,
  ResearchEnvironmentService,
  createNodeEnvironmentHost,
  createNodeProcessRunner,
  resolveRepositoryRoot,
  type ResearchEnvironmentDb,
  type ResearchEnvironmentStatement,
} from '@StratCraft/research-environment';

import { getDatabaseManager } from '../database/db-manager';
import { appLog } from '../utils/logger';
import { getWorkloadMonitor } from './workload-monitor';

let service: ResearchEnvironmentService | null = null;

/**
 * Bind the process's sqlite handle to the structural interface L3 declares.
 *
 * L3 deliberately does not import `better-sqlite3` (Electron main and the
 * standalone MCP process load different builds of that native module), so the
 * concrete binding happens here. `transaction(fn).immediate` is required rather
 * than incidental: a deferred transaction takes its write lock only at the
 * first write, which would let two admissions both finish their reads before
 * either claimed the profile -- the race the claim exists to close.
 */
function researchEnvironmentDb(): ResearchEnvironmentDb {
  const db = getDatabaseManager().getDb();
  return {
    prepare: (sql: string) => db.prepare(sql) as unknown as ResearchEnvironmentStatement,
    transactionImmediate: <T>(fn: () => T) => db.transaction(fn).immediate,
  };
}

/**
 * Resolve the shared service, constructing it on first use.
 *
 * Returns `null` when no governed repository root can be located -- a packaged
 * install with no source tree is a legitimate state, and the caller reports it
 * as a structured contract failure. Throwing here would turn a reportable
 * environment condition into a surface crash (TICKET_858 wants the failure to
 * *reach* the user, not to abort the host).
 */
export function getResearchEnvironmentService(): ResearchEnvironmentService | null {
  if (service) return service;

  const host = createNodeEnvironmentHost();
  const repositoryRoot = resolveRepositoryRoot(__dirname, host);
  if (!repositoryRoot) {
    appLog.warn(
      '[TICKET_1335] No pixi.toml/pixi.lock pair found above the running host; '
      + 'research-environment operations are unavailable in this installation.',
    );
    return null;
  }

  service = new ResearchEnvironmentService({
    repositoryRoot,
    host,
    runner: createNodeProcessRunner(),
    jobs: new ResearchEnvironmentJobRepository({
      db: researchEnvironmentDb(),
      // Random per-run identity, never the PID: TICKET_1335 D4 requires that a
      // recycled PID cannot be mistaken for the previous owner of a claim.
      instanceId: randomUUID(),
      pid: process.pid,
      parseStatus: parseResearchEnvironmentStatus,
      parsePersistedStatus: parsePersistedResearchEnvironmentStatus,
      parseFailure: parseResearchEnvironmentFailure,
    }),
    workloadActivity: () => {
      const rows = getWorkloadMonitor().collect();
      const errors = rows.filter(row => row.error);
      if (errors.length > 0) {
        return { state: 'unknown', detail: errors.map(row => `${row.id}: ${row.error}`).join('; ') };
      }
      const active = rows.filter(row => row.running);
      return active.length > 0
        ? { state: 'active', detail: active.map(row => row.id).join(', ') }
        : { state: 'idle' };
    },
    onWorkloadUpdate: update => getWorkloadMonitor().updateResearchEnvironment(update),
    log: (message, detail) => appLog.info(`[TICKET_1335] ${message}`, detail ?? {}),
  });
  appLog.info('[TICKET_1335] Research environment service ready', { repositoryRoot });
  return service;
}

/** Test-only reset, matching the `__reset*ForTest` convention in this directory. */
export function __resetResearchEnvironmentServiceForTest(): void {
  service = null;
}
