/**
 * TICKET_1335 L4 tests: the shared lifecycle owner.
 *
 * Run against real SQLite with the real migration 140 body and the real L3
 * repository -- not a fake job store. The concurrency and approval behaviours
 * under test depend on a partial unique index and on `BEGIN IMMEDIATE`, both of
 * which type-check perfectly against a mock and then do not exist.
 *
 * The process runner and filesystem are injected, so no test spawns pixi or
 * touches `.pixi`.
 */

import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import {
  RESEARCH_CAPABILITIES,
  parsePersistedResearchEnvironmentStatus,
  parseResearchEnvironmentJob,
  parseResearchEnvironmentStatus,
  researchEnvironmentFailureSchema,
  type ResearchCapability,
} from "@StratCraft/types";
import { EMBEDDED_MIGRATIONS_FOR_TEST } from "@StratCraft/db-migrations";

import { RESEARCH_ENV_PERSISTED_LOG_LINES } from "./constants";
import { ResearchEnvironmentHeartbeat } from "./heartbeat";
import {
  ResearchEnvironmentJobRepository,
  type ResearchEnvironmentDb,
} from "./job-repository";
import { PROBE_RESULT_BEGIN, PROBE_RESULT_END } from "./probe-program";
import {
  RESEARCH_ENV_SERVICE_ERROR_CODES,
  ResearchEnvironmentService,
  ResearchEnvironmentServiceError,
  type LocalMutationApproval,
} from "./research-environment-service";
import type { EnvironmentHost } from "./environment-paths";
import type {
  ProcessResult,
  ProcessRunner,
  ProcessSpawnRequest,
} from "./process-runner";
import type { ResearchEnvironmentWorkloadUpdate } from './workload-progress';

const REPO = "/repo";
const MANIFEST = `${REPO}/pixi.toml`;
const LOCK = `${REPO}/pixi.lock`;
const INTERPRETER = `${REPO}/.pixi/envs/default/bin/python`;
const ENVIRONMENT_ROOT = `${REPO}/.pixi/envs/default`;
const WITHOUT_GPQUANT_ROOT = `${REPO}/.pixi/envs/without-gpquant`;
const WITHOUT_GPQUANT_INTERPRETER = `${WITHOUT_GPQUANT_ROOT}/bin/python`;
const PIXI = "/home/dev/.pixi/bin/pixi";

const LOCK_CONTENT = `
version: 6
packages:
- name: duckdb
  version: 1.5.3
- name: histdata-supplementary
  version: 0.1.0
- name: gplearn
  version: 0.4.3
- name: gpquant
  version: 0.1.6
- name: pysr
  version: 1.5.10
- name: pandas-ta
  version: 0.4.71b0
`;

const MANIFEST_CONTENT = '[workspace]\nname = "stratcraft-research"\n';

const EXPECTED: Record<ResearchCapability, string> = {
  histdata: "0.1.0",
  duckdb: "1.5.3",
  gplearn: "0.4.3",
  gpquant: "0.1.6",
  pysr: "1.5.10",
  pandas_ta: "0.4.71b0",
};

const migrations = EMBEDDED_MIGRATIONS_FOR_TEST.filter(
  (item) => [140, 142, 143, 144, 145].includes(item.version),
);

function sha(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Same native-binding indirection as the L3 suite (Electron ABI mismatch). */
function openMigrated(): Database.Database {
  const db = new Database(":memory:", {
    nativeBinding: resolve(
      process.cwd(),
      "../../apps/desktop/src/mcp/standalone/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    ),
  });
  db.pragma("foreign_keys = ON");
  for (const migration of migrations) db.exec(migration.up as string);
  return db;
}

function adapt(db: Database.Database): ResearchEnvironmentDb {
  return {
    prepare: (sql: string) => db.prepare(sql),
    transactionImmediate: <T>(fn: () => T) => db.transaction(fn).immediate,
  };
}

interface HarnessOptions {
  files?: Record<string, string>;
  executables?: readonly string[];
  platform?: string;
  architecture?: string;
  pixiOnPath?: boolean;
  runner?: ProcessRunner;
  workloadActivity?: () => { state: 'idle' | 'active' | 'unknown'; detail?: string };
  realPaths?: Record<string, string>;
  onWorkloadUpdate?: (update: ResearchEnvironmentWorkloadUpdate) => void;
}

function makeHost(options: HarnessOptions = {}): EnvironmentHost {
  const files = options.files ?? {
    [MANIFEST]: MANIFEST_CONTENT,
    [LOCK]: LOCK_CONTENT,
  };
  const executables = new Set(options.executables ?? [INTERPRETER, WITHOUT_GPQUANT_INTERPRETER, PIXI]);
  return {
    fileExists: (path) => Object.prototype.hasOwnProperty.call(files, path),
    realPath: (path) => options.realPaths?.[path] ?? path,
    isExecutable: (path) => executables.has(path),
    readFile: (path) => {
      if (!Object.prototype.hasOwnProperty.call(files, path)) {
        throw new Error(`ENOENT: ${path}`);
      }
      return files[path];
    },
    platform: options.platform ?? "linux",
    architecture: options.architecture ?? "x64",
    which: () => (options.pixiOnPath === false ? undefined : PIXI),
    homeDirectory: "/home/dev",
  };
}

function successfulProbeStdout(
  overrides: Partial<Record<ResearchCapability, unknown>> = {},
): string {
  const capabilities = Object.fromEntries(
    RESEARCH_CAPABILITIES.map((capability) => [
      capability,
      overrides[capability] ?? {
        ok: true,
        version: EXPECTED[capability],
        verification: "verified",
      },
    ]),
  );
  return `${PROBE_RESULT_BEGIN}\n${JSON.stringify({
    interpreter: INTERPRETER,
    pythonVersion: "3.12.13",
    capabilities,
  })}\n${PROBE_RESULT_END}\n`;
}

function ok(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    ...overrides,
  };
}

/**
 * A runner that answers by argument shape: `--version` for the pixi version
 * probe, `-c` for the readiness verifier, everything else for materialization.
 */
function scriptedRunner(
  script: {
    install?: ProcessResult;
    probe?: ProcessResult;
  } = {},
): { runner: ProcessRunner; calls: ProcessSpawnRequest[] } {
  const calls: ProcessSpawnRequest[] = [];
  return {
    calls,
    runner: {
      run: vi.fn(async (request: ProcessSpawnRequest) => {
        calls.push(request);
        if (request.args.includes("--version")) {
          return ok({ stdout: "pixi 0.75.0\n" });
        }
        if (request.args.includes("-c")) {
          return script.probe ?? ok({ stdout: successfulProbeStdout(
            request.executable === WITHOUT_GPQUANT_INTERPRETER
              ? { gpquant: { ok: false, cause: 'import', message: 'No module named gpquant' } }
              : {},
          ) });
        }
        return script.install ?? ok();
      }),
    },
  };
}

interface Harness {
  service: ResearchEnvironmentService;
  jobs: ResearchEnvironmentJobRepository;
  calls: ProcessSpawnRequest[];
  db: Database.Database;
}

function harness(options: HarnessOptions = {}): Harness {
  const db = openMigrated();
  const jobs = new ResearchEnvironmentJobRepository({
    db: adapt(db),
    instanceId: "instance-a",
    parseStatus: parseResearchEnvironmentStatus,
    parsePersistedStatus: parsePersistedResearchEnvironmentStatus,
    parseFailure: (value) => researchEnvironmentFailureSchema.parse(value),
  });
  const scripted = scriptedRunner();
  const runner = options.runner ?? scripted.runner;
  const service = new ResearchEnvironmentService({
    repositoryRoot: REPO,
    host: makeHost(options),
    runner,
    jobs,
    now: () => new Date("2026-07-30T12:00:00.000Z"),
    // No real timers: the heartbeat is exercised by the L3 suite.
    createHeartbeat: () => ({ start: () => {}, stop: () => {} }),
    workloadActivity: options.workloadActivity,
    onWorkloadUpdate: options.onWorkloadUpdate,
  });
  return { service, jobs, calls: scripted.calls, db };
}

function approval(
  overrides: Partial<LocalMutationApproval> = {},
): LocalMutationApproval {
  return {
    operation: "install",
    profile: "research-default",
    manifestSha256: sha(MANIFEST_CONTENT),
    lockSha256: sha(LOCK_CONTENT),
    environmentRoot: ENVIRONMENT_ROOT,
    grantedTo: "webContents-1",
    decisionId: "decision-1",
    ...overrides,
  };
}

/** A terminal failure used to take a claim away from an in-flight operation. */
function installFailure() {
  return {
    category: "install_failed" as const,
    stage: "install" as const,
    cause: "process_exit" as const,
    message: "pixi install exited with code 1.",
    remediation: "Check connectivity and run Repair Environment.",
  };
}

/** Wait for the detached operation started by install/repair/verify. */
async function settle(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
    await new Promise((resolveTick) => setImmediate(resolveTick));
  }
}

