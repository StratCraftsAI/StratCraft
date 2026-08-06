import type { ActionModule, ActionResult } from '../../types';
import { HeadlessBootstrap } from '../../bootstrap';
import { listStrategies } from '@StratCraft/strategy-persistence-store';

/**
 * Headless action: strategy-builder/list-strategies
 *
 * TICKET_1235_1 F3 / TICKET_1306_4 D4: this surface delegates directly to the
 * shared persistence owner. Importing the mixed MCP transport handler pulled
 * the entire commercial handler graph into the otherwise-public action.
 */
const mod: ActionModule = {
  name: 'strategy-builder/list-strategies',
  description: 'List saved strategy/algorithm groups from the nona_algorithms table',

  async run(args): Promise<ActionResult> {
    const t0 = performance.now();
    await HeadlessBootstrap.init();

    const { getDatabaseManager } = await import('../../../main/database/db-manager');
    const db = getDatabaseManager().getDb();

    const limit = typeof args.limit === 'number' ? args.limit : 50;

    const rows = listStrategies(db, { limit });

    return {
      name: mod.name,
      ok: true,
      summary: `${rows.length} strategies returned`,
      details: {
        rows,
        rowCount: rows.length,
        filters: { limit },
      },
      durationMs: Math.round(performance.now() - t0),
    };
  },
};

export default mod;
