/**
 * TICKET_1335 L5: Service API adapter trust boundary.
 *
 * The assertions that matter here are the refusals. This adapter is the point
 * where transported evidence becomes an internal approval, so the tests prove
 * that evidence which is absent, malformed, for the wrong operation, or shaped
 * like a ready-made approval never reaches the service as authority (D6 item 3).
 *
 * The service itself is mocked because its own admission, hash comparison, and
 * single-use behaviour are covered by the 162 tests in
 * `@StratCraft/research-environment`. What is untested elsewhere -- and tested
 * here -- is the conversion step this module owns.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetService } = vi.hoisted(() => ({ mockGetService: vi.fn() }));

vi.mock('../../research-environment-service-host', () => ({
  getResearchEnvironmentService: mockGetService,
}));
vi.mock('../../../utils/logger', () => ({
  appLog: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  ResearchEnvironmentJobError,
  ResearchEnvironmentServiceError,
  RESEARCH_ENV_JOB_ERROR_CODES,
  RESEARCH_ENV_SERVICE_ERROR_CODES,
} from '@StratCraft/research-environment';

import { getJob, getStatus, install, removeCapability, repair, uninstall, verify } from '../research-environment-api';

const IDENTITY = {
  manifestSha256: 'a'.repeat(64),
  lockSha256: 'b'.repeat(64),
  environmentRoot: '/repo/.pixi/envs/default',
  targetProjection: 'default',
};

const attestation = (overrides: Record<string, unknown> = {}) => ({
  operation: 'install',
  profile: 'research-default',
  grantedTo: 'mcp-session-1',
  decisionId: 'decision-1',
  verifiedAt: '2026-07-30T00:00:00.000Z',
  ...overrides,
});

function serviceStub(overrides: Record<string, unknown> = {}) {
  return {
    getStatus: vi.fn(async () => ({ state: 'absent' })),
    getJob: vi.fn(async () => undefined),
    install: vi.fn(async () => 'job-install'),
    repair: vi.fn(async () => 'job-repair'),
    uninstall: vi.fn(async () => 'job-uninstall'),
    removeCapability: vi.fn(async () => 'job-remove-gpquant'),
    verify: vi.fn(async () => 'job-verify'),
    readIdentity: vi.fn(() => IDENTITY),
    ...overrides,
  };
}

describe('research environment Service API adapter (TICKET_1335 L5)', () => {
  let service: ReturnType<typeof serviceStub>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = serviceStub();
    mockGetService.mockReturnValue(service);
  });

  describe('reads', () => {
    it('returns the canonical status verbatim', async () => {
      await expect(getStatus()).resolves.toEqual({ success: true, data: { state: 'absent' } });
    });

    it('refuses a blank job id instead of querying', async () => {
      await expect(getJob({})).resolves.toMatchObject({ success: false });
      expect(service.getJob).not.toHaveBeenCalled();
    });

    it('reports an unknown job as an error, not an empty success', async () => {
      // A surface receiving `success: true, data: null` would render "no
      // progress" for a job the user believes is running.
      const result = await getJob({ job_id: 'missing' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('missing');
    });

    it('starts verify with no approval, since it mutates nothing', async () => {
      await expect(verify()).resolves.toEqual({ success: true, data: { jobId: 'job-verify' } });
      expect(service.verify).toHaveBeenCalledTimes(1);
    });
  });

  describe('mutation authority', () => {
    it('binds the fixed GPQuant capability without accepting a package field', async () => {
      const result = await removeCapability({
        attestation: attestation({ operation: 'remove_capability' }),
        package: 'duckdb',
      });
      expect(result).toEqual({ success: true, data: { jobId: 'job-remove-gpquant' } });
      expect(service.removeCapability).toHaveBeenCalledWith(
        'gpquant',
        expect.objectContaining({ operation: 'remove_capability' }),
      );
    });

    it('constructs the approval from the service own identity read', async () => {
      const result = await install({ attestation: attestation() });
      expect(result).toEqual({ success: true, data: { jobId: 'job-install' } });
      // D4: the adapter must not read the hashes itself; it fills them from the
      // same read the service re-performs and compares at admission.
      expect(service.readIdentity).toHaveBeenCalledTimes(1);
      expect(service.install).toHaveBeenCalledWith({
        operation: 'install',
        profile: 'research-default',
        manifestSha256: IDENTITY.manifestSha256,
        lockSha256: IDENTITY.lockSha256,
        environmentRoot: IDENTITY.environmentRoot,
        targetProjection: IDENTITY.targetProjection,
        grantedTo: 'mcp-session-1',
        decisionId: 'decision-1',
      });
    });

    it('refuses install with no attestation at all', async () => {
      const result = await install({});
      expect(result.success).toBe(false);
      expect(service.install).not.toHaveBeenCalled();
    });

    it('refuses an install attestation replayed onto repair', async () => {
      // Cross-operation replay: a human approved an install, and the same
      // evidence is presented to authorize a repair.
      const result = await repair({ attestation: attestation({ operation: 'install' }) });
      expect(result.success).toBe(false);
      expect(result.error).toContain('authorizes install');
      expect(service.repair).not.toHaveBeenCalled();
    });

    it('refuses a blank decision identity', async () => {
      // Single-use is keyed on decisionId; a blank one would make replay
      // detection trivially bypassable.
      const result = await install({ attestation: attestation({ decisionId: '' }) });
      expect(result.success).toBe(false);
      expect(service.install).not.toHaveBeenCalled();
    });

    it('refuses a transported approval object in place of evidence', async () => {
      const result = await install({
        attestation: { ...attestation(), manifestSha256: 'c'.repeat(64) },
      });
      expect(result.success).toBe(false);
      expect(service.install).not.toHaveBeenCalled();
    });

    it('refuses a model-supplied confirm boolean', async () => {
      // The exact shape D6 names as prohibited.
      const result = await install({ confirm: true });
      expect(result.success).toBe(false);
      expect(service.install).not.toHaveBeenCalled();
    });

    it('routes repair to repair, never to install', async () => {
      // AC4: repair is a distinct operation, not install relabelled.
      await repair({ attestation: attestation({ operation: 'repair' }) });
      expect(service.repair).toHaveBeenCalledTimes(1);
      expect(service.install).not.toHaveBeenCalled();
    });

    it('routes an uninstall attestation only to uninstall', async () => {
      const result = await uninstall({ attestation: attestation({ operation: 'uninstall' }) });
      expect(result).toEqual({ success: true, data: { jobId: 'job-uninstall' } });
      expect(service.uninstall).toHaveBeenCalledWith(expect.objectContaining({ operation: 'uninstall' }));
      expect(service.install).not.toHaveBeenCalled();
      expect(service.repair).not.toHaveBeenCalled();
    });
  });

  describe('failure propagation', () => {
    it('surfaces the service error code so a surface can render it', async () => {
      // AC7: no surface parses prose; the code travels.
      service.install.mockRejectedValueOnce(new ResearchEnvironmentServiceError(
        RESEARCH_ENV_SERVICE_ERROR_CODES.APPROVAL_STALE_HASHES,
        'The manifest or lock changed.',
      ));
      const result = await install({ attestation: attestation() });
      expect(result).toMatchObject({
        success: false,
        data: { code: RESEARCH_ENV_SERVICE_ERROR_CODES.APPROVAL_STALE_HASHES },
      });
    });

    it('surfaces a corrupt persisted-job code instead of collapsing it to prose', async () => {
      service.getStatus.mockRejectedValueOnce(new ResearchEnvironmentJobError(
        RESEARCH_ENV_JOB_ERROR_CODES.CORRUPT_JOB_ROW,
        'A persisted research environment result is unreadable.',
      ));

      await expect(getStatus()).resolves.toMatchObject({
        success: false,
        data: { code: RESEARCH_ENV_JOB_ERROR_CODES.CORRUPT_JOB_ROW },
      });
    });

    it('reports an absent governed root rather than fabricating a status', async () => {
      // A synthesized `absent` would tell the user to install an environment
      // this installation cannot manage (TICKET_858).
      mockGetService.mockReturnValue(null);
      const result = await getStatus();
      expect(result.success).toBe(false);
      expect(result.error).toContain('pixi.toml');
    });

    it('refuses mutations when no governed root exists', async () => {
      mockGetService.mockReturnValue(null);
      await expect(install({ attestation: attestation() }))
        .resolves.toMatchObject({ success: false });
    });
  });
});
