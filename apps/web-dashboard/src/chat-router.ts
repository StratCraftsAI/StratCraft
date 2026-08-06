import { callTool } from './mcp-client.ts'
import type { ChatMessage, GuidedResponse, Visualization } from './types.ts'
import { MCP_STREAMABLE_HTTP_PORT } from './constants.ts'
import i18n from './i18n/index.ts'

// TICKET_1237_4 D8: processUserMessage (free text -> guided) was deleted;
// free-text chat now drives the BYOK agent loop (agent-chat.ts). The
// handlers below serve button-driven guided flows only.

// TICKET_1312: auth_required refresh-retry removed -- guided-agent is now
// purely deterministic (local SQLite), no server auth needed.

// TICKET_1310_1: `client_type` is no longer sent. The surface is resolved
// server-side from the transport that owns the connection (this SPA reaches
// the MCP server over Streamable HTTP, so it is always `web`), which makes
// this path and the agent-loop path agree by construction instead of by two
// independently-maintained literals.
async function callGuidedActionTool(args: Record<string, unknown>): Promise<GuidedResponse | null> {
  return parseGuidedResponse(await callTool('get_guided_action', args))
}

export async function handleGuidedAction(context: string): Promise<ChatMessage> {
  try {
    const guided = await callGuidedActionTool({
      context,
      locale: i18n.language,
    })
    if (guided) {
      return await makeGuidedMessage(guided)
    }
    return makeMessage(i18n.t('chat.unexpectedFormat'))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('fetch') || message.includes('Failed') || message.includes('ECONNREFUSED') || message.includes('NetworkError')) {
      return makeMessage(
        i18n.t('chat.mcpNotConnected', { port: MCP_STREAMABLE_HTTP_PORT }),
      )
    }
    return makeMessage(i18n.t('chat.errorPrefix', { message }))
  }
}

export async function handleGuidedWizardAction(
  wizardId: string,
  stepIndex: number,
  stepData: Record<string, unknown>,
): Promise<ChatMessage> {
  try {
    const guided = await callGuidedActionTool({
      wizard_id: wizardId,
      step_index: stepIndex,
      step_data: stepData,
      locale: i18n.language,
    })
    if (guided) {
      return await makeGuidedMessage(guided)
    }
  } catch {
    // Fallback
  }
  return makeMessage(i18n.t('chat.wizardStepError'))
}

export async function handleGuidedOnboarding(): Promise<ChatMessage> {
  try {
    const guided = await callGuidedActionTool({ locale: i18n.language })
    if (guided) {
      return await makeGuidedMessage(guided)
    }
  } catch {
    // MCP not available — static welcome fallback
  }
  return makeMessage(i18n.t('chat.welcome'))
}

function parseGuidedResponse(result: unknown): GuidedResponse | null {
  if (!result) return null
  if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result)
      if (parsed && typeof parsed === 'object' && 'type' in parsed) return parsed as GuidedResponse
    } catch {
      return null
    }
  }
  if (typeof result === 'object' && 'type' in (result as Record<string, unknown>)) {
    return result as GuidedResponse
  }
  return null
}

async function makeGuidedMessage(guided: GuidedResponse): Promise<ChatMessage> {
  const contentMap: Record<string, string> = {
    choice_card: guided.type === 'choice_card' ? guided.title : '',
    wizard_step: guided.type === 'wizard_step' ? guided.title : '',
    info_panel: guided.type === 'info_panel' ? guided.title : '',
    tool_call: guided.type === 'tool_call' ? guided.explanation : '',
    flow_diagram: guided.type === 'flow_diagram' ? (guided.subtitle || guided.title) : '',
    field_manifest: guided.type === 'field_manifest' ? guided.explanation : '',
  }

  // For tool_call responses, auto-execute the tool and return the result
  if (guided.type === 'tool_call') {
    try {
      const result = await callTool(guided.tool_name, guided.args)
      return makeMessage(guided.explanation, {
        type: Array.isArray(result) ? 'table' : 'json',
        data: result,
        title: guided.tool_name,
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return makeMessage(i18n.t('chat.errorPrefix', { message: errMsg }))
    }
  }

  return makeMessage(contentMap[guided.type] || '', {
    type: guided.type as Visualization['type'],
    guided,
  })
}

function makeMessage(
  content: string,
  visualization?: ChatMessage['visualization'],
  toolCall?: ChatMessage['toolCall'],
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content,
    timestamp: Date.now(),
    visualization,
    toolCall,
  }
}

