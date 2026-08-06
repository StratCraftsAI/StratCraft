import i18n from './i18n/index.ts'

const MCP_ENDPOINT = '/mcp'

let requestId = 0
let sessionId: string | null = null
let initPromise: Promise<void> | null = null

export class McpToolError extends Error {
  constructor(
    message: string,
    readonly errorCode?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'McpToolError'
  }
}

async function rpc(method: string, params?: Record<string, unknown>): Promise<unknown> {
  const isNotification = method.startsWith('notifications/')
  const body: Record<string, unknown> = { jsonrpc: '2.0', method }
  if (!isNotification) body.id = ++requestId
  if (params) body.params = params

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  if (sessionId) headers['Mcp-Session-Id'] = sessionId

  const res = await fetch(MCP_ENDPOINT, {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify(body),
  })

  const sid = res.headers.get('mcp-session-id')
  if (sid) sessionId = sid

  if (!res.ok) {
    const text = await res.text()
    if (res.status === 400 && text.includes('Mcp-Session-Id')) {
      sessionId = null
      initPromise = null
    }
    throw new Error(i18n.t('mcp.requestFailed', { method, status: res.status, detail: text }))
  }

  if (isNotification || res.status === 202 || res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined
  }

  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('text/event-stream')) {
    return parseSSEResponse(res)
  }
  const json = (await res.json()) as { id: number; result?: unknown; error?: { code: number; message: string } }
  if (json.error) throw new Error(i18n.t('mcp.rpcError', { method, message: json.error.message }))
  return json.result
}

async function parseSSEResponse(res: Response): Promise<unknown> {
  const text = await res.text()
  const lines = text.split('\n')
  let lastData: string | undefined
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      lastData = line.slice(6)
    }
  }
  if (!lastData) throw new Error(i18n.t('mcp.emptyResponse'))
  const json = JSON.parse(lastData) as { result?: unknown; error?: { code: number; message: string } }
  if (json.error) throw new Error(i18n.t('mcp.rpcError', { method: 'SSE', message: json.error.message }))
  return json.result
}

async function ensureSession(): Promise<void> {
  if (sessionId) return
  if (!initPromise) {
    initPromise = doInit().catch((err) => {
      initPromise = null
      throw err
    })
  }
  await initPromise
}

async function doInit(): Promise<void> {
  await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'StratCraft Web Dashboard', version: '1.0.0' },
  })
  await rpc('notifications/initialized')
}

export async function callTool(
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  await ensureSession()
  const result = (await rpc('tools/call', { name: toolName, arguments: args })) as {
    content?: Array<{ type: string; text?: string }>
    isError?: boolean
  }
  if (result?.isError) {
    const errText = result.content?.find((c) => c.type === 'text')?.text ?? i18n.t('mcp.toolCallFailed')
    try {
      const payload = JSON.parse(errText) as {
        error?: unknown
        errorCode?: unknown
        code?: unknown
      }
      if (typeof payload.error === 'string') {
        if (
          payload.errorCode === 'WORKLOAD_ADMISSION_REFUSED' &&
          typeof window !== 'undefined'
        ) {
          window.dispatchEvent(new CustomEvent('workload-admission-refused', {
            detail: { refusal: payload, toolName, params: args },
          }))
        }
        throw new McpToolError(
          payload.error,
          typeof payload.errorCode === 'string'
            ? payload.errorCode
            : typeof payload.code === 'string'
              ? payload.code
              : undefined,
          payload,
        )
      }
    } catch (reason) {
      if (reason instanceof McpToolError) throw reason
    }
    throw new McpToolError(errText)
  }
  if (!result?.content?.length) return result
  const textPart = result.content.find((c) => c.type === 'text')
  if (!textPart?.text) return result
  try {
    return JSON.parse(textPart.text)
  } catch {
    return textPart.text
  }
}

export async function getMcpSessionId(): Promise<string> {
  await ensureSession()
  if (!sessionId) throw new Error(i18n.t('mcp.emptyResponse'))
  return sessionId
}

export async function listTools(): Promise<Array<{ name: string; description?: string }>> {
  await ensureSession()
  const result = (await rpc('tools/list')) as { tools: Array<{ name: string; description?: string }> }
  return result.tools
}

export async function checkHealth(): Promise<boolean> {
  try {
    await ensureSession()
    return true
  } catch {
    return false
  }
}

export async function listStrategies() {
  return callTool('list_strategies') as Promise<
    Array<{ id: number; name: string; code: string; type: string }>
  >
}

export async function getStrategy(id: number) {
  return callTool('get_strategy', { strategy_id: id })
}

export async function listFactors() {
  return callTool('list_factors') as Promise<
    Array<{ name: string; category: string; description: string }>
  >
}

export async function listSignalSources() {
  return callTool('list_signal_sources') as Promise<
    Array<{ id: string; name: string; template_id: string }>
  >
}

export async function listBacktestResults() {
  return callTool('list_backtest_results') as Promise<
    Array<{ id: number; strategy_name: string; status: string }>
  >
}
