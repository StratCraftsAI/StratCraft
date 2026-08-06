/**
 * Unit tests for factor handler functions.
 * TICKET_1276 P2 Batch A: Class-S storage read with exactly ONE path (direct
 * SQL). The former Desktop bridge-first branch was deleted, so there is no
 * bridge to mock -- the test exercises the direct-SQL path that is now the sole
 * path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';

import { handleListFactors } from '../factors';

function createMockDb(allResult: unknown[] = []): Database.Database {
  return {
    prepare: vi.fn(() => ({
      all: vi.fn(() => allResult),
      get: vi.fn(),
    })),
  } as unknown as Database.Database;
}

describe('handleListFactors', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('reads factors directly from the nona_factors SQL table', async () => {
    const sqlRows = [{ id: 4, name: 'trend', ic: 0.06, sharpe: 1.5 }];
    const db = createMockDb(sqlRows);

    const result = await handleListFactors(db, { limit: 50 });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(sqlRows);
    expect(db.prepare).toHaveBeenCalled();
  });
});