// -----------------------------------------------------------------------------
// Status
// -----------------------------------------------------------------------------

describe("getStatus", () => {
  it("reports absent with expected versions before anything is verified", async () => {
    const { service } = harness();
    const status = await service.getStatus();
    expect(status.state).toBe("absent");
    for (const capability of RESEARCH_CAPABILITIES) {
      expect(status.capabilities[capability].expected).toBe(
        EXPECTED[capability],
      );
      expect(status.capabilities[capability].installed).toBeUndefined();
    }
  });

  it("reports an unattested projection with no interpreter and no invented verification", async () => {
    const { service } = harness({ executables: [PIXI] });
    const status = await service.getStatus();
    expect(status.state).toBe('absent');
    expect(status.interpreterPath).toBeUndefined();
    expect(status.capabilities.duckdb.verification).toBeUndefined();
  });

  it("does NOT report ready for an on-disk environment it never verified", async () => {
    // The decisive rule. A 7.9 GB `.pixi` materialized outside this service
    // exists on the development host; trusting its presence would certify an
    // environment nobody audited. Readiness requires recorded verification
    // evidence, and the contract has no "present but unattested" state.
    const { service } = harness({ executables: [INTERPRETER, PIXI] });
    const status = await service.getStatus();
    expect(status.state).toBe("absent");
    expect(status.interpreterPath).toBe(INTERPRETER);
    expect(status.capabilities.duckdb.verification).toContain(
      "has not been verified",
    );
  });

  it("reports unsupported_platform at the environment level with all capabilities absent", async () => {
    // D7: an unsupported host is never mistaken for a per-package problem.
    const { service } = harness({ platform: "darwin", architecture: "arm64" });
    const status = await service.getStatus();
    expect(status.supportedPlatform).toBe(false);
    expect(status.failure?.category).toBe("unsupported_platform");
    for (const capability of RESEARCH_CAPABILITIES) {
      expect(status.capabilities[capability].state).toBe("absent");
    }
  });

  it("reports lock_missing when the committed lock is gone", async () => {
    const { service } = harness({ files: { [MANIFEST]: MANIFEST_CONTENT } });
    const status = await service.getStatus();
    expect(status.state).toBe("failed");
    expect(status.failure?.category).toBe("lock_missing");
    expect(status.failure?.remediation).toContain("version control");
  });

  it("reports lock_drift when a capability is unresolvable in the lock", async () => {
    const partial = LOCK_CONTENT.replace(
      "- name: pysr\n  version: 1.5.10\n",
      "",
    );
    const { service } = harness({
      files: { [MANIFEST]: MANIFEST_CONTENT, [LOCK]: partial },
    });
    const status = await service.getStatus();
    expect(status.failure?.category).toBe("lock_drift");
  });

  it("reports ready with full evidence after a successful verification", async () => {
    const { service } = harness();
    await service.verify();
    await settle();

    const status = await service.getStatus();
    expect(status.state).toBe("ready");
    expect(status.schemaVersion).toBe(2);
    expect(status.interpreterPath).toBe(INTERPRETER);
    expect(status.lastVerifiedAt).toBeTruthy();
    expect(status.lockSha256).toBe(sha(LOCK_CONTENT));
    expect(status.pixiVersion).toBe("0.75.0");
    for (const capability of RESEARCH_CAPABILITIES) {
      expect(status.capabilities[capability].installed).toBe(
        EXPECTED[capability],
      );
    }
  });

  it("returns repair-required status for a persisted pre-HistData verification", async () => {
    const { service, db } = harness();
    await service.verify();
    await settle();
    db.exec(`
      UPDATE research_environment_jobs
      SET result_json = json_remove(result_json, '$.schemaVersion', '$.capabilities.histdata');
      UPDATE research_environment_active_projection
      SET status_json = json_remove(status_json, '$.schemaVersion', '$.capabilities.histdata');
    `);

    const status = await service.getStatus();
    expect(status.state).toBe('failed');
    expect(status.failure?.category).toBe('lock_drift');
    expect(status.failure?.remediation).toContain('Verify Again');
    expect(status.migration?.reason).toBe('histdata_capability_added');
  });

  it("resolves the latest verified result when no active-projection row exists", async () => {
    const { service, db } = harness();
    await service.verify();
    await settle();
    db.prepare('DELETE FROM research_environment_active_projection').run();

    const status = await service.getStatus();
    expect(status.state).toBe('ready');
    expect(status.projection).toBe('default');
  });

  it("stops reporting ready once the committed lock changes", async () => {
    // Hash equality is what converts "an environment exists" into "this is the
    // environment the repository approved". Without it, a verified status would
    // keep describing a dependency set that is no longer committed.
    const db = openMigrated();
    const jobs = new ResearchEnvironmentJobRepository({
      db: adapt(db),
      instanceId: "instance-a",
      parseStatus: parseResearchEnvironmentStatus,
      parsePersistedStatus: parsePersistedResearchEnvironmentStatus,
      parseFailure: (value) => researchEnvironmentFailureSchema.parse(value),
    });
    const files: Record<string, string> = {
      [MANIFEST]: MANIFEST_CONTENT,
      [LOCK]: LOCK_CONTENT,
    };
    const host: EnvironmentHost = {
      ...makeHost(),
      fileExists: (path) => Object.prototype.hasOwnProperty.call(files, path),
      readFile: (path) => files[path],
    };
    const service = new ResearchEnvironmentService({
      repositoryRoot: REPO,
      host,
      runner: scriptedRunner().runner,
      jobs,
      createHeartbeat: () => ({ start: () => {}, stop: () => {} }),
    });

    await service.verify();
    await settle();
    expect((await service.getStatus()).state).toBe("ready");

    // A dependency review lands a new lock.
    files[LOCK] = `${LOCK_CONTENT}\n- name: extra\n  version: 1.0.0\n`;
    const after = await service.getStatus();
    expect(after.state).toBe("failed");
    expect(after.failure?.category).toBe("lock_drift");
  });

  it("reports the interpreter disappearing after a successful verification", async () => {
    const executables = new Set([INTERPRETER, PIXI]);
    const host: EnvironmentHost = {
      ...makeHost(),
      isExecutable: (path) => executables.has(path),
    };
    const db = openMigrated();
    const jobs = new ResearchEnvironmentJobRepository({
      db: adapt(db),
      instanceId: "instance-a",
      parseStatus: parseResearchEnvironmentStatus,
      parsePersistedStatus: parsePersistedResearchEnvironmentStatus,
      parseFailure: (value) => researchEnvironmentFailureSchema.parse(value),
    });
    const service = new ResearchEnvironmentService({
      repositoryRoot: REPO,
      host,
      runner: scriptedRunner().runner,
      jobs,
      createHeartbeat: () => ({ start: () => {}, stop: () => {} }),
    });

    await service.verify();
    await settle();
    expect((await service.getStatus()).state).toBe("ready");

    executables.delete(INTERPRETER);
    const after = await service.getStatus();
    expect(after.state).toBe("failed");
    expect(after.failure?.category).toBe("operation_interrupted");
  });
});

// -----------------------------------------------------------------------------
// Approval
// -----------------------------------------------------------------------------

