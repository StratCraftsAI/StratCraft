/**
 * TICKET_1335 L5: Service API adapter over `ResearchEnvironmentService`.
 *
 * This module owns no lifecycle logic. It resolves the shared service, converts
 * a transported human-origin attestation into the internal approval, and maps
 * service errors onto the `{ success, data, error }` envelope. It must not spawn
 * pixi, resolve an interpreter, or decide readiness -- those belong to the
 * service (TICKET_1335 D2).
 *
 * Why an attestation is converted here rather than transported as an approval:
 * the Service API is loopback with a bearer token, and that token proves only
 * that a local process could read the discovery file. It is not evidence that a
 * human approved a multi-gigabyte local mutation. TICKET_1335 D6 item 3
 * therefore forbids serializing the approval; the authority that observed the
 * human sends evidence, and the process that owns the service constructs the
 * approval from it. The service then independently re-reads and compares both
 * hashes at admission, so a replayed or forged attestation still cannot admit a
 * job against a lock the repository did not approve.
 */

import {
  parseResearchEnvironmentApprovalAttestation,
} from '@StratCraft/types';
import {
  ResearchEnvironmentJobError,
  ResearchEnvironmentServiceError,
  type LocalMutationApproval,
  type ResearchEnvironmentService,
} from '@StratCraft/research-environment';

import { getResearchEnvironmentService } from '../research-environment-service-host';
import { appLog } from '../../utils/logger';

type Result = { success: boolean; data?: unknown; error?: string };

/**
 * The structured refusal used when no governed repository root exists.
 *
 * Reported as an error rather than an empty status: TICKET_858 requires the
 * condition reach the caller, and a fabricated `absent` status would tell the
 * user to install an environment that this installation cannot manage.
 */
const NO_ENVIRONMENT_ROOT =
  'No governed pixi.toml/pixi.lock pair was found for this installation, so the '
  + 'research environment cannot be inspected or modified from this host.';

function withService(
  run: (service: ResearchEnvironmentService) => Promise<Result>,
): Promise<Result> {
  const service = getResearchEnvironmentService();
  if (!service) return Promise.resolve({ success: false, error: NO_ENVIRONMENT_ROOT });
  return run(service).catch((error: unknown) => failure(error));
}

/**
 * Map a thrown error onto the envelope, preserving the service's own error code.
 *
 * The code is surfaced verbatim so a surface can render a distinct, actionable
 * message per failure (TICKET_1335_1 AC7) instead of parsing prose.
 */
function failure(error: unknown): Result {
  if (error instanceof ResearchEnvironmentServiceError
    || error instanceof ResearchEnvironmentJobError) {
    return { success: false, error: error.message, data: { code: error.code } };
  }
  const message = error instanceof Error ? error.message : String(error);
  appLog.error('[TICKET_1335] Research environment operation failed:', message);
  return { success: false, error: message };
}

export function getStatus(): Promise<Result> {
  return withService(async (service) => ({
    success: true,
    data: await service.getStatus(),
  }));
}

export function getJob(body: Record<string, unknown>): Promise<Result> {
  const jobId = typeof body.job_id === 'string' ? body.job_id : '';
  if (!jobId) return Promise.resolve({ success: false, error: 'job_id must be a non-empty string' });
  return withService(async (service) => {
    const job = await service.getJob(jobId);
    // An unknown job ID is a caller error, not an empty success: a surface that
    // received `null` would show "no progress" for a job it believes exists.
    if (!job) return { success: false, error: `No research environment job with id "${jobId}".` };
    return { success: true, data: job };
  });
}

export function verify(): Promise<Result> {
  return withService(async (service) => ({
    success: true,
    data: { jobId: await service.verify() },
  }));
}

/**
 * Build the internal approval from transported evidence.
 *
 * The hashes are read by the service at admission, not supplied here: D4 states
 * adapters "may not prevalidate hashes and assume the service will see the same
 * files". So this fills them from the service's own canonical identity read,
 * which is the same read the approval is subsequently compared against --
 * meaning a manifest edited between the human's decision and admission still
 * invalidates the approval.
 */
function approvalFrom(
  service: ResearchEnvironmentService,
  operation: 'install' | 'repair' | 'uninstall' | 'remove_capability',
  body: Record<string, unknown>,
): LocalMutationApproval {
  const attestation = parseResearchEnvironmentApprovalAttestation(body.attestation);
  if (attestation.operation !== operation) {
    throw new Error(
      `The attestation authorizes ${attestation.operation}, not ${operation}.`,
    );
  }
  const identity = service.readIdentity(operation);
  return {
    operation,
    profile: attestation.profile,
    manifestSha256: identity.manifestSha256,
    lockSha256: identity.lockSha256,
    environmentRoot: identity.environmentRoot,
    targetProjection: identity.targetProjection,
    grantedTo: attestation.grantedTo,
    decisionId: attestation.decisionId,
  };
}

export function install(body: Record<string, unknown>): Promise<Result> {
  return withService(async (service) => ({
    success: true,
    data: { jobId: await service.install(approvalFrom(service, 'install', body)) },
  }));
}

export function repair(body: Record<string, unknown>): Promise<Result> {
  return withService(async (service) => ({
    success: true,
    data: { jobId: await service.repair(approvalFrom(service, 'repair', body)) },
  }));
}

export function uninstall(body: Record<string, unknown>): Promise<Result> {
  return withService(async (service) => ({
    success: true,
    data: { jobId: await service.uninstall(approvalFrom(service, 'uninstall', body)) },
  }));
}

export function removeCapability(body: Record<string, unknown>): Promise<Result> {
  return withService(async (service) => ({
    success: true,
    data: {
      jobId: await service.removeCapability(
        'gpquant',
        approvalFrom(service, 'remove_capability', body),
      ),
    },
  }));
}
