/**
 * TICKET_1335 D6: the Electron-side authority for research-environment mutations.
 *
 * Electron reaches the same semantic contract as Guide WebUI through a different
 * adapter. In the MCP path the authority runs a WebAuthn ceremony in another
 * process, so its decision must cross a boundary as an attestation. Here the
 * authority and the owner of `ResearchEnvironmentService` are the same process,
 * so the decision never needs to be transported at all -- Main shows the native
 * dialog, observes the answer itself, and constructs the approval directly.
 *
 * That is the whole reason this module exists rather than the renderer sending a
 * confirmation. D6 states renderer input never contains a confirmation boolean,
 * approval token, or approval object. If the renderer sent `confirmed: true`,
 * the approval would rest on a value authored outside the trust boundary, and
 * any compromised or buggy renderer path -- or a plugin webview -- could install
 * several gigabytes without a human present. Main observing its own dialog is
 * the only shape in which the process performing the mutation is also the one
 * that saw the human.
 *
 * The hashes are read from the service's own canonical identity read, not passed
 * in: D4 forbids an adapter prevalidating hashes and assuming the service will
 * see the same files. The service re-reads and compares them at admission, so a
 * manifest edited between the dialog and admission invalidates this approval
 * rather than silently installing something else.
 */

import { createHash, randomUUID } from 'node:crypto';

import { DEFAULT_RESEARCH_ENVIRONMENT_PROFILE } from '@StratCraft/types';
import type { FactorCatalogId } from '@StratCraft/types';
import type {
  LocalMutationApproval,
  ResearchEnvironmentService,
} from '@StratCraft/research-environment';

import { getMainWindow } from '../window';
import { NATIVE_AGENT_PERMISSION_TTL_MS } from '../constants/agent-permission';
import { requestNativeAgentPermission } from './agent-permission-authority-adapter';

/** What the human is being asked to approve, in their own terms. */
interface ApprovalPrompt {
  title: string;
  message: string;
  detail: string;
  confirmLabel: string;
}

/**
 * Install and repair are described separately because they are not the same
 * promise to the user. Install downloads several gigabytes; repair re-materializes
 * from a lock that is already present. Collapsing them into one generic
 * "are you sure?" would ask for consent to something the user cannot identify,
 * which is consent in form only.
 *
 * Both state the property D6 requires the UI to state: the operation affects
 * only research runs started afterwards. An already running Python process is
 * never restarted, killed, or retargeted.
 */
const PROMPTS: Readonly<Record<'install' | 'repair' | 'uninstall' | 'remove_capability', ApprovalPrompt>> = {
  install: {
    title: 'Install the research environment',
    message: 'Install the locked research environment on this machine?',
    detail:
      'StratCraft will download and materialize the packages pinned in pixi.lock. '
      + 'This needs several gigabytes of disk space and can take a while on a slow '
      + 'connection.\n\n'
      + 'Only research runs started after it finishes will use the new environment. '
      + 'Anything running right now keeps its current interpreter and is not '
      + 'restarted or interrupted.',
    confirmLabel: 'Install',
  },
  repair: {
    title: 'Repair the research environment',
    message: 'Re-materialize the research environment from the same locked manifest?',
    detail:
      'StratCraft will rebuild the installed environment from the existing '
      + 'pixi.lock. It does not change the manifest or the lock, so the pinned '
      + 'package versions stay exactly as they are -- only the damaged '
      + 'installation is replaced.\n\n'
      + 'Only research runs started after it finishes are affected. Anything '
      + 'running right now is left alone.',
    confirmLabel: 'Repair',
  },
  uninstall: {
    title: 'Uninstall the research environment',
    message: 'Remove the locked research environment from this machine?',
    detail:
      'StratCraft will remove only the local default Pixi environment. The committed manifest, '
      + 'lock, caches, research data, results, settings, and credentials are preserved. You can '
      + 'reinstall the identical environment later.\n\nUninstall is refused while any research '
      + 'workload is active or its activity cannot be verified.',
    confirmLabel: 'Uninstall',
  },
  remove_capability: {
    title: 'Remove GPQuant capability',
    message: 'Switch the active research environment to the locked projection without GPQuant?',
    detail: 'StratCraft will materialize and verify the repository-locked without-gpquant projection before switching future research runs to it. Other locked research capabilities and all stored factors, results, caches, data, settings, and credentials are preserved. The operation is refused unless research workload state is authoritatively idle.',
    confirmLabel: 'Remove GPQuant',
  },
};

