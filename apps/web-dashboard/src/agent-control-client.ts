import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import { getMcpSessionId } from './mcp-client.ts'

const CONTROL_ROOT = '/api/control'

export type DecisionTrustPolicyLevel =
  | 'ask-always'
  | 'trust-session'
  | 'auto-approve-allowlist'

export interface DecisionTrustPolicy {
  level: DecisionTrustPolicyLevel
  trustWindowTtlMs: number
  allowlist: string[]
}

export interface DecisionTrustPolicyView {
  policy: DecisionTrustPolicy
  policyVersion: number
  invalidEntries: Array<{ code: string; message: string; operation?: string }>
  eligibleOperations: string[]
}

export interface ControlSession {
  csrf: string
  sessionId: string
  sessionLabel: string
  authenticatorEligible: boolean
  authenticatorAvailable: boolean
  credentialEnrolled: boolean
}

export class GuideControlError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message)
    this.name = 'GuideControlError'
  }
}

let controlSession: ControlSession | null = null
let bootstrapPromise: Promise<ControlSession> | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function parseControlPayload(response: Response): Promise<Record<string, unknown>> {
  const payload: unknown = await response.json().catch(() => null)
  return isRecord(payload) ? payload : {}
}

function errorFromPayload(
  payload: Record<string, unknown>,
  status: number,
  fallbackMessage: string,
): GuideControlError {
  return new GuideControlError(
    typeof payload.code === 'string' ? payload.code : 'control_request_failed',
    typeof payload.error === 'string' ? payload.error : fallbackMessage,
    status,
    isRecord(payload.details) ? payload.details : undefined,
  )
}

export function normalizeGuideControlError(reason: unknown): GuideControlError {
  if (reason instanceof GuideControlError) return reason
  if (reason instanceof DOMException && reason.name === 'NotAllowedError') {
    return new GuideControlError(
      'ceremony_cancelled',
      'Platform authenticator verification was cancelled or timed out.',
    )
  }
  if (reason instanceof DOMException && reason.name === 'SecurityError') {
    return new GuideControlError(
      'authenticator_unavailable',
      'This browser origin cannot use the platform authenticator.',
    )
  }
  return new GuideControlError(
    'permission_verification_failed',
    reason instanceof Error ? reason.message : String(reason),
  )
}

async function requestPlatformAuthentication(
  options: PublicKeyCredentialRequestOptionsJSON,
): Promise<Awaited<ReturnType<typeof startAuthentication>>> {
  try {
    return await startAuthentication({ optionsJSON: options })
  } catch (reason) {
    throw normalizeGuideControlError(reason)
  }
}

