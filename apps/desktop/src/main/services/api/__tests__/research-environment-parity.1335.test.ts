/**
 * TICKET_1335 AC8: Electron IPC and Guide WebUI MCP are one implementation.
 *
 * The four existing 1335 suites each test one adapter in isolation, and every
 * one of them passes even in the world this ticket exists to prevent: two
 * surfaces that each work correctly against their own private lifecycle logic.
 * Isolation is what those suites are for, so nothing there can fail when the
 * surfaces diverge. This file is the missing assertion -- it drives BOTH
 * adapters against ONE shared service double and proves they converge.
 *
 * "Converge" is made falsifiable as three distinct claims, because the ways
 * this can regress are distinct:
 *
 *   1. Same method. Both adapters call the same `ResearchEnvironmentService`
 *      member with the same arguments. A surface that grew its own install path
 *      -- spawning pixi, resolving an interpreter, deciding readiness -- would
 *      leave the shared double's method uncalled, which is the failure the
 *      CLAUDE.md SURFACE-LAYER PARITY rule names.
 *   2. Same payload. Both serialize the same service return value. A surface
 *      that reshaped, renamed, or enriched the result would make the same job
 *      render differently depending on where the user asked from.
 *   3. Same refusal. An error from the service reaches both surfaces with the
 *      service's own `code` preserved, so neither surface has to parse prose to
 *      decide what happened (TICKET_858, and AC5's "no surface parses the human
 *      error message").
 *
 * Scope note. The MCP side is exercised at its Service API adapter, which is
 * where the MCP transport terminates: `handlers/research-environment.ts` calls
 * `bridge/api-client.ts`, which HTTP-POSTs to the routes that `http-server.ts`
 * dispatches into `research-environment-api.ts` (http-server.ts:480-484). The
 * two transports below are therefore the real ones; only the socket between
 * them is elided. The MCP handler's own trust-boundary behaviour -- refusing
 * when no verified decision is in scope, refusing a cross-operation
 * attestation -- is `research-environment.1335.test.ts` and is not restated.
 *
 * Mutation parity is asserted at the service boundary rather than end-to-end
 * on purpose: the two surfaces deliberately obtain approval DIFFERENTLY (Main
 * shows a native dialog and builds the approval; MCP transports an attestation
 * the Service API converts). D6 requires that difference. What must not differ
 * is what reaches the service, which is exactly what is asserted here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetService, mockRequestApproval, mockIpcMain } = vi.hoisted(() => ({
  mockGetService: vi.fn(),
  mockRequestApproval: vi.fn(),
  mockIpcMain: { handle: vi.fn() },
}));

vi.mock('../../research-environment-service-host', () => ({
  getResearchEnvironmentService: mockGetService,
}));
vi.mock('../../research-environment-approval', () => ({
  requestResearchEnvironmentApproval: mockRequestApproval,
}));
vi.mock('electron', () => ({ ipcMain: mockIpcMain }));
vi.mock('../../../utils/logger', () => ({
  appLog: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  ipcLog: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  ResearchEnvironmentServiceError,
  RESEARCH_ENV_SERVICE_ERROR_CODES,
} from '@StratCraft/research-environment';

import { RESEARCH_ENVIRONMENT_CHANNELS } from '../../../../shared/constants/channels';
import { registerResearchEnvironmentHandlers } from '../../../ipc/research-environment-handlers';
import * as serviceApi from '../research-environment-api';

const IDENTITY = { manifestSha256: 'a'.repeat(64), lockSha256: 'b'.repeat(64) };

/**
 * A status shaped like a real one rather than `{ state: 'absent' }`.
 *
 * Parity on a trivial object is a weak claim: a surface that dropped
 * `capabilities` or flattened `failure` would still pass. AC3 requires every
 * capability to appear exactly once in the shared result, so the fixture
 * carries the nested shape a reshaping surface would damage.
 */
const STATUS = Object.freeze({
  state: 'ready',
  profile: 'research-default',
  supportedPlatform: true,
  capabilities: {
    histdata: { state: 'ready', expectedVersion: '0.1.0', installedVersion: '0.1.0' },
    duckdb: { state: 'ready', expectedVersion: '1.5.3', installedVersion: '1.5.3' },
    gplearn: { state: 'ready', expectedVersion: '0.4.3', installedVersion: '0.4.3' },
    gpquant: { state: 'ready', expectedVersion: '0.1.6', installedVersion: '0.1.6' },
    pysr: { state: 'ready', expectedVersion: '1.5.10', installedVersion: '1.5.10' },
    pandas_ta: { state: 'ready', expectedVersion: '0.4.71b0', installedVersion: '0.4.71b0' },
  },
});

