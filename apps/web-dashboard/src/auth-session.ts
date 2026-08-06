/**
 * TICKET_1027 (rewrite) + TICKET_1232/TICKET_1233: Web Dashboard User Auth Session
 *
 * Stores user identity from InlineAuth login, NOT BYOK LLM credentials
 * (that is a Settings concern).
 *
 * OAuth tokens are owned by the same-origin MCP/BFF and are never returned to
 * JavaScript. Browser storage contains token-free display state only; the
 * HttpOnly opaque session cookie is the authentication boundary.
 *
 * The Electron URL-fragment handoff consumer (former Mode 1) was deleted per
 * TICKET_1233 D1: it was the deprecated OAuth implicit-flow shape and had no
 * producer anywhere in the tree (TICKET_860: no dead surface). When
 * Electron-to-dashboard handoff is built, it must use an opaque one-time code
 * exchanged via POST, modeled on the BYOK /auth/handoff endpoint.
 */

import i18n from './i18n/index.ts'
import {
  SESSION_EXPIRED_EVENT,
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_INTERNAL_SERVER_ERROR,
} from './constants.ts'

const SESSION_KEY = 'stratcraft_auth'

// Auth requests go through MCP server proxy (same origin) to avoid CORS.
// MCP server forwards login endpoints to AUTH_SERVER_BASE_URL and the refresh
// endpoint to the desktop-api tunnel (see mcp/standalone/src/server.ts).
const AUTH_BASE_URL = ''

export type AuthMode = 'login' | 'local' | 'none'
export type AuthPlan = 'FREE' | 'PRO' | 'GOLD'

export interface AuthUser {
  id: string
  email: string
  name: string
  avatar?: string
  plan: AuthPlan
}

/**
 * Token-free display state persisted in sessionStorage.
 */
export interface AuthSession {
  mode: AuthMode
  user: AuthUser
}

let cached: AuthSession | null = null

function readFromSessionStorage(): AuthSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AuthSession>
    // Legacy token fields are ignored and disappear on the next write.
    if (parsed.mode === 'local') {
      return { mode: 'local', user: parsed.user as AuthUser }
    }
    if (parsed.mode === 'login' && parsed.user?.email) {
      return { mode: 'login', user: parsed.user as AuthUser }
    }
  } catch {
    // corrupt data
  }
  return null
}

