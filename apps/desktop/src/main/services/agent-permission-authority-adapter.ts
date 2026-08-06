import { createHash, randomUUID } from 'crypto';
import { dialog, type BrowserWindow, type MessageBoxOptions } from 'electron';

const TRUSTED_MAIN_DECISION = Symbol('trusted-main-agent-permission-decision');

export interface ElectronAgentPermissionRequest {
  requestId: string;
  expectedPayloadHash: string;
  operation: string;
  subjectHash: string;
  turnAdmissionFingerprint: string;
  webContentsId: number;
  expiresAt: string;
}

export interface TrustedElectronAgentPermissionDecision {
  readonly request: ElectronAgentPermissionRequest;
  readonly approved: boolean;
  readonly bindingHash: string;
  readonly decisionId: string;
  readonly verifiedAt: string;
  readonly [TRUSTED_MAIN_DECISION]: true;
}

export interface NativeAgentPermissionDialog {
  title: string;
  message: string;
  detail: string;
  confirmLabel: string;
}

function bindingHash(request: ElectronAgentPermissionRequest): string {
  return createHash('sha256').update(JSON.stringify({
    requestId: request.requestId,
    expectedPayloadHash: request.expectedPayloadHash,
    operation: request.operation,
    subjectHash: request.subjectHash,
    turnAdmissionFingerprint: request.turnAdmissionFingerprint,
    webContentsId: request.webContentsId,
    expiresAt: request.expiresAt,
  })).digest('hex');
}

/**
 * Electron's authority adapter is Main-only. Renderer input selects no
 * approval value and carries no token; Main observes the native-dialog result
 * and creates this non-serializable branded context for the shared authority.
 */
export async function requestNativeAgentPermission(
  request: ElectronAgentPermissionRequest,
  owner: BrowserWindow,
  prompt: NativeAgentPermissionDialog,
): Promise<TrustedElectronAgentPermissionDecision> {
  if (!Number.isInteger(request.webContentsId) || request.webContentsId <= 0) {
    throw new Error('A live webContents.id is required for native agent permission.');
  }
  if (
    owner.isDestroyed()
    || owner.webContents.isDestroyed()
    || owner.webContents.id !== request.webContentsId
  ) {
    throw new Error('The native agent permission owner is missing, destroyed, or does not match webContents.id.');
  }
  if (Date.parse(request.expiresAt) <= Date.now()) {
    throw new Error('The native agent permission request expired.');
  }
  const options: MessageBoxOptions = {
    type: 'question',
    title: prompt.title,
    message: prompt.message,
    detail: prompt.detail,
    buttons: ['Cancel', prompt.confirmLabel],
    cancelId: 0,
    defaultId: 0,
    noLink: true,
  };
  const { response } = await dialog.showMessageBox(owner, options);
  const approved = response === 1
    && !owner.isDestroyed()
    && !owner.webContents.isDestroyed()
    && owner.webContents.id === request.webContentsId
    && Date.parse(request.expiresAt) > Date.now();
  return Object.freeze({
    request: Object.freeze({ ...request }),
    approved,
    bindingHash: bindingHash(request),
    decisionId: randomUUID(),
    verifiedAt: new Date().toISOString(),
    [TRUSTED_MAIN_DECISION]: true as const,
  });
}

/**
 * TICKET_1303_1_10_1 section 2.6.1: the Electron policy-write path.
 *
 * Electron Main is trusted by construction -- it owns the native dialog, which
 * the model cannot reach -- so it needs no WebAuthn assertion. What it DOES
 * need is the same `policyVersion` CAS as Guide WebUI: without it, a dialog
 * opened before a concurrent Guide write could silently overwrite a
 * security-tightening change with a wider policy (R3 finding P1-9).
 *
 * On drift, Main re-reads the current policy and re-displays the dialog rather
 * than failing: the user is deciding about a state that changed under them, so
 * the correct response is to show them the new state and ask again.
 *
 * The renderer never sends a policy object -- it sends a navigation intent.
 * Every value shown and committed here originates in Main.
 */
export interface ElectronTrustPolicyWriteDeps {
  /** Atomic snapshot from the shared store (never two separate reads). */
  readSnapshot: () => Promise<{ policy: unknown; policyVersion: number }>;
  /** Shared validator -- the SAME one Guide WebUI uses (AC16a). */
  validate: (candidate: unknown) => { ok: true; policy: unknown } | { ok: false; errors: string[] };
  /** CAS commit; rejects with `policy_version_drift` when the version moved. */
  commit: (expectedVersion: number, policy: unknown) => Promise<{ policyVersion: number }>;
  /** Renders the dialog for a given current state; returns the chosen policy or null. */
  prompt: (current: { policy: unknown; policyVersion: number }) => Promise<unknown | null>;
  /** Bound so a pathological drift loop cannot spin forever. */
  maxAttempts?: number;
}

export type ElectronTrustPolicyWriteResult =
  | { outcome: 'committed'; policyVersion: number }
  | { outcome: 'cancelled' }
  | { outcome: 'invalid'; errors: string[] }
  | { outcome: 'drift-exhausted' };

export async function writeTrustPolicyFromMain(
  deps: ElectronTrustPolicyWriteDeps,
): Promise<ElectronTrustPolicyWriteResult> {
  const maxAttempts = deps.maxAttempts ?? 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const current = await deps.readSnapshot();
    const chosen = await deps.prompt(current);
    // Cancel is a decision, not a failure -- it must not fall through to a
    // commit of whatever was last shown.
    if (chosen === null || chosen === undefined) return { outcome: 'cancelled' };

    const validation = deps.validate(chosen);
    if (!validation.ok) return { outcome: 'invalid', errors: validation.errors };

    try {
      const committed = await deps.commit(current.policyVersion, validation.policy);
      return { outcome: 'committed', policyVersion: committed.policyVersion };
    } catch (reason) {
      const code = (reason as { code?: string } | undefined)?.code;
      if (code !== 'policy_version_drift') throw reason;
      // Another surface committed while the dialog was open. Loop: re-read and
      // re-display so the user approves against the state that now exists.
    }
  }
  return { outcome: 'drift-exhausted' };
}

export function isTrustedElectronAgentPermissionDecision(
  value: unknown,
): value is TrustedElectronAgentPermissionDecision {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as Partial<TrustedElectronAgentPermissionDecision>)[TRUSTED_MAIN_DECISION] === true,
  );
}