const JOB = Object.freeze({
  jobId: 'job-1',
  profile: 'research-default',
  operation: 'install',
  state: 'running',
  stage: 'materializing',
});

function serviceStub(overrides: Record<string, unknown> = {}) {
  return {
    getStatus: vi.fn(async () => STATUS),
    // Typed as optional because the unknown-job case resolves `undefined`, and
    // an inferred-from-fixture return type would reject that assignment.
    getJob: vi.fn(async (): Promise<typeof JOB | undefined> => JOB),
    install: vi.fn(async () => 'job-install'),
    repair: vi.fn(async () => 'job-repair'),
    verify: vi.fn(async () => 'job-verify'),
    readIdentity: vi.fn(() => IDENTITY),
    ...overrides,
  };
}

/**
 * Invoke an Electron IPC channel through the real registration.
 *
 * Going through `registerResearchEnvironmentHandlers` rather than importing a
 * function keeps the channel name in the assertion path: a handler moved to a
 * different channel fails here instead of silently passing.
 */
async function invokeIpc(channel: string, ...args: unknown[]): Promise<Record<string, unknown>> {
  const entry = mockIpcMain.handle.mock.calls.find(([name]) => name === channel);
  if (!entry) throw new Error(`No IPC handler registered for channel "${channel}".`);
  return (await entry[1]({}, ...args)) as Record<string, unknown>;
}

/** The attestation the MCP authority transports for a mutating call. */
const attestation = (operation: 'install' | 'repair') => ({
  operation,
  profile: 'research-default',
  grantedTo: 'mcp-session-1',
  decisionId: `decision-${operation}`,
  verifiedAt: '2026-07-30T00:00:00.000Z',
});

