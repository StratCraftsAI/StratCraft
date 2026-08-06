/**
 * TICKET_1236_7: Shared SSE event-stream client for all Tier B pages.
 *
 * Single EventSource('/mcp/events') connection with subscription
 * multiplexing.  Auto-reconnect with capped exponential backoff.
 * Degraded mode: when the stream is down, subscribers can fall back
 * to polling the underlying status tool -- no silent staleness (TICKET_858).
 */
import { callTool, getMcpSessionId } from './mcp-client.ts'
import {
  SSE_RECONNECT_INITIAL_MS,
  SSE_RECONNECT_MAX_MS,
  SSE_RECONNECT_MULTIPLIER,
  SSE_FALLBACK_POLL_INTERVAL_MS,
} from './constants.ts'

// ── Types ──────────────────────────────────────────────────────────────

export type EventHandler = (data: unknown) => void

interface Subscription {
  eventName: string
  handler: EventHandler
  id: number
}

export interface FallbackConfig {
  toolName: string
  args?: Record<string, unknown>
  intervalMs?: number
}

export interface EventStreamState {
  connected: boolean
  degraded: boolean
}

// ── Singleton state ────────────────────────────────────────────────────

let streamAbort: AbortController | null = null
let subscriptions: Subscription[] = []
let nextSubId = 1
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelay = SSE_RECONNECT_INITIAL_MS
let stateListeners: Array<(state: EventStreamState) => void> = []
let currentState: EventStreamState = { connected: false, degraded: false }

// ── Fallback polling state ─────────────────────────────────────────────

interface FallbackEntry {
  eventName: string
  config: FallbackConfig
  timerId: ReturnType<typeof setInterval> | null
}

let fallbackEntries: FallbackEntry[] = []

function startFallbackPolling(): void {
  for (const entry of fallbackEntries) {
    if (entry.timerId) continue
    const poll = async () => {
      try {
        const result = await callTool(entry.config.toolName, entry.config.args ?? {})
        const handlers = subscriptions.filter((s) => s.eventName === entry.eventName)
        for (const sub of handlers) {
          sub.handler(result)
        }
      } catch {
        // tool unavailable -- will retry next interval
      }
    }
    void poll()
    entry.timerId = setInterval(poll, entry.config.intervalMs ?? SSE_FALLBACK_POLL_INTERVAL_MS)
  }
}

function stopFallbackPolling(): void {
  for (const entry of fallbackEntries) {
    if (entry.timerId) {
      clearInterval(entry.timerId)
      entry.timerId = null
    }
  }
}

// ── State broadcasting ─────────────────────────────────────────────────

function setState(patch: Partial<EventStreamState>): void {
  currentState = { ...currentState, ...patch }
  for (const listener of stateListeners) {
    listener(currentState)
  }
}

// ── Connection management ──────────────────────────────────────────────

async function connect(): Promise<void> {
  if (streamAbort) return
  if (subscriptions.length === 0) return

  const controller = new AbortController()
  streamAbort = controller
  try {
    const sessionId = await getMcpSessionId()
    const response = await fetch('/mcp/events', {
      headers: { 'Mcp-Session-Id': sessionId },
      credentials: 'same-origin',
      signal: controller.signal,
    })
    if (!response.ok || !response.body) throw new Error(`Event stream failed (${response.status})`)
    reconnectDelay = SSE_RECONNECT_INITIAL_MS
    setState({ connected: true, degraded: false })
    stopFallbackPolling()
    await consumeEventStream(response, controller.signal)
    if (!controller.signal.aborted) throw new Error('Event stream closed')
  } catch {
    if (controller.signal.aborted) return
  } finally {
    if (streamAbort === controller) streamAbort = null
    if (!controller.signal.aborted && subscriptions.length > 0) {
      setState({ connected: false, degraded: true })
      startFallbackPolling()
      scheduleReconnect()
    }
  }
}

async function consumeEventStream(response: Response, signal: AbortSignal): Promise<void> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        dispatchFrame(frame)
      }
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      // The response body may already be closed.
    }
  }
}

function dispatchFrame(frame: string): void {
  let eventName = 'message'
  const data: string[] = []
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim()
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (eventName === 'connected') {
    reconnectDelay = SSE_RECONNECT_INITIAL_MS
    setState({ connected: true, degraded: false })
    stopFallbackPolling()
    return
  }
  if (data.length === 0) return
  try {
    const parsed: unknown = JSON.parse(data.join('\n'))
    const handlers = subscriptions.filter((subscription) => subscription.eventName === eventName)
    for (const subscription of handlers) subscription.handler(parsed)
  } catch {
    // Malformed server event: ignore this frame and keep the stream alive.
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void connect()
  }, reconnectDelay)
  reconnectDelay = Math.min(reconnectDelay * SSE_RECONNECT_MULTIPLIER, SSE_RECONNECT_MAX_MS)
}

function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (streamAbort) {
    streamAbort.abort()
    streamAbort = null
  }
  stopFallbackPolling()
  reconnectDelay = SSE_RECONNECT_INITIAL_MS
  setState({ connected: false, degraded: false })
}

// ── Public API ─────────────────────────────────────────────────────────

export function subscribe(eventName: string, handler: EventHandler): () => void {
  const id = nextSubId++
  subscriptions.push({ eventName, handler, id })

  void connect()

  return () => {
    subscriptions = subscriptions.filter((s) => s.id !== id)
    if (subscriptions.length === 0) {
      disconnect()
    }
  }
}

export function registerFallback(eventName: string, config: FallbackConfig): () => void {
  const entry: FallbackEntry = { eventName, config, timerId: null }
  fallbackEntries.push(entry)

  if (currentState.degraded) {
    startFallbackPolling()
  }

  return () => {
    if (entry.timerId) {
      clearInterval(entry.timerId)
      entry.timerId = null
    }
    fallbackEntries = fallbackEntries.filter((e) => e !== entry)
  }
}

export function onStateChange(listener: (state: EventStreamState) => void): () => void {
  stateListeners.push(listener)
  listener(currentState)
  return () => {
    stateListeners = stateListeners.filter((l) => l !== listener)
  }
}

export function getState(): EventStreamState {
  return currentState
}

// ── Test helpers (reset singleton between tests) ───────────────────────

export function _resetForTest(): void {
  disconnect()
  subscriptions = []
  fallbackEntries = []
  stateListeners = []
  nextSubId = 1
  currentState = { connected: false, degraded: false }
}
