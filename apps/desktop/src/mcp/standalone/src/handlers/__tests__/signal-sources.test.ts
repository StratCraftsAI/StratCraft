/**
 * Unit tests for signal source handler functions.
 * TICKET_1276 P2 Batch A: Class-S storage read with exactly ONE path (direct
 * SQL). The former Desktop bridge-first branch was deleted, so there is no
 * bridge to mock -- the test exercises the direct-SQL path that is now the sole
 * path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';

import { handleListSignalSources } from '../signal-sources';

function createMockDb(allResult: unknown[] = []): Database.Database {
  return {
    prepare: vi.fn(() => ({
      all: vi.fn(() => allResult),
      get: vi.fn(),
    })),
  } as unknown as Database.Database;
}

describe('handleListSignalSources', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('reads signal sources directly from the normalized SQL tables', async () => {
    const sqlRows = [{ id: 4, name: 'ADX Signal', source_type: 'indicator' }];
    const db = createMockDb(sqlRows);

    const result = await handleListSignalSources(db, { limit: 50 });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(sqlRows);
    expect(db.prepare).toHaveBeenCalled();
  });
});