/**
 * Ask the human, and return a trusted approval only if they said yes.
 *
 * Returns `null` on refusal, on dialog dismissal, and when there is no window to
 * host a modal. The last case is not an edge case to paper over: without a
 * window there is no human to ask, so proceeding would mean mutating the machine
 * on nobody's authority. `cancelId`/`defaultId` both select Cancel, so dismissing
 * the dialog with Escape or the window close button reads as refusal rather than
 * as approval.
 */
export async function requestResearchEnvironmentApproval(
  service: ResearchEnvironmentService,
  operation: 'install' | 'repair' | 'uninstall' | 'remove_capability',
): Promise<LocalMutationApproval | null> {
  const window = getMainWindow();
  if (!window) return null;

  const prompt = PROMPTS[operation];
  const identity = service.readIdentity(operation);
  const subjectHash = createHash('sha256').update(JSON.stringify({
    lockSha256: identity.lockSha256,
    manifestSha256: identity.manifestSha256,
    operation,
    profile: DEFAULT_RESEARCH_ENVIRONMENT_PROFILE,
    environmentRoot: identity.environmentRoot,
    targetProjection: identity.targetProjection,
  })).digest('hex');
  const request = {
    requestId: randomUUID(),
    expectedPayloadHash: subjectHash,
    operation: `research-environment.${operation}`,
    subjectHash,
    turnAdmissionFingerprint: `electron:${window.webContents.id}`,
    webContentsId: window.webContents.id,
    expiresAt: new Date(Date.now() + NATIVE_AGENT_PERMISSION_TTL_MS).toISOString(),
  };
  const decision = await requestNativeAgentPermission(request, window, prompt);
  if (!decision.approved) return null;

  return {
    operation,
    profile: DEFAULT_RESEARCH_ENVIRONMENT_PROFILE,
    manifestSha256: identity.manifestSha256,
    lockSha256: identity.lockSha256,
    environmentRoot: identity.environmentRoot,
    targetProjection: identity.targetProjection,
    // The window, not the renderer's claim about itself: a compromised renderer
    // cannot present itself as a different surface.
    grantedTo: `electron:${window.webContents.id}`,
    // Per-dialog, so a second genuine approval in the same window is a distinct
    // decision. Keying single-use on `grantedTo` instead would reject a
    // legitimate retry after a network failure.
    decisionId: decision.decisionId,
  };
}

/**
 * TICKET_1335 AC12b: the Electron-side authority for catalog deactivation.
 *
 * Lives beside the environment authority because it is the same mechanism
 * pointed at the third local-machine mutation: Main shows the dialog, observes
 * the answer itself, and constructs the approval, so no renderer-authored
 * boolean is ever authority. What differs is only the subject bound -- a catalog
 * has no manifest or lock, so the decision binds the engine ID and the catalog
 * revision (AC12b) instead of the two hashes.
 *
 * The revision is passed in by the caller that read it, and the op re-derives
 * and compares it against its own fresh read. That is deliberate: this module
 * must not be the only reader, or an adapter could prevalidate a revision the op
 * never sees -- the same rule D4 states for the manifest/lock hashes.
 */
export async function requestFactorCatalogDeactivationApproval(
  engineId: FactorCatalogId,
  catalogRevision: string,
  factorCount: number,
): Promise<{ engineId: FactorCatalogId; catalogRevision: string; grantedTo: string; decisionId: string } | null> {
  const window = getMainWindow();
  if (!window) return null;

  const subjectHash = createHash('sha256').update(JSON.stringify({
    catalogRevision,
    engineId,
    operation: 'deactivate',
  })).digest('hex');
  const request = {
    requestId: randomUUID(),
    expectedPayloadHash: subjectHash,
    operation: 'factor-catalog.deactivate',
    subjectHash,
    turnAdmissionFingerprint: `electron:${window.webContents.id}`,
    webContentsId: window.webContents.id,
    expiresAt: new Date(Date.now() + NATIVE_AGENT_PERMISSION_TTL_MS).toISOString(),
  };
  const decision = await requestNativeAgentPermission(request, window, {
    title: 'Deactivate a factor catalog',
    message: `Remove the ${engineId} factor catalog from this machine?`,
    // States the count because that is what makes the consent identifiable:
    // "deactivate a catalog" does not tell the user what is being destroyed.
    detail:
      `This deletes ${factorCount} factors sourced from ${engineId}. They are not `
      + 'recoverable from the locked environment -- re-activating the catalog re-seeds '
      + 'the builtin factor set, not anything derived from the removed rows.\n\n'
      + 'Only research runs started afterwards are affected. Anything running right '
      + 'now keeps the factors it already loaded and is not restarted or interrupted.',
    confirmLabel: 'Deactivate',
  });
  if (!decision.approved) return null;

  return {
    engineId,
    catalogRevision,
    grantedTo: `electron:${window.webContents.id}`,
    decisionId: decision.decisionId,
  };
}
