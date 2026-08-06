/**
 * TICKET_1335 L5: Electron IPC adapter over `ResearchEnvironmentService`.
 *
 * Transport only. Every lifecycle decision -- what "ready" means, whether a job
 * may be admitted, which stage runs next -- belongs to the shared service, and
 * this module makes none of them. Electron IPC and Guide WebUI MCP therefore
 * invoke the same operation rather than two implementations of it, which is what
 * CLAUDE.md's SURFACE-LAYER PARITY rule requires and what AC8 tests.
 *
 * The mutation channels take NO arguments. That is the D6 shape: renderer input
 * never contains a confirmation boolean, approval token, or approval object, so
 * there is no parameter through which the renderer could supply one. Main asks
 * the human itself (`requestResearchEnvironmentApproval`) and constructs the
 * approval from what it observed.
 *
 * TICKET_206 pairing: these are all sync-await invoke channels. Install, repair,
 * and verify return a job ID immediately rather than holding the channel open
 * for the duration of a multi-gigabyte download -- the renderer follows progress
 * by polling `GET_JOB` with that ID. A long-lived blocking invoke would freeze
 * the calling renderer path and lose the job on any reload.
 */

import { ipcMain } from 'electron';

import { ResearchEnvironmentServiceError } from '@StratCraft/research-environment';

import { RESEARCH_ENVIRONMENT_CHANNELS } from '../../shared/constants/channels';
import { getResearchEnvironmentService } from '../services/research-environment-service-host';
import { requestResearchEnvironmentApproval } from '../services/research-environment-approval';
import { ipcLog } from '../utils/logger';

/**
 * The IPC envelope. Failures are reported, never swallowed: TICKET_858 requires
 * the condition to reach the UI, and `code` lets the renderer render a distinct,
 * actionable message per failure instead of parsing prose (AC7).
 */
type Result<T = unknown> = { success: boolean; data?: T; error?: string; code?: string };

const NO_ENVIRONMENT_ROOT =
  'No governed pixi.toml/pixi.lock pair was found for this installation, so the '
  + 'research environment cannot be inspected or modified from this host.';

/**
 * Refusal when the human declined, dismissed the dialog, or there was no window
 * to ask in.
 *
 * Reported as a failure rather than a silent no-op so the renderer can return
 * the control to its resting state instead of showing a spinner for a job that
 * was never admitted.
 */
const APPROVAL_DECLINED = 'The operation was not approved, so nothing was changed.';

async function withService<T>(
  run: (service: NonNullable<ReturnType<typeof getResearchEnvironmentService>>) => Promise<Result<T>>,
): Promise<Result<T>> {
  const service = getResearchEnvironmentService();
  if (!service) return { success: false, error: NO_ENVIRONMENT_ROOT };
  try {
    return await run(service);
  } catch (error) {
    if (error instanceof ResearchEnvironmentServiceError) {
      return { success: false, error: error.message, code: error.code };
    }
    const message = error instanceof Error ? error.message : String(error);
    ipcLog.error('[TICKET_1335] Research environment operation failed:', message);
    return { success: false, error: message };
  }
}

/**
 * The shared body of install and repair.
 *
 * Both are identical apart from which operation the human is asked about, so
 * they share one path: a second copy would be a second place for the approval
 * ordering to drift. The approval is obtained BEFORE the service is asked to do
 * anything, so a declined dialog reaches no Pixi process and admits no durable
 * job (D6 item 2).
 */
function mutation(operation: 'install' | 'repair' | 'uninstall' | 'remove_capability'): Promise<Result<{ jobId: string }>> {
  return withService(async (service) => {
    const approval = await requestResearchEnvironmentApproval(service, operation);
    if (!approval) return { success: false, error: APPROVAL_DECLINED, code: 'approval_declined' };
    const jobId = operation === 'install'
      ? await service.install(approval)
      : operation === 'repair' ? await service.repair(approval)
        : operation === 'remove_capability' ? await service.removeCapability('gpquant', approval)
          : await service.uninstall(approval);
    return { success: true, data: { jobId } };
  });
}

export function registerResearchEnvironmentHandlers(): void {
  ipcMain.handle(
    RESEARCH_ENVIRONMENT_CHANNELS.GET_STATUS,
    async (): Promise<Result> => withService(async (service) => ({
      success: true,
      data: await service.getStatus(),
    })),
  );

  ipcMain.handle(
    RESEARCH_ENVIRONMENT_CHANNELS.GET_JOB,
    async (_event, jobId: unknown): Promise<Result> => {
      if (typeof jobId !== 'string' || !jobId) {
        return { success: false, error: 'jobId must be a non-empty string' };
      }
      return withService(async (service) => {
        const job = await service.getJob(jobId);
        // An unknown ID is a caller error, not an empty success: returning
        // `null` would render as "no progress" for a job the renderer believes
        // is running.
        if (!job) return { success: false, error: `No research environment job with id "${jobId}".` };
        return { success: true, data: job };
      });
    },
  );

  // Verification reads: it probes the installed environment and reports what it
  // found, changing no manifest, lock, or package. So it needs no approval.
  ipcMain.handle(
    RESEARCH_ENVIRONMENT_CHANNELS.VERIFY,
    async (): Promise<Result> => withService(async (service) => ({
      success: true,
      data: { jobId: await service.verify() },
    })),
  );

  ipcMain.handle(RESEARCH_ENVIRONMENT_CHANNELS.INSTALL, async (): Promise<Result> => mutation('install'));
  ipcMain.handle(RESEARCH_ENVIRONMENT_CHANNELS.REPAIR, async (): Promise<Result> => mutation('repair'));
  ipcMain.handle(RESEARCH_ENVIRONMENT_CHANNELS.UNINSTALL, async (): Promise<Result> => mutation('uninstall'));
  ipcMain.handle(RESEARCH_ENVIRONMENT_CHANNELS.REMOVE_GPQUANT, async (): Promise<Result> => mutation('remove_capability'));

  ipcLog.info('[TICKET_1335] Research environment IPC handlers registered');
}