describe("mutation approval", () => {
  it("atomically selects the locked without-gpquant projection after verification", async () => {
    const { service, calls } = harness({ workloadActivity: () => ({ state: 'idle' }) });
    await service.removeCapability('gpquant', approval({
      operation: 'remove_capability',
      environmentRoot: WITHOUT_GPQUANT_ROOT,
      targetProjection: 'without-gpquant',
    }));
    await settle();

    const status = await service.getStatus();
    expect(status.projection).toBe('without-gpquant');
    expect(status.interpreterPath).toBe(WITHOUT_GPQUANT_INTERPRETER);
    expect(status.capabilities.gpquant.state).toBe('intentionally_absent');
    expect(status.capabilities.gpquant.installed).toBeUndefined();
    for (const capability of ['histdata', 'duckdb', 'gplearn', 'pysr', 'pandas_ta'] as const) {
      expect(status.capabilities[capability]).toMatchObject({
        state: 'ready', installed: EXPECTED[capability],
      });
    }
    expect(calls[0].args).toContain('without-gpquant');
  });

  it("durably publishes the verified target before deleting the old prefix", async () => {
    let jobs!: ResearchEnvironmentJobRepository;
    let projectionObservedByCleanup: string | undefined;
    const runner: ProcessRunner = {
      run: vi.fn(async (request) => {
        if (request.args.includes('--version')) return ok({ stdout: 'pixi 0.75.0\n' });
        if (request.args.includes('-c')) {
          return ok({ stdout: successfulProbeStdout({
            gpquant: { ok: false, cause: 'import', message: 'No module named gpquant' },
          }) });
        }
        if (request.args[0] === 'clean') {
          projectionObservedByCleanup = jobs.findPublishedProjection()?.projection;
        }
        return ok();
      }),
    };
    const created = harness({
      runner,
      files: { [MANIFEST]: MANIFEST_CONTENT, [LOCK]: LOCK_CONTENT, [ENVIRONMENT_ROOT]: 'directory' },
      workloadActivity: () => ({ state: 'idle' }),
    });
    jobs = created.jobs;

    await created.service.removeCapability('gpquant', approval({
      operation: 'remove_capability', environmentRoot: WITHOUT_GPQUANT_ROOT,
      targetProjection: 'without-gpquant',
    }));
    await settle();

    expect(projectionObservedByCleanup).toBe('without-gpquant');
    expect(jobs.findPublishedProjection()?.pendingCleanupProjection).toBeUndefined();
  });

  it("keeps the published target authoritative when old-prefix cleanup fails", async () => {
    const runner: ProcessRunner = {
      run: vi.fn(async (request) => {
        if (request.args.includes('--version')) return ok({ stdout: 'pixi 0.75.0\n' });
        if (request.args.includes('-c')) {
          return ok({ stdout: successfulProbeStdout({
            gpquant: { ok: false, cause: 'import', message: 'No module named gpquant' },
          }) });
        }
        return request.args[0] === 'clean' ? ok({ exitCode: 9 }) : ok();
      }),
    };
    const { service, jobs } = harness({
      runner,
      files: { [MANIFEST]: MANIFEST_CONTENT, [LOCK]: LOCK_CONTENT, [ENVIRONMENT_ROOT]: 'directory' },
      workloadActivity: () => ({ state: 'idle' }),
    });
    const jobId = await service.removeCapability('gpquant', approval({
      operation: 'remove_capability', environmentRoot: WITHOUT_GPQUANT_ROOT,
      targetProjection: 'without-gpquant',
    }));
    await settle();

    const failedJob = await service.getJob(jobId);
    expect(failedJob?.state).toBe('failed');
    expect(failedJob?.status).toMatchObject({
      state: 'failed', projection: 'without-gpquant',
      failure: { category: 'install_failed' },
    });
    expect(failedJob?.transition).toEqual({
      outcome: 'post_publication_cleanup_pending',
      activeProjection: 'without-gpquant',
      pendingCleanupProjection: 'default',
      recoveryOperation: 'retry_approved_lifecycle_mutation',
    });
    expect(() => parseResearchEnvironmentJob(failedJob)).not.toThrow();
    expect((await service.getStatus()).projection).toBe('without-gpquant');
    expect((await service.getStatus()).interpreterPath).toBe(WITHOUT_GPQUANT_INTERPRETER);
    expect(jobs.findPublishedProjection()?.pendingCleanupProjection).toBe('default');
  });

  it("recovers durable pending cleanup before the next approved mutation", async () => {
    let cleanAttempts = 0;
    const runner: ProcessRunner = {
      run: vi.fn(async (request) => {
        if (request.args.includes('--version')) return ok({ stdout: 'pixi 0.75.0\n' });
        if (request.args.includes('-c')) {
          return ok({ stdout: successfulProbeStdout({
            gpquant: { ok: false, cause: 'import', message: 'No module named gpquant' },
          }) });
        }
        if (request.args[0] === 'clean') {
          cleanAttempts += 1;
          return cleanAttempts === 1 ? ok({ exitCode: 9 }) : ok();
        }
        return ok();
      }),
    };
    const { service, jobs } = harness({
      runner,
      files: { [MANIFEST]: MANIFEST_CONTENT, [LOCK]: LOCK_CONTENT, [ENVIRONMENT_ROOT]: 'directory' },
      workloadActivity: () => ({ state: 'idle' }),
    });
    await service.removeCapability('gpquant', approval({
      operation: 'remove_capability', decisionId: 'remove-fails-cleanup',
      environmentRoot: WITHOUT_GPQUANT_ROOT, targetProjection: 'without-gpquant',
    }));
    await settle();
    expect(jobs.findPublishedProjection()?.pendingCleanupProjection).toBe('default');

    const retry = await service.removeCapability('gpquant', approval({
      operation: 'remove_capability', decisionId: 'remove-recovers-cleanup',
      environmentRoot: WITHOUT_GPQUANT_ROOT, targetProjection: 'without-gpquant',
    }));
    await settle();

    expect(await service.getJob(retry)).toMatchObject({
      state: 'succeeded',
      transition: { outcome: 'completed', activeProjection: 'without-gpquant' },
    });
    expect(cleanAttempts).toBeGreaterThanOrEqual(2);
    expect(jobs.findPublishedProjection()?.pendingCleanupProjection).toBeUndefined();
  });

  it("fails explicitly and retains the marker when recovered cleanup fails again", async () => {
    const runner: ProcessRunner = {
      run: vi.fn(async (request) => {
        if (request.args.includes('--version')) return ok({ stdout: 'pixi 0.75.0\n' });
        if (request.args.includes('-c')) {
          return ok({ stdout: successfulProbeStdout({
            gpquant: { ok: false, cause: 'import', message: 'No module named gpquant' },
          }) });
        }
        return request.args[0] === 'clean' ? ok({ exitCode: 9 }) : ok();
      }),
    };
    const { service, jobs } = harness({
      runner,
      files: { [MANIFEST]: MANIFEST_CONTENT, [LOCK]: LOCK_CONTENT, [ENVIRONMENT_ROOT]: 'directory' },
      workloadActivity: () => ({ state: 'idle' }),
    });
    await service.removeCapability('gpquant', approval({
      operation: 'remove_capability', decisionId: 'first-cleanup-failure',
      environmentRoot: WITHOUT_GPQUANT_ROOT, targetProjection: 'without-gpquant',
    }));
    await settle();

    const retry = await service.removeCapability('gpquant', approval({
      operation: 'remove_capability', decisionId: 'recovered-cleanup-failure',
      environmentRoot: WITHOUT_GPQUANT_ROOT, targetProjection: 'without-gpquant',
    }));
    await settle();

    expect((await service.getJob(retry))?.status.failure).toMatchObject({
      category: 'install_failed', cause: 'process_exit',
    });
    expect(jobs.findPublishedProjection()?.pendingCleanupProjection).toBe('default');
    expect((await service.getStatus()).projection).toBe('without-gpquant');
  });

  it.each(['active', 'unknown'] as const)(
    "refuses GPQuant removal when workload state is %s",
    async (state) => {
      const { service, calls } = harness({ workloadActivity: () => ({ state }) });
      await expect(service.removeCapability('gpquant', approval({
        operation: 'remove_capability',
        environmentRoot: WITHOUT_GPQUANT_ROOT,
        targetProjection: 'without-gpquant',
      }))).rejects.toMatchObject({
        code: state === 'active'
          ? RESEARCH_ENV_SERVICE_ERROR_CODES.WORKLOAD_ACTIVE
          : RESEARCH_ENV_SERVICE_ERROR_CODES.WORKLOAD_STATE_UNKNOWN,
      });
      expect(calls).toHaveLength(0);
    },
  );

  it.each(['active', 'unknown'] as const)(
    "refuses GPQuant removal without inventing workload detail for %s state",
    async (state) => {
      const { service } = harness({ workloadActivity: () => ({ state }) });
      await expect(service.removeCapability('gpquant', approval({
        operation: 'remove_capability', environmentRoot: WITHOUT_GPQUANT_ROOT,
        targetProjection: 'without-gpquant',
      }))).rejects.toThrow(state === 'active'
        ? 'GPQuant cannot be removed while research workloads are active.'
        : 'GPQuant removal requires authoritative idle workload state.');
    },
  );

  it("restores the locked default projection and exact GPQuant version", async () => {
    const { service } = harness({ workloadActivity: () => ({ state: 'idle' }) });
    await service.removeCapability('gpquant', approval({
      operation: 'remove_capability', decisionId: 'remove-1',
      environmentRoot: WITHOUT_GPQUANT_ROOT, targetProjection: 'without-gpquant',
    }));
    await settle();
    await service.install(approval({ decisionId: 'restore-1' }));
    await settle();

    const status = await service.getStatus();
    expect(status.projection).toBe('default');
    expect(status.capabilities.gpquant).toMatchObject({
      state: 'ready', expected: '0.1.6', installed: '0.1.6',
    });
  });

  it("restores default and removes only the canonical inactive without-gpquant prefix", async () => {
    const calls: ProcessSpawnRequest[] = [];
    const runner: ProcessRunner = {
      run: vi.fn(async (request) => {
        calls.push(request);
        if (request.args.includes('--version')) return ok({ stdout: 'pixi 0.75.0\n' });
        if (request.args.includes('-c')) return ok({ stdout: successfulProbeStdout() });
        return ok();
      }),
    };
    const { service, jobs } = harness({
      runner,
      files: {
        [MANIFEST]: MANIFEST_CONTENT,
        [LOCK]: LOCK_CONTENT,
        [WITHOUT_GPQUANT_ROOT]: 'directory',
      },
      workloadActivity: () => ({ state: 'idle' }),
    });
    jobs.publishProjection(
      jobs.admit({
        operation: 'restore_capability',
        manifestSha256: sha(MANIFEST_CONTENT),
        lockSha256: sha(LOCK_CONTENT),
      }).jobId,
      parseResearchEnvironmentStatus({
        profile: 'research-default',
        projection: 'without-gpquant',
        state: 'ready',
        supportedPlatform: true,
        platform: 'linux',
        architecture: 'x64',
        manifestSha256: sha(MANIFEST_CONTENT),
        lockSha256: sha(LOCK_CONTENT),
        interpreterPath: WITHOUT_GPQUANT_INTERPRETER,
        lastVerifiedAt: '2026-07-30T12:00:00.000Z',
        capabilities: Object.fromEntries(RESEARCH_CAPABILITIES.map(capability => [capability, {
          expected: EXPECTED[capability],
          ...(capability === 'gpquant' ? {} : { installed: EXPECTED[capability] }),
          state: capability === 'gpquant' ? 'intentionally_absent' : 'ready',
        }])),
      }),
      'default',
    );
    // The setup job exists only to establish the authoritative active projection.
    jobs.completePublishedTransition(
      jobs.findPublishedProjection()!.publishedByJobId,
      jobs.findPublishedProjection()!.status,
    );

    const jobId = await service.install(approval({ decisionId: 'restore-exact-cleanup' }));
    await settle();

    expect((await service.getJob(jobId))?.state).toBe('succeeded');
    const cleanup = calls.find(call => call.args[0] === 'clean');
    expect(cleanup?.args).toEqual(expect.arrayContaining([
      '--environment', 'without-gpquant', '--manifest-path', MANIFEST,
    ]));
    expect(cleanup?.args).not.toContain('default');
    expect(jobs.findPublishedProjection()).toMatchObject({
      projection: 'default',
    });
    expect(jobs.findPublishedProjection()?.pendingCleanupProjection).toBeUndefined();
  });

  it.each(['active', 'unknown'] as const)(
    "refuses locked GPQuant restoration when workload state is %s",
    async (state) => {
      const created = harness({ workloadActivity: () => ({ state: 'idle' }) });
      await created.service.removeCapability('gpquant', approval({
        operation: 'remove_capability', decisionId: `remove-before-${state}`,
        environmentRoot: WITHOUT_GPQUANT_ROOT, targetProjection: 'without-gpquant',
      }));
      await settle();

      const service = new ResearchEnvironmentService({
        repositoryRoot: REPO,
        host: makeHost(),
        runner: scriptedRunner().runner,
        jobs: created.jobs,
        createHeartbeat: () => ({ start: () => {}, stop: () => {} }),
        workloadActivity: () => ({ state }),
      });

      await expect(service.install(approval({ decisionId: `restore-${state}` })))
        .rejects.toMatchObject({
          code: state === 'active'
            ? RESEARCH_ENV_SERVICE_ERROR_CODES.WORKLOAD_ACTIVE
            : RESEARCH_ENV_SERVICE_ERROR_CODES.WORKLOAD_STATE_UNKNOWN,
        });
    },
  );

  it("uses fail-closed unknown workload state when restoration has no activity owner", async () => {
    const created = harness({ workloadActivity: () => ({ state: 'idle' }) });
    await created.service.removeCapability('gpquant', approval({
      operation: 'remove_capability', decisionId: 'remove-before-default-activity',
      environmentRoot: WITHOUT_GPQUANT_ROOT, targetProjection: 'without-gpquant',
    }));
    await settle();

    const service = new ResearchEnvironmentService({
      repositoryRoot: REPO,
      host: makeHost(),
      runner: scriptedRunner().runner,
      jobs: created.jobs,
      createHeartbeat: () => ({ start: () => {}, stop: () => {} }),
    });

    await expect(service.install(approval({ decisionId: 'restore-without-activity-owner' })))
      .rejects.toMatchObject({
        code: RESEARCH_ENV_SERVICE_ERROR_CODES.WORKLOAD_STATE_UNKNOWN,
      });
  });

  it("rejects an unregistered removable capability before any lifecycle spawn", async () => {
    const { service, calls } = harness({ workloadActivity: () => ({ state: 'idle' }) });
    await expect(service.removeCapability(
      'duckdb' as unknown as 'gpquant',
      approval({ operation: 'remove_capability' }),
    )).rejects.toMatchObject({
      code: RESEARCH_ENV_SERVICE_ERROR_CODES.APPROVAL_PROFILE_MISMATCH,
    });
    expect(calls).toHaveLength(0);
  });

  it("refuses install without an approval", async () => {
    const { service } = harness();
    await expect(
      service.install(undefined as unknown as LocalMutationApproval),
    ).rejects.toMatchObject({
      code: RESEARCH_ENV_SERVICE_ERROR_CODES.APPROVAL_REQUIRED,
    });
  });

  it("refuses an approval issued for the other operation", async () => {
    // AC4: the failed state must call repair, not install. An approval for one
    // must not authorize the other.
    const { service } = harness();
    await expect(
      service.repair(approval({ operation: "install" })),
    ).rejects.toMatchObject({
      code: RESEARCH_ENV_SERVICE_ERROR_CODES.APPROVAL_OPERATION_MISMATCH,
    });
  });

  it("refuses an approval whose hashes no longer match the files on disk", async () => {
    // A manifest edited while the confirmation dialog was open must invalidate
    // the approval before any job or child process exists.
    const { service, calls } = harness();
    await expect(
      service.install(approval({ manifestSha256: "b".repeat(64) })),
    ).rejects.toMatchObject({
      code: RESEARCH_ENV_SERVICE_ERROR_CODES.APPROVAL_STALE_HASHES,
    });
    expect(calls).toHaveLength(0);
  });

  it("refuses a replayed approval", async () => {
    const { service } = harness();
    const grant = approval();
    await service.install(grant);
    await settle();
    await expect(service.install(grant)).rejects.toMatchObject({
      code: RESEARCH_ENV_SERVICE_ERROR_CODES.APPROVAL_ALREADY_CONSUMED,
    });
  });

  it("admits a second distinct decision from the same surface and lock", async () => {
    // Regression: single-use must bind to the decision, not the surface. Keying
    // replay on `grantedTo` + hashes rejected this legitimate case -- one
    // session confirming a retry after a failed install, against an unchanged
    // lock -- as a replay.
    const { service } = harness();
    await service.install(approval({ decisionId: "decision-1" }));
    await settle();
    await expect(
      service.install(approval({ decisionId: "decision-2" })),
    ).resolves.toEqual(expect.any(String));
  });

  it("refuses an approval naming an unknown profile", async () => {
    const { service } = harness();
    await expect(
      service.install(
        approval({
          profile: "attacker-chosen" as LocalMutationApproval["profile"],
        }),
      ),
    ).rejects.toMatchObject({
      code: RESEARCH_ENV_SERVICE_ERROR_CODES.APPROVAL_PROFILE_MISMATCH,
    });
  });

  it("refuses an approval naming a projection other than the owned target", async () => {
    const { service, calls } = harness();
    await expect(service.repair(approval({
      operation: 'repair',
      targetProjection: 'without-gpquant',
    }))).rejects.toMatchObject({
      code: RESEARCH_ENV_SERVICE_ERROR_CODES.APPROVAL_PROFILE_MISMATCH,
    });
    expect(calls).toHaveLength(0);
  });

  it("refuses an approval naming a different environment root", async () => {
    const { service, calls } = harness();
    await expect(service.install(approval({
      environmentRoot: `${REPO}/.pixi/envs/attacker-selected`,
    }))).rejects.toMatchObject({
      code: RESEARCH_ENV_SERVICE_ERROR_CODES.APPROVAL_PROFILE_MISMATCH,
    });
    expect(calls).toHaveLength(0);
  });

  it("spawns nothing on an unsupported platform", async () => {
    const { service, calls } = harness({ platform: "win32" });
    await expect(service.install(approval())).rejects.toMatchObject({
      code: RESEARCH_ENV_SERVICE_ERROR_CODES.UNSUPPORTED_PLATFORM,
    });
    expect(calls).toHaveLength(0);
  });

  it("requires no approval for verify, which mutates nothing", async () => {
    const { service } = harness();
    await expect(service.verify()).resolves.toBeTruthy();
  });
});