function writeToSessionStorage(session: AuthSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function getAuthSession(): AuthSession | null {
  if (cached) return cached
  cached = readFromSessionStorage()
  return cached
}

function setAuthSession(session: AuthSession): void {
  cached = session
  writeToSessionStorage(session)
}

export function clearAuthSession(): void {
  cached = null
  sessionStorage.removeItem(SESSION_KEY)
}

export async function logoutSession(): Promise<void> {
  try {
    await fetch(`${AUTH_BASE_URL}/api/auth/logout`, { method: 'POST' })
  } finally {
    clearAuthSession()
  }
}

/**
 * TICKET_1232 F4: clear the session and notify the UI so it can surface the
 * login form with a localized "session expired" message instead of a raw 401.
 */
export function expireAuthSession(): void {
  clearAuthSession()
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
}

export function isAuthenticated(): boolean {
  const s = getAuthSession()
  return s !== null && s.mode === 'login'
}

export function isLocalOnly(): boolean {
  return getAuthMode() === 'local'
}

export function getAuthMode(): AuthMode {
  return getAuthSession()?.mode ?? 'none'
}

export function enterLocalMode(): void {
  setAuthSession({
    mode: 'local',
    user: { id: '', email: '', name: '', plan: 'FREE' },
  })
}

export function getAuthUser(): AuthUser | null {
  return getAuthSession()?.user ?? null
}

// ---------------------------------------------------------------------------
// Same-origin server session
// ---------------------------------------------------------------------------

/**
 * Browser requests authenticate with the HttpOnly same-origin cookie.
 */
export async function getAuthHeader(): Promise<null> {
  return null
}

interface RefreshResponse {
  success?: boolean
  authenticated?: boolean
  user?: AuthUser
}

let refreshPromise: Promise<boolean> | null = null

/**
 * Refresh the token pair via the MCP same-origin proxy. Single-flight:
 * concurrent callers share one round-trip (same pattern as desktop
 * auth-service TICKET_249).
 *
 * Failure semantics (mirrors desktop TICKET_703):
 *   - 4xx / success:false -> token revoked or invalid: session expired.
 *   - 5xx / network error -> transient: session preserved, caller gets false.
 */
export function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

async function doRefresh(): Promise<boolean> {
  const session = getAuthSession()
  if (!session || session.mode !== 'login') {
    expireAuthSession()
    return false
  }

  let res: Response
  try {
    res = await fetch(`${AUTH_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
  } catch {
    // Network-level failure is transient: keep the session.
    return false
  }

  if (!res.ok) {
    if (res.status >= HTTP_STATUS_BAD_REQUEST && res.status < HTTP_STATUS_INTERNAL_SERVER_ERROR) {
      expireAuthSession()
    }
    return false
  }

  const data = (await res.json().catch(() => null)) as RefreshResponse | null
  if (!data?.success || !data.authenticated || !data.user) {
    // Definitive backend rejection (HTTP 200 + success:false) or malformed body.
    expireAuthSession()
    return false
  }

  setAuthSession({ mode: 'login', user: data.user })
  return true
}

// ---------------------------------------------------------------------------
// Standalone Login (InlineAuth endpoints, via MCP same-origin proxy)
// ---------------------------------------------------------------------------

interface SendCodeResult {
  success: boolean
  message?: string
  error?: string
  retryAfter?: number
}

interface LoginSuccessData {
  success: true
  authenticated: true
  user: AuthUser
}

interface LoginResult {
  success: boolean
  error?: string
  attemptsRemaining?: number
}

export async function sendCode(email: string): Promise<SendCodeResult> {
  try {
    const res = await fetch(`${AUTH_BASE_URL}/api/auth/send-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: string } | null
      return { success: false, error: body?.error || i18n.t('login.authServiceUnavailable') }
    }
    const data = await res.json().catch(() => null)
    if (!data?.success) {
      return { success: false, error: data?.error || i18n.t('login.failedToSendCode'), retryAfter: data?.retry_after }
    }
    return { success: true, message: data.message }
  } catch {
    return { success: false, error: i18n.t('login.authServiceUnavailable') }
  }
}

export async function verifyCode(email: string, code: string): Promise<LoginResult> {
  try {
    const res = await fetch(`${AUTH_BASE_URL}/api/auth/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: string } | null
      return { success: false, error: body?.error || i18n.t('login.authServiceUnavailable') }
    }
    const data = await res.json().catch(() => null)
    if (!data?.success) {
      return { success: false, error: data?.error || i18n.t('login.invalidCode'), attemptsRemaining: data?.attempts_remaining }
    }
    return storeLoginResponse(data as LoginSuccessData)
  } catch {
    return { success: false, error: i18n.t('login.authServiceUnavailable') }
  }
}

export async function loginWithPassword(email: string, password: string): Promise<LoginResult> {
  try {
    const res = await fetch(`${AUTH_BASE_URL}/api/auth/login-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: string } | null
      return { success: false, error: body?.error || i18n.t('login.authServiceUnavailable') }
    }
    const data = await res.json().catch(() => null)
    if (!data?.success) {
      return { success: false, error: data?.error || i18n.t('login.invalidCredentials') }
    }
    return storeLoginResponse(data as LoginSuccessData)
  } catch {
    return { success: false, error: i18n.t('login.authServiceUnavailable') }
  }
}

function storeLoginResponse(data: LoginSuccessData): LoginResult {
  if (!data.authenticated || !data.user?.email) {
    return { success: false, error: i18n.t('login.missingTokenExpiry') }
  }

  setAuthSession({
    mode: 'login',
    user: data.user,
  })
  return { success: true }
}

export async function restoreServerSession(): Promise<boolean> {
  try {
    const response = await fetch(`${AUTH_BASE_URL}/api/auth/session`)
    const data = await response.json() as { authenticated?: boolean; user?: AuthUser }
    if (response.ok && data.authenticated && data.user) {
      setAuthSession({ mode: 'login', user: data.user })
      return true
    }
  } catch {
    // The caller will display the login/local-mode chooser.
  }
  if (getAuthSession()?.mode === 'login') clearAuthSession()
  return false
}
