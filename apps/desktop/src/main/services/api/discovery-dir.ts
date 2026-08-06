/**
 * TICKET_1334 P0 -- the single owner of the Service API discovery directory.
 *
 * This resolution was previously private to `http-server.ts:255-261`. The
 * runtime-role claim (`runtime-claim.ts`) must live in the SAME directory as
 * `api-port` / `api-token`, because the claim's entire purpose is to decide who
 * may write those files -- a claim resolved from a different root could not
 * guarantee that the claim holder and the discovery-file writer are the same
 * process.
 *
 * WHY EXTRACTED RATHER THAN EXPORTED FROM `http-server.ts`:
 * importing `http-server.ts` pulls in 40+ route modules and, once P1 wires the
 * claim INTO `startApiServer()`, would close an import cycle. Copying the two
 * lines instead was not an option (CLAUDE.md TICKET_854): the resolution is
 * already duplicated in five places in this repo, and a sixth copy that silently
 * drifted would put the claim file in a different directory than the discovery
 * files it guards -- which is a mutex that guards nothing. So the owner is a
 * module both sides import, and `http-server.ts` now delegates to it. This is a
 * pure move: byte-identical resolution, zero behaviour change.
 */

import path from 'node:path';
import { app } from 'electron';

/**
 * Directory holding the Service API discovery files and the runtime claim.
 *
 * Production: `app.getPath('userData')`.
 * Development: `apps/desktop/data` -- the same data dir `DatabaseManager` uses,
 * and the same one the MCP standalone bridge's `discoverServiceApi()` reads.
 */
export function getDiscoveryDir(): string {
  if (app.isPackaged) {
    return app.getPath('userData');
  }
  return path.join(app.getAppPath(), 'data');
}