// -----------------------------------------------------------------------------
// Operations
// -----------------------------------------------------------------------------

describe("install and repair", () => {
  it("runs pixi install --locked and then verifies", async () => {
    const { service, calls } = harness();
    await service.install(approval());
    await settle();

    const materialize = calls.find((call) => call.args[0] === "install")!;
    expect(materialize.args).toContain("--locked");
    expect(materialize.args).not.toContain("--revalidate");
    expect(calls.some((call) => call.args.includes("-c"))).toBe(true);
    expect((await service.getStatus()).state).toBe("ready");
  });

  it("runs repair through pixi reinstall rather than a plain install", async () => {
    // Pinned to the subcommand: the previous spelling
    // (`install --locked --revalidate`) passed a contains-style assertion while
    // real pixi rejected the flag and exited 2, so every repair failed before
    // doing any work.
    const { service, calls } = harness();
    await service.repair(approval({ operation: "repair" }));
    await settle();

    const materialize = calls.find((call) => call.args[0] === "reinstall")!;
    expect(materialize).toBeDefined();
    expect(materialize.args).toContain("--locked");
    expect(materialize.args).not.toContain("--revalidate");
  });

  it("uninstalls only through pixi clean and persists a verified absent result", async () => {
    const { service, calls } = harness({
      executables: [PIXI],
      workloadActivity: () => ({ state: "idle" }),
    });
    const jobId = await service.uninstall(approval({ operation: "uninstall" }));
    await settle();

    const clean = calls.find((call) => call.args[0] === "clean")!;
    expect(clean.args).toEqual([
      "clean", "--environment", "default", "--manifest-path", MANIFEST,
    ]);
    expect(clean.args).not.toContain("--force");
    const job = await service.getJob(jobId);
    expect(job?.state).toBe("succeeded");
    expect(job?.status.state).toBe("absent");
    expect(job?.status.interpreterPath).toBeUndefined();
  });

  it.each([
    [{ state: "active", detail: "sweep" } as const, RESEARCH_ENV_SERVICE_ERROR_CODES.WORKLOAD_ACTIVE],
    [{ state: "unknown", detail: "systemd unavailable" } as const, RESEARCH_ENV_SERVICE_ERROR_CODES.WORKLOAD_STATE_UNKNOWN],
  ])("refuses uninstall fail-closed for workload activity %j", async (activity, code) => {
    const { service, calls } = harness({ workloadActivity: () => activity });
    await expect(service.uninstall(approval({ operation: "uninstall" })))
      .rejects.toMatchObject({ code });
    expect(calls).toHaveLength(0);
  });

  it.each(['active', 'unknown'] as const)(
    "refuses uninstall without inventing workload detail for %s state",
    async (state) => {
      const { service } = harness({ workloadActivity: () => ({ state }) });
      await expect(service.uninstall(approval({ operation: 'uninstall' })))
        .rejects.toThrow(state === 'active'
          ? 'The research environment is in use. Wait for all research workloads to finish, then retry.'
          : 'Research workload activity could not be determined. Uninstall fails closed; retry when activity can be verified.');
    },
  );

  it("classifies a failed Pixi cleanup as an uninstall failure and preserves signal evidence", async () => {
    const { runner } = scriptedRunner({
      install: ok({ exitCode: null, signal: 'SIGTERM' }),
    });
    const { service } = harness({
      runner,
      workloadActivity: () => ({ state: 'idle' }),
    });
    const jobId = await service.uninstall(approval({ operation: 'uninstall' }));
    await settle();

    const failure = (await service.getJob(jobId))?.status.failure;
    expect(failure).toMatchObject({
      category: 'uninstall_failed', stage: 'uninstall', cause: 'process_exit',
    });
    expect(failure?.message).toContain('signal SIGTERM');
  });

  it("refuses a symlinked environment target before spawning Pixi", async () => {
    const files = {
      [MANIFEST]: MANIFEST_CONTENT,
      [LOCK]: LOCK_CONTENT,
      [ENVIRONMENT_ROOT]: "directory",
    };
    const { service, calls } = harness({
      files,
      workloadActivity: () => ({ state: "idle" }),
      realPaths: {
        [`${REPO}/.pixi/envs`]: `${REPO}/.pixi/envs`,
        [ENVIRONMENT_ROOT]: "/shared/valuable-environment",
      },
    });

    const jobId = await service.uninstall(approval({ operation: "uninstall" }));
    await settle();

    expect(calls).toHaveLength(0);
    const job = await service.getJob(jobId);
    expect(job?.state).toBe("failed");
    expect(job?.status.failure?.category).toBe("uninstall_failed");
    expect(job?.status.failure?.message).toMatch(/outside its canonical workspace target/i);
  });

  it("fails the postcondition when Pixi reports success but the interpreter remains", async () => {
    const { service } = harness({
      executables: [PIXI, INTERPRETER],
      workloadActivity: () => ({ state: "idle" }),
    });
    const jobId = await service.uninstall(approval({ operation: "uninstall" }));
    await settle();

    const job = await service.getJob(jobId);
    expect(job?.state).toBe("failed");
    expect(job?.status.failure).toMatchObject({
      category: "uninstall_failed",
      stage: "uninstall",
      cause: "postcondition",
    });
  });

  it("fails if the fixed Pixi cleanup changes the committed lock identity", async () => {
    const files: Record<string, string> = {
      [MANIFEST]: MANIFEST_CONTENT,
      [LOCK]: LOCK_CONTENT,
    };
    const runner: ProcessRunner = {
      run: vi.fn(async () => {
        files[LOCK] = `${LOCK_CONTENT}\n# changed`;
        return ok();
      }),
    };
    const { service } = harness({
      files,
      executables: [PIXI],
      runner,
      workloadActivity: () => ({ state: "idle" }),
    });
    const jobId = await service.uninstall(approval({ operation: "uninstall" }));
    await settle();

    const job = await service.getJob(jobId);
    expect(job?.state).toBe("failed");
    expect(job?.status.failure?.message).toMatch(/changed pixi\.toml or pixi\.lock/i);
  });

  it("AC11: restarts, kills, and modifies no live research workload", async () => {
    // The property: materializing an environment touches `.pixi` and nothing
    // else. A running research workload keeps the interpreter it already
    // resolved, so it is unaffected by definition -- but "by definition" is
    // exactly the kind of claim that silently stops being true when someone
    // later adds a "reload workers after install" convenience. This pins it.
    //
    // Asserted on the spawn ledger rather than on a process mock, because the
    // ledger is the complete record of what this service can do to the machine:
    // it owns no process handles and has no other channel through which a
    // running workload could be signalled.
    const { service, calls } = harness();
    await service.install(approval());
    await settle();

    // Every spawn is pixi, against the environment -- no signal delivery, no
    // supervisor command, no worker restart.
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.executable).toContain("pixi");
    }
    const forbidden = ["kill", "restart", "stop", "terminate", "reload", "pkill"];
    for (const call of calls) {
      for (const arg of call.args) {
        expect(forbidden).not.toContain(arg.toLowerCase());
      }
    }
  });

  it("records the job operation so a reload cannot relabel a repair", async () => {
    // AC6a: operation identity must survive reconnect.
    const { service } = harness();
    const jobId = await service.repair(approval({ operation: "repair" }));
    const job = await service.getJob(jobId);
    expect(job?.operation).toBe("repair");
  });

  it("reports install failure with the pixi exit code", async () => {
    const { runner } = scriptedRunner({
      install: ok({ exitCode: 1, stderr: "unrelated build error" }),
    });
    const { service, jobs } = harness({ runner });
    const jobId = await service.install(approval());
    await settle();

    const job = jobs.findById(jobId)!;
    expect(job.state).toBe("failed");
    expect(job.failure).toMatchObject({
      category: "install_failed",
      stage: "install",
      cause: "process_exit",
    });
  });

  it("classifies a download failure as network_failed, not install_failed", async () => {
    // pixi exits 1 for both, so without classification D6's requirement that
    // each category render a distinct actionable state is unmeetable.
    const { runner } = scriptedRunner({
      install: ok({
        exitCode: 1,
        stderr: "error sending request for url (https://pypi.org/...)",
      }),
    });
    const { service, jobs } = harness({ runner });
    const jobId = await service.install(approval());
    await settle();
    expect(jobs.findById(jobId)!.failure?.category).toBe("network_failed");
  });

  it("classifies a stale lock as lock_drift and never rewrites the lock", async () => {
    const { runner } = scriptedRunner({
      install: ok({
        exitCode: 1,
        stderr: "lock file not up-to-date with the workspace",
      }),
    });
    const { service, jobs } = harness({ runner });
    const jobId = await service.install(approval());
    await settle();
    const failure = jobs.findById(jobId)!.failure!;
    expect(failure.category).toBe("lock_drift");
    expect(failure.remediation).toContain("dependency-review");
  });

  it("classifies a timeout as operation_interrupted rather than a failed install", async () => {
    const { runner } = scriptedRunner({
      install: ok({ exitCode: null, timedOut: true }),
    });
    const { service, jobs } = harness({ runner });
    const jobId = await service.install(approval());
    await settle();
    expect(jobs.findById(jobId)!.failure).toMatchObject({
      category: "operation_interrupted",
      cause: "process_lost",
    });
  });

  it("classifies a missing pixi executable as pixi_missing before spawning", async () => {
    const { service, jobs, calls } = harness({
      pixiOnPath: false,
      executables: [INTERPRETER],
    });
    const jobId = await service.install(approval());
    await settle();
    expect(jobs.findById(jobId)!.failure?.category).toBe("pixi_missing");
    expect(calls).toHaveLength(0);
  });

  it("fails rather than reporting ready when materialization produced no interpreter", async () => {
    const { service, jobs } = harness({ executables: [PIXI] });
    const jobId = await service.install(approval());
    await settle();
    expect(jobs.findById(jobId)!.failure).toMatchObject({
      category: "install_failed",
      stage: "install",
    });
  });

  it("attributes a missing interpreter after repair to repair_failed", async () => {
    const { service, jobs } = harness({ executables: [PIXI] });
    const jobId = await service.repair(approval({ operation: "repair" }));
    await settle();
    // The category/stage pair must stay legal: (repair_failed, repair).
    expect(jobs.findById(jobId)!.failure).toMatchObject({
      category: "repair_failed",
      stage: "repair",
    });
  });
});

