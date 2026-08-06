import { beforeEach, describe, expect, it, vi } from 'vitest'

const SESSION_KEY = 'stratcraft_auth'
const storage = new Map<string, string>()
const fetchMock = vi.fn()

Object.defineProperty(globalThis, 'sessionStorage', {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
  configurable: true,
})
Object.defineProperty(globalThis, 'window', {
  value: { dispatchEvent: vi.fn() },
  configurable: true,
})
Object.defineProperty(globalThis, 'fetch', {
  value: fetchMock,
  configurable: true,
  writable: true,
})

async function loadAuth() {
  vi.resetModules()
  return import('../auth-session.ts')
}

const user = {
  id: 'user-1',
  email: 'user@example.com',
  name: 'Test User',
  plan: 'PRO' as const,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  storage.clear()
  fetchMock.mockReset()
})

describe('TICKET_1296 browser BFF auth contract', () => {
  it('stores token-free display state after login', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, authenticated: true, user }))
    const auth = await loadAuth()

    await expect(auth.verifyCode(user.email, '123456')).resolves.toEqual({ success: true })
    const persisted = storage.get(SESSION_KEY) ?? ''
    expect(JSON.parse(persisted)).toEqual({ mode: 'login', user })
    expect(persisted).not.toContain('access_token')
    expect(persisted).not.toContain('refresh_token')
    expect(await auth.getAuthHeader()).toBeNull()
  })

  it('refreshes through the same-origin cookie without sending a token body', async () => {
    storage.set(SESSION_KEY, JSON.stringify({ mode: 'login', user }))
    fetchMock.mockResolvedValue(jsonResponse({ success: true, authenticated: true, user }))
    const auth = await loadAuth()

    await expect(auth.refreshSession()).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
  })

  it('restores a browser session from token-free server status', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ authenticated: true, user }))
    const auth = await loadAuth()

    await expect(auth.restoreServerSession()).resolves.toBe(true)
    expect(auth.getAuthSession()).toEqual({ mode: 'login', user })
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/session')
  })

  it('clears local state and the server session on logout', async () => {
    storage.set(SESSION_KEY, JSON.stringify({ mode: 'login', user }))
    fetchMock.mockResolvedValue(jsonResponse({ success: true }))
    const auth = await loadAuth()

    await auth.logoutSession()
    expect(storage.get(SESSION_KEY)).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' })
  })

  it('keeps a token-free local-only mode', async () => {
    const auth = await loadAuth()
    auth.enterLocalMode()
    expect(auth.isLocalOnly()).toBe(true)
    expect(storage.get(SESSION_KEY)).not.toContain('token')
  })
})