describe('research environment cross-surface parity (TICKET_1335 AC8)', () => {
  let service: ReturnType<typeof serviceStub>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIpcMain.handle.mockClear();
    service = serviceStub();
    mockGetService.mockReturnValue(service);
    // Main observed a human and built an approval. The MCP path builds its own
    // from the transported attestation; both must arrive at the same service.
    mockRequestApproval.mockImplementation(async (_svc: unknown, operation: string) => ({
      operation,
      profile: 'research-default',
      manifestSha256: IDENTITY.manifestSha256,
      lockSha256: IDENTITY.lockSha256,
      grantedTo: 'electron-main',
      decisionId: `dialog-${operation}`,
    }));
    registerResearchEnvironmentHandlers();
  });

  describe('reads reach the same service method and serialize the same payload', () => {
    it('status: one call each, identical payload, nested capabilities intact', async () => {
      const ipc = await invokeIpc(RESEARCH_ENVIRONMENT_CHANNELS.GET_STATUS);
      const api = await serviceApi.getStatus();

      // 1. Same method, once per surface -- neither computed a status locally.
      expect(service.getStatus).toHaveBeenCalledTimes(2);
      // 2. Same payload, structurally not just referentially.
      expect(ipc.data).toEqual(api.data);
      expect(ipc.data).toEqual(STATUS);
      // AC3: the capability record survives both adapters whole.
      expect(Object.keys((ipc.data as typeof STATUS).capabilities)).toEqual(
        Object.keys(STATUS.capabilities),
      );
    });

    it('job: same lookup argument and same record on both surfaces', async () => {
      const ipc = await invokeIpc(RESEARCH_ENVIRONMENT_CHANNELS.GET_JOB, 'job-1');
      const api = await serviceApi.getJob({ job_id: 'job-1' });

      // The differing transport shapes -- a positional IPC argument versus a
      // `job_id` body field -- must resolve to the same service argument.
      expect(service.getJob).toHaveBeenNthCalledWith(1, 'job-1');
      expect(service.getJob).toHaveBeenNthCalledWith(2, 'job-1');
      expect(ipc.data).toEqual(api.data);
      expect(ipc.data).toEqual(JOB);
    });

    it('verify: both return the same job id under the same key, mutating nothing', async () => {
      const ipc = await invokeIpc(RESEARCH_ENVIRONMENT_CHANNELS.VERIFY);
      const api = await serviceApi.verify();

      expect(service.verify).toHaveBeenCalledTimes(2);
      expect(ipc.data).toEqual(api.data);
      expect(ipc.data).toEqual({ jobId: 'job-verify' });
      // AC7a: verification is a read. Neither surface may reach a mutation.
      expect(service.install).not.toHaveBeenCalled();
      expect(service.repair).not.toHaveBeenCalled();
    });

    it('an unknown job is an error on both surfaces, never an empty success', async () => {
      service.getJob.mockResolvedValue(undefined);

      const ipc = await invokeIpc(RESEARCH_ENVIRONMENT_CHANNELS.GET_JOB, 'missing');
      const api = await serviceApi.getJob({ job_id: 'missing' });

      // Divergence here would mean one surface renders "no progress" for a job
      // the user believes is running while the other reports it correctly.
      expect(ipc.success).toBe(false);
      expect(api.success).toBe(false);
      expect(ipc.error).toBe(api.error);
    });
  });

  describe('mutations converge on the same service call', () => {
    it.each([
      ['install', RESEARCH_ENVIRONMENT_CHANNELS.INSTALL, 'job-install'] as const,
      ['repair', RESEARCH_ENVIRONMENT_CHANNELS.REPAIR, 'job-repair'] as const,
    ])('%s: same method, same operation and profile, same job-id shape', async (
      operation,
      channel,
      jobId,
    ) => {
      const ipc = await invokeIpc(channel);
      const api = await serviceApi[operation]({ attestation: attestation(operation) });

      // 1. Same method -- neither surface spawned its own installer.
      expect(service[operation]).toHaveBeenCalledTimes(2);

      const [[fromIpc], [fromApi]] = service[operation].mock.calls as unknown as [
        [Record<string, unknown>], [Record<string, unknown>],
      ];

      // The approval's PROVENANCE differs by design (a native dialog versus a
      // transported attestation), so grantedTo/decisionId are expected to
      // differ. Everything that determines what gets materialized must not.
      expect(fromIpc.operation).toBe(operation);
      expect(fromApi.operation).toBe(operation);
      expect(fromIpc.profile).toBe(fromApi.profile);
      expect(fromIpc.manifestSha256).toBe(fromApi.manifestSha256);
      expect(fromIpc.lockSha256).toBe(fromApi.lockSha256);

      // 2. Same payload shape out.
      expect(ipc.data).toEqual(api.data);
      expect(ipc.data).toEqual({ jobId });
    });

    it('neither surface prevalidates hashes; both take the service identity (D4)', async () => {
      await invokeIpc(RESEARCH_ENVIRONMENT_CHANNELS.INSTALL);
      await serviceApi.install({ attestation: attestation('install') });

      const [[fromIpc], [fromApi]] = service.install.mock.calls as unknown as [
        [Record<string, unknown>], [Record<string, unknown>],
      ];
      // Both hashes trace to the service's own read. An adapter that computed
      // its own would pin an approval to files the service never saw.
      expect(fromIpc.manifestSha256).toBe(IDENTITY.manifestSha256);
      expect(fromApi.manifestSha256).toBe(IDENTITY.manifestSha256);
      expect(fromIpc.lockSha256).toBe(IDENTITY.lockSha256);
      expect(fromApi.lockSha256).toBe(IDENTITY.lockSha256);
    });
  });

  describe('failures reach both surfaces with the service code preserved (AC5)', () => {
    it.each([
      RESEARCH_ENV_SERVICE_ERROR_CODES.UNSUPPORTED_PLATFORM,
      RESEARCH_ENV_SERVICE_ERROR_CODES.APPROVAL_STALE_HASHES,
    ])('%s carries the same code and message to IPC and MCP', async (code) => {
      const failure = new ResearchEnvironmentServiceError(code, `failing with ${code}`);
      service.getStatus.mockRejectedValue(failure);

      const ipc = await invokeIpc(RESEARCH_ENVIRONMENT_CHANNELS.GET_STATUS);
      const api = await serviceApi.getStatus();

      expect(ipc.success).toBe(false);
      expect(api.success).toBe(false);
      expect(ipc.error).toBe(api.error);

      // The code must survive on BOTH surfaces, though they carry it in
      // different envelope positions (IPC top-level `code`; Service API nests
      // it under `data` for the HTTP body). Losing it on either side forces
      // that surface to parse prose, which AC5 forbids.
      expect(ipc.code).toBe(code);
      expect((api.data as { code?: string } | undefined)?.code).toBe(code);
    });

    it('an absent governed root refuses identically on both surfaces', async () => {
      mockGetService.mockReturnValue(undefined);

      const ipc = await invokeIpc(RESEARCH_ENVIRONMENT_CHANNELS.GET_STATUS);
      const api = await serviceApi.getStatus();

      expect(ipc.success).toBe(false);
      expect(api.success).toBe(false);
      // Same sentence, so the user is told the same thing wherever they asked.
      expect(ipc.error).toBe(api.error);
    });
  });
});
