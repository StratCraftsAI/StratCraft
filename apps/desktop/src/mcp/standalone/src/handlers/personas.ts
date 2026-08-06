/**
 * Persona tool handlers.
 *
 * TICKET_426_2: Persona Constraint System.
 * TICKET_992_7: Direct nona_server connection (no Electron bridge).
 * No SQL fallback -- personas live on backend, not local DB.
 */
import type Database from 'better-sqlite3';
import type { McpToolResult } from './tool-result';
import { resolveNonaServer } from '../nona-server-config';
import * as nonaClient from '../nona-client';
import { describeT } from '../i18n.js';

function redactBearer(message: string, serverBearer: string): string {
  return message.split(serverBearer).join('[REDACTED]');
}

export async function handleListPersonas(
  _db: Database.Database,
  serverBearer?: string,
): Promise<McpToolResult> {
  if (!serverBearer) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: 'This action uses stratcraft.ai server resources. Sign in on the desktop app or web dashboard to continue.',
          reason: 'server_bearer_required',
        }),
      }],
      isError: true,
    };
  }
  const config = { ...resolveNonaServer(), authToken: serverBearer };

  try {
    const response = await nonaClient.listPersonas(config);
    if (response.success && response.data) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response.data, null, 2) }],
      };
    }
    return {
      content: [{ type: 'text' as const, text: describeT('handlers.personas.listFailed', 'Persona list failed: %s').replace('%s', redactBearer(response.error || describeT('handlers.strategies.unknownError', 'Unknown error'), serverBearer)) }],
      isError: true,
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: describeT('handlers.personas.listError', 'Persona list error: %s').replace('%s', redactBearer(error instanceof Error ? error.message : String(error), serverBearer)) }],
      isError: true,
    };
  }
}
