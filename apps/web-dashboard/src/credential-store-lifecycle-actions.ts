import { callTool } from './mcp-client.ts'

/** Shared destructive-action adapter used by every Guide recovery surface. */
export function confirmResetUnreadableCredentials(): Promise<unknown> {
  return callTool('reset_unreadable_credentials', { confirm: true })
}