async function controlFetch(path: string, body: Record<string, unknown>): Promise<unknown> {
  const session = await ensureControlSession()
  const response = await fetch(`${CONTROL_ROOT}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': session.csrf,
    },
    body: JSON.stringify(body),
  })
  const payload = await parseControlPayload(response)
  if (!response.ok) {
    throw errorFromPayload(payload, response.status, `Control request failed (${response.status})`)
  }
  return payload
}

export async function activateControlSession(): Promise<ControlSession> {
  const challenge = await controlFetch('/session/activate/options', {}) as {
    options: PublicKeyCredentialRequestOptionsJSON
  }
  const assertion = await requestPlatformAuthentication(challenge.options)
  const activation = await controlFetch('/session/activate/verify', { assertion }) as {
    activated?: unknown
  }
  if (activation.activated !== true) {
    throw new GuideControlError(
      'control_response_invalid',
      'The local authority did not acknowledge session activation.',
    )
  }
  if (controlSession) controlSession.authenticatorAvailable = true
  return ensureControlSession()
}

export async function ensureControlSession(): Promise<ControlSession> {
  if (controlSession) return controlSession
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const mcpSessionId = await getMcpSessionId()
      const response = await fetch(`${CONTROL_ROOT}/session`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': mcpSessionId,
        },
        body: '{}',
      })
      const payload = await parseControlPayload(response) as {
        csrf?: unknown
        session_id?: unknown
        session_label?: unknown
        authenticator_eligible?: unknown
        authenticator_available?: unknown
        credential_enrolled?: unknown
        error?: unknown
      }
      if (
        !response.ok
        || typeof payload.csrf !== 'string'
        || typeof payload.session_id !== 'string'
        || typeof payload.session_label !== 'string'
        || typeof payload.authenticator_eligible !== 'boolean'
        || typeof payload.authenticator_available !== 'boolean'
        || typeof payload.credential_enrolled !== 'boolean'
      ) {
        throw errorFromPayload(payload, response.status, 'Local control bootstrap failed')
      }
      controlSession = {
        csrf: payload.csrf,
        sessionId: payload.session_id,
        sessionLabel: payload.session_label,
        authenticatorEligible: payload.authenticator_eligible,
        authenticatorAvailable: payload.authenticator_available,
        credentialEnrolled: payload.credential_enrolled,
      }
      return controlSession
    })().catch((reason) => {
      bootstrapPromise = null
      throw reason
    })
  }
  return bootstrapPromise
}

export async function enrollPlatformAuthenticator(enrollmentCode: string): Promise<void> {
  try {
    const first = await controlFetch('/webauthn/register/options', {
      enrollment_code: enrollmentCode,
    }) as PublicKeyCredentialCreationOptionsJSON | {
      authorizationRequired: true
      options: PublicKeyCredentialRequestOptionsJSON
    }
    const options = 'authorizationRequired' in first
      ? await (async () => {
        const authorizationAssertion = await requestPlatformAuthentication(first.options)
        return controlFetch('/webauthn/register/options', {
          authorization_assertion: authorizationAssertion,
        }) as Promise<PublicKeyCredentialCreationOptionsJSON>
      })()
      : first
    let response
    try {
      response = await startRegistration({ optionsJSON: options })
    } catch (reason) {
      throw normalizeGuideControlError(reason)
    }
    const registration = await controlFetch('/webauthn/register/verify', { response }) as {
      credentialId?: unknown
    }
    if (typeof registration.credentialId !== 'string') {
      throw new GuideControlError(
        'control_response_invalid',
        'The local authority did not acknowledge authenticator registration.',
      )
    }
    if (controlSession) controlSession.credentialEnrolled = true
    await activateControlSession()
  } finally {
    enrollmentCode = ''
  }
}

export async function submitAgentPermissionDecision(
  requestId: string,
  expectedPayloadHash: string,
  approved: boolean,
  onPhase?: (phase: 'bootstrapping-authenticator' | 'awaiting-user-verification' | 'submitting') => void,
): Promise<void> {
  const path = `/agent-permissions/${encodeURIComponent(requestId)}/decision`
  const challenge = await controlFetch(path, {
    expected_payload_hash: expectedPayloadHash,
    approved,
  }) as {
    ceremony?: unknown
    options?: unknown
  }
  let proof: Record<string, unknown>
  if (challenge.ceremony === 'authentication' && isRecord(challenge.options)) {
    onPhase?.('awaiting-user-verification')
    proof = {
      assertion: await requestPlatformAuthentication(
        challenge.options as unknown as PublicKeyCredentialRequestOptionsJSON,
      ),
    }
  } else if (challenge.ceremony === 'registration' && isRecord(challenge.options)) {
    onPhase?.('bootstrapping-authenticator')
    let registrationResponse
    try {
      registrationResponse = await startRegistration({
        optionsJSON: challenge.options as unknown as PublicKeyCredentialCreationOptionsJSON,
      })
    } catch (reason) {
      throw normalizeGuideControlError(reason)
    }
    proof = { registration_response: registrationResponse }
  } else {
    throw new GuideControlError(
      'control_response_invalid',
      'The local authority returned no valid permission ceremony.',
    )
  }
  onPhase?.('submitting')
  const result = await controlFetch(path, {
    expected_payload_hash: expectedPayloadHash,
    approved,
    ...proof,
  }) as { delivered?: unknown }
  if (result.delivered !== true) {
    throw new GuideControlError(
      'control_response_invalid',
      'The local authority did not acknowledge the permission decision.',
    )
  }
  if (challenge.ceremony === 'registration' && controlSession) {
    controlSession.credentialEnrolled = true
    controlSession.authenticatorAvailable = true
  }
}

export async function getDecisionTrustPolicy(): Promise<DecisionTrustPolicyView> {
  const response = await fetch(`${CONTROL_ROOT}/settings/trust-policy`, {
    method: 'GET',
    credentials: 'same-origin',
  })
  const payload = await parseControlPayload(response) as {
    policy?: DecisionTrustPolicy
    policy_version?: unknown
    invalid_entries?: DecisionTrustPolicyView['invalidEntries']
    eligible_operations?: unknown
    error?: unknown
  }
  if (
    !response.ok
    || !payload.policy
    || typeof payload.policy_version !== 'number'
    || !Array.isArray(payload.eligible_operations)
  ) {
    throw errorFromPayload(payload, response.status, `Trust policy read failed (${response.status})`)
  }
  return {
    policy: payload.policy,
    policyVersion: payload.policy_version,
    invalidEntries: Array.isArray(payload.invalid_entries)
      ? payload.invalid_entries
      : [],
    eligibleOperations: payload.eligible_operations.filter(
      (operation): operation is string => typeof operation === 'string',
    ),
  }
}

/**
 * Guide policy writes use a dedicated WebAuthn ceremony. The first request
 * binds the canonical policy to a server-side challenge; the second carries
 * only the resulting assertion. The browser never receives the nonce or any
 * credential record.
 */
export async function writeDecisionTrustPolicy(
  policy: DecisionTrustPolicy,
): Promise<number> {
  const challenge = await controlFetch('/settings/trust-policy', {
    policy,
  }) as { options: PublicKeyCredentialRequestOptionsJSON }
  const assertion = await startAuthentication({ optionsJSON: challenge.options })
  const committed = await controlFetch('/settings/trust-policy', {
    assertion,
  }) as { policyVersion?: unknown }
  if (typeof committed.policyVersion !== 'number') {
    throw new Error('The trust policy write returned no policy version')
  }
  return committed.policyVersion
}

export function resetControlSessionForTests(): void {
  controlSession = null
  bootstrapPromise = null
}
