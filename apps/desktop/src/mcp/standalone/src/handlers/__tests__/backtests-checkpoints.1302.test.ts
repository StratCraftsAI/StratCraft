import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  exists: true,
  rows: [] as unknown[],
  row: undefined as unknown,
  deleteChanges: 1,
  throwOnOpen: false,
  closed: 0,
}));

vi.mock('fs', () => ({
  default: { existsSync: () => state.exists },
}));

vi.mock('../../db', () => ({
  resolveDbPath: () => '/data/StratCraft.db',
}));

vi.mock('better-sqlite3', () => ({
  default: class MockDatabase {
    constructor() {
      if (state.throwOnOpen) throw new Error('checkpoint open failed');
    }
    prepare(sql: string) {
      return {
        all: () => state.rows,
        get: () => sql.includes('sqlite_master') ? undefined : state.row,
        run: () => ({ changes: state.deleteChanges }),
      };
    }
    close() {
      state.closed += 1;
    }
  },
}));

vi.mock('../../bridge/discovery', () => ({ discoverServiceApi: () => null }));
vi.mock('../../bridge/api-client', () => ({}));

import {
  handleDeleteCheckpoint,
  handleGetCheckpoint,
  handleListCheckpoints,
} from '../backtests';

describe('TICKET_1302 checkpoint MCP handlers', () => {
  beforeEach(() => {
    state.exists = true;
    state.rows = [];
    state.row = undefined;
    state.deleteChanges = 1;
    state.throwOnOpen = false;
    state.closed = 0;
  });

  it('returns an empty list without creating a missing checkpoint store', async () => {
    state.exists = false;
    const result = await handleListCheckpoints({} as never);
    expect(JSON.parse(result.content[0].text)).toEqual([]);
    expect(state.closed).toBe(0);
  });

  it('lists and gets checkpoints while always closing the store', async () => {
    state.rows = [{ task_id: 't', bar_index: 4, created_at: 'now' }];
    const listed = await handleListCheckpoints({} as never);
    expect(JSON.parse(listed.content[0].text)).toEqual(state.rows);

    state.row = {
      task_id: 't',
      bar_index: 4,
      created_at: 'now',
      checkpoint_data: JSON.stringify({ data_info: { total_bars: 8 } }),
    };
    const got = await handleGetCheckpoint({} as never, { task_id: 't' });
    expect(JSON.parse(got.content[0].text)).toEqual(expect.objectContaining({
      taskId: 't',
      progressPercent: 50,
    }));
    expect(state.closed).toBe(2);
  });

  it('enforces confirmation and reports open/not-found errors', async () => {
    expect((await handleDeleteCheckpoint({} as never, {
      task_id: 't',
      confirm: false,
    })).isError).toBe(true);

    state.deleteChanges = 0;
    expect((await handleDeleteCheckpoint({} as never, {
      task_id: 'missing',
      confirm: true,
    })).content[0].text).toContain('not found');

    state.throwOnOpen = true;
    expect((await handleListCheckpoints({} as never)).content[0].text)
      .toContain('checkpoint open failed');
  });
});