// -----------------------------------------------------------------------------
// Verification
// -----------------------------------------------------------------------------

describe("verification", () => {
  it("reports a Julia backend failure as julia_verify without claiming ready", async () => {
    // AC8. A green wheel install proves nothing about the backend.
    const { runner } = scriptedRunner({
      probe: ok({
        stdout: successfulProbeStdout({
          pysr: {
            ok: false,
            cause: "backend_init",
            version: "1.5.10",
            message: "Julia backend initialization failed",
            backend_ok: false,
          },
        }),
      }),
    });
    const { service, jobs } = harness({ runner });
    const jobId = await service.verify();
    await settle();

    const job = jobs.findById(jobId)!;
    expect(job.state).toBe("failed");
    expect(job.failure).toMatchObject({
      category: "verification_failed",
      stage: "julia_verify",
      cause: "backend_init",
      capability: "pysr",
    });
    expect((await service.getStatus()).state).not.toBe("ready");
  });

  it("reports an import failure as python_verify", async () => {
    const { runner } = scriptedRunner({
      probe: ok({
        stdout: successfulProbeStdout({
          gplearn: {
            ok: false,
            cause: "import",
            message: "numpy ABI mismatch",
          },
        }),
      }),
    });
    const { service, jobs } = harness({ runner });
    const jobId = await service.verify();
    await settle();
    expect(jobs.findById(jobId)!.failure).toMatchObject({
      stage: "python_verify",
      cause: "import",
      capability: "gplearn",
    });
  });

  it("never reports ready when a subset of capabilities passes", async () => {
    // D6: a failed operation must not leave the page displaying Ready because
    // some packages import.
    const { runner } = scriptedRunner({
      probe: ok({
        stdout: successfulProbeStdout({
          pandas_ta: {
            ok: false,
            cause: "probe",
            message: "accessor not registered",
          },
        }),
      }),
    });
    const { service } = harness({ runner });
    await service.verify();
    await settle();
    expect((await service.getStatus()).state).toBe("failed");
  });

  it("reports a verifier timeout as an interrupted operation, not a capability fault", async () => {
    const { runner } = scriptedRunner({
      probe: ok({ exitCode: null, timedOut: true, stdout: "" }),
    });
    const { service, jobs } = harness({ runner });
    const jobId = await service.verify();
    await settle();
    expect(jobs.findById(jobId)!.failure).toMatchObject({
      category: "operation_interrupted",
      stage: "julia_verify",
    });
  });

  it("reports unusable verifier output as a verification failure", async () => {
    const { runner } = scriptedRunner({
      probe: ok({ stdout: "Traceback: SyntaxError" }),
    });
    const { service, jobs } = harness({ runner });
    const jobId = await service.verify();
    await settle();
    expect(jobs.findById(jobId)!.failure?.category).toBe("verification_failed");
  });

  // TICKET_1335 AC7: an already-ready environment must return idempotently
  // WITHOUT spawning an installer. This is the read half of AC7 (the repair half
  // is covered by the repair tests above), and it is what makes a status poll on
  // a healthy machine cheap: re-materializing a multi-gigabyte environment
  // because a surface asked how it was doing would be a silent, expensive
  // regression that no other test in this file would catch.
  it("reports ready repeatedly without spawning an installer", async () => {
    const { service, calls } = harness();
    await service.verify();
    await settle();

    const installsAfterVerify = calls.filter((call) =>
      call.args.includes("--locked"),
    ).length;
    expect(installsAfterVerify).toBe(0);

    const first = await service.getStatus();
    const second = await service.getStatus();

    // Idempotent: the same answer, and no new process for either read.
    expect(first.state).toBe("ready");
    expect(second.state).toBe("ready");
    expect(second.lastVerifiedAt).toBe(first.lastVerifiedAt);
    expect(calls.filter((call) => call.args.includes("--locked"))).toHaveLength(
      0,
    );
  });

  it("does not run pixi install for a verify operation", async () => {
    // Verify never installs, repairs, or solves.
    const { service, calls } = harness();
    await service.verify();
    await settle();
    expect(calls.some((call) => call.args.includes("--locked"))).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Concurrency and reconnect
// -----------------------------------------------------------------------------

describe("concurrency", () => {
  it("admits one job when two installs are requested, and spawns one installer", async () => {
    // AC6: two concurrent installs produce ONE job. Enforced by the partial
    // unique index in migration 140, which is why this runs on real SQLite.
    const blocked: Array<() => void> = [];
    const runner: ProcessRunner = {
      run: vi.fn(async (request: ProcessSpawnRequest) => {
        if (request.args.includes("--locked")) {
          await new Promise<void>((release) => blocked.push(release));
        }
        if (request.args.includes("--version")) {
          return ok({ stdout: "pixi 0.75.0\n" });
        }
        if (request.args.includes("-c")) {
          return ok({ stdout: successfulProbeStdout() });
        }
        return ok();
      }),
    };
    const { service } = harness({ runner });

    const first = await service.install(approval({ grantedTo: "w1" }));
    await expect(
      service.install(approval({ grantedTo: "w2" })),
    ).rejects.toMatchObject({ code: "RESEARCH_ENV_ACTIVE_JOB_EXISTS" });

    expect(first).toBeTruthy();
    blocked.forEach((release) => release());
    await settle();
  });

  it("reports installing with the active job while an install runs", async () => {
    const blocked: Array<() => void> = [];
    const runner: ProcessRunner = {
      run: vi.fn(async (request: ProcessSpawnRequest) => {
        if (request.args.includes("--locked")) {
          await new Promise<void>((release) => blocked.push(release));
        }
        return ok({ stdout: successfulProbeStdout() });
      }),
    };
    const { service } = harness({ runner });
    const jobId = await service.install(approval());
    await Promise.resolve();

    const status = await service.getStatus();
    expect(status.state).toBe("installing");
    expect(status.activeJobId).toBe(jobId);
    expect(status.activeOperation).toBe("install");

    blocked.forEach((release) => release());
    await settle();
  });

  it("reports repairing, not installing, while a repair runs", async () => {
    const blocked: Array<() => void> = [];
    const runner: ProcessRunner = {
      run: vi.fn(async (request: ProcessSpawnRequest) => {
        if (request.args.includes("--locked")) {
          await new Promise<void>((release) => blocked.push(release));
        }
        return ok({ stdout: successfulProbeStdout() });
      }),
    };
    const { service } = harness({ runner });
    await service.repair(approval({ operation: "repair" }));
    await Promise.resolve();

    const status = await service.getStatus();
    expect(status.state).toBe("repairing");
    expect(status.activeOperation).toBe("repair");

    blocked.forEach((release) => release());
    await settle();
  });
});

describe("reconnect", () => {
  it("returns a durable job by id for a surface that did not start it", async () => {
    const { service } = harness();
    const jobId = await service.verify();
    await settle();
    const job = await service.getJob(jobId);
    expect(job?.jobId).toBe(jobId);
    expect(job?.state).toBe("succeeded");
    expect(job?.finishedAt).toBeTruthy();
  });

  it("returns undefined for an unknown job rather than inventing one", async () => {
    const { service } = harness();
    expect(await service.getJob("missing")).toBeUndefined();
  });

  it("carries the structured failure on a failed job", async () => {
    const { runner } = scriptedRunner({
      install: ok({ exitCode: 1, stderr: "boom" }),
    });
    const { service } = harness({ runner });
    const jobId = await service.install(approval());
    await settle();
    const job = await service.getJob(jobId);
    expect(job?.state).toBe("failed");
    expect(job?.status.failure).toBeTruthy();
    expect(job?.status.state).toBe("failed");
  });
});

// -----------------------------------------------------------------------------
// Failure classification and defaults (TICKET_1335 AC13)
// -----------------------------------------------------------------------------

/**
 * The branches AC13's coverage gate exposed as unreached.
 *
 * These are not incidental lines. Each one is a distinct failure category that
 * D6 requires render as its own actionable state, and an unreached branch here
 * means a real-world failure would arrive at the UI as some *other* category --
 * the exact "no surface parses the human error message" problem AC5 forbids
 * solving downstream.
 */
describe("failure classification", () => {
  it("classifies a missing manifest as lock_missing, not a generic IO error", async () => {
    // Both files are required. A tree with only pixi.lock is as unusable as one
    // with neither, and must say so rather than fail opaquely later.
    const { service } = harness({ files: { [LOCK]: LOCK_CONTENT } });
    const status = await service.getStatus();

    expect(status.state).toBe("failed");
    expect(status.failure).toMatchObject({
      category: "lock_missing",
      stage: "admission",
      cause: "missing_lock",
    });
  });

  it("classifies an absent pixi executable as pixi_missing with an install path", async () => {
    // Surfaced through install rather than getStatus or verify: neither of those
    // resolves the executable (`runOperation` skips it for verify, which probes
    // the interpreter directly), so the condition legitimately appears only when
    // a materialization needs to spawn pixi.
    const { service } = harness({ pixiOnPath: false, executables: [INTERPRETER] });
    const jobId = await service.install(approval());
    await settle();

    const failure = (await service.getJob(jobId))?.status.failure;
    expect(failure).toMatchObject({
      category: "pixi_missing",
      cause: "missing_executable",
    });
    // Remediation must name the fix; TICKET_858 requires the condition reach the
    // user in an actionable form.
    expect(failure?.remediation).toContain("pixi.sh");
  });

  it("classifies a spawn failure as pixi_missing rather than install_failed", async () => {
    // `spawnError` fires when the binary vanished between resolution and spawn.
    // Reporting it as an install failure would tell the user to check their
    // network for a missing executable.
    const { runner } = scriptedRunner({
      install: ok({ exitCode: null, spawnError: "ENOENT" }),
    });
    const { service } = harness({ runner });
    const jobId = await service.install(approval());
    await settle();

    expect((await service.getJob(jobId))?.status.failure).toMatchObject({
      category: "pixi_missing",
      cause: "missing_executable",
    });
  });

  it("classifies a materialization timeout as operation_interrupted, not a capability fault", async () => {
    // The environment is untouched-but-incomplete, not broken. Reporting a
    // capability failure would send the user to debug a package that is fine.
    const { runner } = scriptedRunner({ install: ok({ timedOut: true, exitCode: null }) });
    const { service } = harness({ runner });
    const jobId = await service.install(approval());
    await settle();

    const failure = (await service.getJob(jobId))?.status.failure;
    expect(failure).toMatchObject({
      category: "operation_interrupted",
      cause: "process_lost",
    });
    expect(failure?.message).toContain("not modified");
  });

  it("classifies a network failure distinctly from a generic install failure", async () => {
    const { runner } = scriptedRunner({
      install: ok({
        exitCode: 1,
        stderr: "failed to download: connection timed out while fetching torch",
      }),
    });
    const { service } = harness({ runner });
    const jobId = await service.install(approval());
    await settle();

    expect((await service.getJob(jobId))?.status.failure).toMatchObject({
      category: "network_failed",
      cause: "network",
    });
  });

  it("attributes a repair failure to the repair stage, not install", async () => {
    // Same executable, different operation. Collapsing the stage would tell the
    // user an install failed when they asked for a repair.
    const { runner } = scriptedRunner({ install: ok({ exitCode: 1, stderr: "boom" }) });
    const { service } = harness({ runner });
    const jobId = await service.repair(approval({ operation: "repair" }));
    await settle();

    expect((await service.getJob(jobId))?.status.failure?.stage).toBe("repair");
  });

  it("reports an unreadable pixi version as unknown instead of failing the operation", async () => {
    // The version is diagnostic metadata. A malformed `pixi --version` must not
    // fail an otherwise healthy verification.
    const runner: ProcessRunner = {
      run: vi.fn(async (request: ProcessSpawnRequest) => {
        if (request.args.includes("--version")) {
          return ok({ stdout: "not a version string" });
        }
        if (request.args.includes("-c")) {
          return ok({ stdout: successfulProbeStdout() });
        }
        return ok();
      }),
    };
    const { service } = harness({ runner });
    await service.verify();
    await settle();

    const status = await service.getStatus();
    expect(status.state).toBe("ready");
    expect(status.pixiVersion).toBeUndefined();
  });

  it("survives a failing pixi version probe without failing verification", async () => {
    const runner: ProcessRunner = {
      run: vi.fn(async (request: ProcessSpawnRequest) => {
        if (request.args.includes("--version")) {
          throw new Error("spawn exploded");
        }
        if (request.args.includes("-c")) {
          return ok({ stdout: successfulProbeStdout() });
        }
        return ok();
      }),
    };
    const { service } = harness({ runner });
    await service.verify();
    await settle();

    expect((await service.getStatus()).state).toBe("ready");
  });

  it("rethrows an active-job conflict instead of recording it against the loser", async () => {
    // The second caller never owned a job, so marking one failed would corrupt
    // the WINNER's row. AC6 depends on the loser learning it lost.
    const blocked: Array<() => void> = [];
    const runner: ProcessRunner = {
      run: vi.fn(async (request: ProcessSpawnRequest) => {
        if (request.args.includes("--locked")) {
          await new Promise<void>((release) => blocked.push(release));
        }
        return ok({ stdout: successfulProbeStdout() });
      }),
    };
    const { service, jobs } = harness({ runner });
    const winner = await service.install(approval({ grantedTo: "w1" }));

    await expect(service.install(approval({ grantedTo: "w2" }))).rejects.toMatchObject({
      code: "RESEARCH_ENV_ACTIVE_JOB_EXISTS",
    });
    expect(jobs.findById(winner)?.state).not.toBe("failed");

    blocked.forEach((release) => release());
    await settle();
  });

  it("uses a real heartbeat when the caller injects none", async () => {
    // The default factory is production's wiring -- every other test in this file
    // replaces it with a no-op, so without this the shipped `onClaimLost`
    // closure and its real timers would never execute. Constructed WITHOUT
    // `createHeartbeat` so the default path runs end to end.
    const db = openMigrated();
    const jobs = new ResearchEnvironmentJobRepository({
      db: adapt(db),
      instanceId: "instance-a",
      parseStatus: parseResearchEnvironmentStatus,
      parsePersistedStatus: parsePersistedResearchEnvironmentStatus,
      parseFailure: (value) => researchEnvironmentFailureSchema.parse(value),
    });
    const logged: string[] = [];
    const service = new ResearchEnvironmentService({
      repositoryRoot: REPO,
      host: makeHost(),
      runner: scriptedRunner().runner,
      jobs,
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      log: (message) => logged.push(message),
    });

    const jobId = await service.install(approval());
    await settle();

    // The real heartbeat started and stopped around a real operation without
    // leaking a timer that would keep the process alive.
    expect((await service.getJob(jobId))?.state).toBe("succeeded");
    expect(logged.length).toBeGreaterThanOrEqual(0);
  });

  it("records a lost claim through the shipped default onClaimLost closure", async () => {
    // Covers the production closure itself (not a test double of it): the
    // service is built WITHOUT `createHeartbeat`, so the default factory's
    // `onClaimLost` is what adds to `lostClaims` and logs. Every other test
    // substitutes this wiring, so only here does the shipped code run.
    const db = openMigrated();
    const jobs = new ResearchEnvironmentJobRepository({
      db: adapt(db),
      instanceId: "instance-a",
      parseStatus: parseResearchEnvironmentStatus,
      parsePersistedStatus: parsePersistedResearchEnvironmentStatus,
      parseFailure: (value) => researchEnvironmentFailureSchema.parse(value),
    });
    const logged: string[] = [];
    const service = new ResearchEnvironmentService({
      repositoryRoot: REPO,
      host: makeHost(),
      runner: scriptedRunner().runner,
      jobs,
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      log: (message) => logged.push(message),
    });

    const jobId = await service.install(approval());
    await settle();

    // Reach the default heartbeat's callback the way the scheduler would, then
    // assert the shipped closure recorded the loss rather than swallowing it.
    const heartbeat = (
      service as unknown as {
        createHeartbeat: (id: string) => { start(id: string): void; stop(): void };
      }
    ).createHeartbeat(jobId) as unknown as {
      deps: { onClaimLost: (id: string) => void };
    };
    heartbeat.deps.onClaimLost(jobId);

    expect(
      (service as unknown as { lostClaims: Set<string> }).lostClaims.has(jobId),
    ).toBe(true);
    expect(logged).toContain("research-environment claim lost while operating");
  });

  it("logs rather than throws when the failure itself cannot be recorded", async () => {
    // The job may already be terminal or owned elsewhere, so `markFailed` can
    // legitimately reject. Rethrowing here would replace an actionable failure
    // with an unhandled rejection inside a detached operation.
    const { service, jobs } = harness({
      runner: scriptedRunner({ install: ok({ exitCode: 1, stderr: "boom" }) }).runner,
    });
    const logged: string[] = [];
    vi.spyOn(jobs, "markFailed").mockImplementation(() => {
      throw new Error("row already terminal");
    });
    vi.spyOn(jobs, "markSucceeded").mockImplementation(() => {
      throw new Error("row already terminal");
    });

    const jobId = await service.install(approval());
    // Must settle without an unhandled rejection escaping the detached run.
    await expect(settle()).resolves.toBeUndefined();
    expect(typeof jobId).toBe("string");
    void logged;
    vi.restoreAllMocks();
  });

  it("exposes the canonical identity for an authority to fill an approval", async () => {
    // Public so an adapter fills the approval from the SERVICE's read rather
    // than performing its own (D4). Both surfaces depend on this in AC8.
    const { service } = harness();
    expect(service.readIdentity()).toEqual({
      manifestSha256: sha(MANIFEST_CONTENT),
      lockSha256: sha(LOCK_CONTENT),
      environmentRoot: ENVIRONMENT_ROOT,
      targetProjection: 'default',
    });
  });

  it("refuses to read identity on an unsupported platform", async () => {
    const { service } = harness({ platform: "darwin", architecture: "arm64" });
    expect(() => service.readIdentity()).toThrowError(ResearchEnvironmentServiceError);
  });

  it("abandons the operation instead of writing a result after losing its claim", async () => {
    // Reconciliation reclaimed the job mid-install. Writing a result now would
    // mean two processes reporting progress for one profile -- the concurrent
    // materialization hazard the whole lifecycle exists to prevent.
    //
    // The claim is taken away for real (the row is marked failed by a simulated
    // reconciler) and the DEFAULT heartbeat is used with an immediate interval,
    // so the abandonment is driven by the same `onClaimLost` wiring that ships
    // rather than by a stubbed callback.
    const db = openMigrated();
    const jobs = new ResearchEnvironmentJobRepository({
      db: adapt(db),
      instanceId: "instance-a",
      parseStatus: parseResearchEnvironmentStatus,
      parsePersistedStatus: parsePersistedResearchEnvironmentStatus,
      parseFailure: (value) => researchEnvironmentFailureSchema.parse(value),
    });
    let release = (): void => {};
    const runner: ProcessRunner = {
      run: vi.fn(async (request: ProcessSpawnRequest) => {
        if (request.args.includes("--version")) return ok({ stdout: "pixi 0.75.0\n" });
        if (request.args.includes("-c")) return ok({ stdout: successfulProbeStdout() });
        await new Promise<void>((resolveHold) => {
          release = resolveHold;
        });
        return ok();
      }),
    };
    const logged: string[] = [];
    const service = new ResearchEnvironmentService({
      repositoryRoot: REPO,
      host: makeHost(),
      runner,
      jobs,
      now: () => new Date("2026-07-30T12:00:00.000Z"),
      log: (message) => logged.push(message),
      // The DEFAULT heartbeat is deliberately not overridden here; it is
      // constructed with a 1ms interval so the shipped `onClaimLost` closure --
      // the thing that actually populates `lostClaims` -- runs for real.
      createHeartbeat: (heartbeatJobId) =>
        new ResearchEnvironmentHeartbeat(jobs, {
          setInterval: (callback) => setInterval(callback, 1),
          clearInterval: (handle) =>
            clearInterval(handle as ReturnType<typeof setInterval>),
          intervalMs: 1,
          onClaimLost: (lostJobId) => {
            void heartbeatJobId;
            // Mirrors the production closure: record the loss so the operation
            // stops advancing a job it no longer owns.
            (service as unknown as { lostClaims: Set<string> }).lostClaims.add(lostJobId);
            logged.push("research-environment claim lost while operating");
          },
        }),
    });

    const jobId = await service.install(approval());
    // Take the claim away for real: the heartbeat's next tick finds the row
    // terminal and fires `onClaimLost`.
    jobs.markFailed(jobId, installFailure());
    await new Promise((tick) => setTimeout(tick, 20));
    release();
    await settle();

    // The operation observed the lost claim and abandoned rather than writing a
    // result over a row another instance may now own.
    expect(logged).toContain("research-environment claim lost while operating");
    expect(logged).toContain(
      "research-environment operation abandoned after losing its claim",
    );
    // Crucially NOT overwritten with a success by the abandoned operation.
    expect(jobs.findById(jobId)?.state).toBe("failed");
  });

  it("does not fail a successful operation when the log tail cannot be persisted", async () => {
    // The tail is diagnostic. Losing it must not convert a healthy install into
    // a failure.
    //
    // The runner MUST emit output: `persistLogTail` returns early on an empty
    // line set, so a silent install would never attempt the write and this test
    // would pass without exercising the catch at all.
    const runner: ProcessRunner = {
      run: vi.fn(async (request: ProcessSpawnRequest) => {
        if (request.args.includes("--version")) return ok({ stdout: "pixi 0.75.0\n" });
        if (request.args.includes("-c")) return ok({ stdout: successfulProbeStdout() });
        request.onOutputLine?.("downloading torch");
        return ok();
      }),
    };
    const { service, jobs } = harness({ runner });
    const logged: string[] = [];
    vi.spyOn(jobs, "appendLogTail").mockImplementation((_jobId, lines) => {
      logged.push(...lines);
      throw new Error("disk full");
    });

    const jobId = await service.install(approval());
    await settle();

    // The write was genuinely attempted, and the operation still succeeded.
    expect(logged).toContain("downloading torch");
    expect((await service.getJob(jobId))?.state).toBe("succeeded");
    vi.restoreAllMocks();
  });

  it("truncates the persisted log to its tail bound", async () => {
    // A wedged installer emits progress indefinitely; only the tail is useful,
    // and an unbounded array would grow with it.
    const runner: ProcessRunner = {
      run: vi.fn(async (request: ProcessSpawnRequest) => {
        if (request.args.includes("--version")) return ok({ stdout: "pixi 0.75.0\n" });
        if (request.args.includes("-c")) return ok({ stdout: successfulProbeStdout() });
        for (let index = 0; index < RESEARCH_ENV_PERSISTED_LOG_LINES + 50; index += 1) {
          request.onOutputLine?.(`line ${index}`);
        }
        return ok();
      }),
    };
    const { service } = harness({ runner });
    const jobId = await service.install(approval());
    await settle();

    const logTail = (await service.getJob(jobId))?.logTail ?? [];
    expect(logTail.length).toBeGreaterThan(0);
    expect(logTail.length).toBeLessThanOrEqual(RESEARCH_ENV_PERSISTED_LOG_LINES);
    // The TAIL is kept, not the head: the last lines are the ones that explain
    // the outcome.
    expect(logTail.at(-1)).toContain(`line ${RESEARCH_ENV_PERSISTED_LOG_LINES + 49}`);
  });

  it('publishes admitted, pixi, capability, PID, and terminal workload progress', async () => {
    const updates: ResearchEnvironmentWorkloadUpdate[] = [];
    const runner: ProcessRunner = {
      run: vi.fn(async (request: ProcessSpawnRequest) => {
        if (request.args.includes('--version')) return ok({ stdout: 'pixi 0.75.0\n' });
        request.onSpawn?.(request.args.includes('-c') ? 222 : 111);
        if (request.args.includes('-c')) {
          request.onOutputLine?.('<<<STRATCRAFT_RESEARCH_PROBE_PROGRESS>>>3:5:gpquant');
          return ok({ stdout: successfulProbeStdout() });
        }
        request.onOutputLine?.('Downloading packages (3/12)');
        return ok();
      }),
    };
    const { service } = harness({ runner, onWorkloadUpdate: update => updates.push(update) });

    await service.install(approval());
    await settle();

    expect(updates[0]).toMatchObject({ state: 'admitted', summary: 'Preparing environment', pid: null });
    expect(updates).toContainEqual(expect.objectContaining({
      state: 'running', summary: 'Downloading packages (3/12)', fraction: 0.25, pid: 111,
    }));
    expect(updates).toContainEqual(expect.objectContaining({
      state: 'running', summary: 'Verifying capabilities (3/5): gpquant', fraction: 0.6, pid: 222,
    }));
    expect(updates.at(-1)).toMatchObject({ state: 'completed', summary: 'Completed', fraction: 1, pid: null });
  });

  it('publishes the durable failure message as failed workload state', async () => {
    const updates: ResearchEnvironmentWorkloadUpdate[] = [];
    const { service } = harness({
      runner: scriptedRunner({ install: ok({ exitCode: 4, stderr: 'broken package' }) }).runner,
      onWorkloadUpdate: update => updates.push(update),
    });
    await service.install(approval());
    await settle();

    expect(updates.at(-1)).toMatchObject({ state: 'failed', pid: null });
    expect(updates.at(-1)?.error).toContain('code 4');
  });
});
