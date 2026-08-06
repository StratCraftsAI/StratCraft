/**
 * Unit tests for universe-management MCP tool handlers.
 * TICKET_1235_6: Universe CRUD, symbol membership, nona-universe bridge,
 * and T2 confirm enforcement with sweep guard.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the bridge layer (same package, standard vi.mock)
// ---------------------------------------------------------------------------

const { mockDiscoverServiceApi, mockGetSweepStatus } = vi.hoisted(() => ({
  mockDiscoverServiceApi: vi.fn(),
  mockGetSweepStatus: vi.fn(),
}));

vi.mock('../../bridge/discovery', () => ({
  discoverServiceApi: mockDiscoverServiceApi,
}));

vi.mock('../../bridge/api-client', () => ({
  getSweepStatus: mockGetSweepStatus,
}));

import {
  handleListUniverses,
  handleGetUniverse,
  handleCreateUniverse,
  handleUpdateUniverse,
  handleAddUniverseSymbols,
  handleRemoveUniverseSymbols,
  handleDeleteUniverse,
  handleGetNonaUniverse,
  handlePersistNonaUniverse,
  setServiceFactory,
  type Services,
} from '../universe-management';

// ---------------------------------------------------------------------------
// DI-injected service mocks
// ---------------------------------------------------------------------------

const mockList = vi.fn();
const mockGet = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockAddSymbols = vi.fn();
const mockRemoveSymbols = vi.fn();
const mockNonaGet = vi.fn();
const mockNonaPersist = vi.fn();

const mockServices: Services = {
  universe: {
    list: mockList,
    get: mockGet,
    create: mockCreate,
    update: mockUpdate,
    delete: mockDelete,
    addSymbols: mockAddSymbols,
    removeSymbols: mockRemoveSymbols,
  },
  nonaUniverse: {
    get: mockNonaGet,
    persist: mockNonaPersist,
  },
};

const mockDb = {} as any;

// Inject mock services before all tests, restore after
const origFactory = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  setServiceFactory(() => mockServices);
});
afterAll(() => {
  setServiceFactory(origFactory);
});

// ---------------------------------------------------------------------------
// F1: Read Tools
// ---------------------------------------------------------------------------

describe('handleListUniverses', () => {
  it('returns error when provider is empty', () => {
    const result = handleListUniverses(mockDb, { provider: '' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('provider is required');
  });

  it('returns universe list for valid provider', () => {
    const data = [{ id: 1, name: 'G10 FX', provider: 'yfinance', symbolCount: 10 }];
    mockList.mockReturnValue(data);
    const result = handleListUniverses(mockDb, { provider: 'yfinance' });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(data);
    expect(mockList).toHaveBeenCalledWith('yfinance');
  });
});

describe('handleGetUniverse', () => {
  it('returns error when id is invalid', () => {
    const result = handleGetUniverse(mockDb, { id: -1 });
    expect(result.isError).toBe(true);
  });

  it('returns error when universe not found', () => {
    mockGet.mockReturnValue(null);
    const result = handleGetUniverse(mockDb, { id: 999 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('returns universe detail for valid id (AC2: shape matches start_sweep input)', () => {
    const detail = { id: 1, name: 'G10 FX', provider: 'yfinance', symbols: ['EURUSD', 'GBPUSD'], symbolCount: 2 };
    mockGet.mockReturnValue(detail);
    const result = handleGetUniverse(mockDb, { id: 1 });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(detail);
  });
});

// ---------------------------------------------------------------------------
// F2: Write Tools
// ---------------------------------------------------------------------------

describe('handleCreateUniverse', () => {
  it('returns error when name is empty', () => {
    const result = handleCreateUniverse(mockDb, { name: '', provider: 'yfinance' });
    expect(result.isError).toBe(true);
  });

  it('returns error when provider is empty', () => {
    const result = handleCreateUniverse(mockDb, { name: 'Test', provider: '' });
    expect(result.isError).toBe(true);
  });

  it('creates universe with symbols (filters empty strings)', () => {
    mockCreate.mockReturnValue({ id: 5 });
    const result = handleCreateUniverse(mockDb, {
      name: 'US Tech',
      provider: 'yfinance',
      symbols: ['AAPL', 'MSFT', ''],
    });
    expect(result.isError).toBeUndefined();
    expect(mockCreate).toHaveBeenCalledWith({
      name: 'US Tech',
      provider: 'yfinance',
      symbols: ['AAPL', 'MSFT'],
    });
  });

  it('creates universe without symbols', () => {
    mockCreate.mockReturnValue({ id: 6 });
    const result = handleCreateUniverse(mockDb, { name: 'Empty', provider: 'dukascopy' });
    expect(result.isError).toBeUndefined();
  });
});

describe('handleUpdateUniverse', () => {
  it('returns error when id is invalid', () => {
    const result = handleUpdateUniverse(mockDb, { id: 0 });
    expect(result.isError).toBe(true);
  });

  it('returns error when name is empty string', () => {
    const result = handleUpdateUniverse(mockDb, { id: 1, name: '' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('name must not be empty');
  });

  it('returns error when target_size exceeds pool', () => {
    mockGet.mockReturnValue({ symbolCount: 5 });
    const result = handleUpdateUniverse(mockDb, { id: 1, target_size: 10 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('exceeds candidate pool');
  });

  it('updates name successfully', () => {
    const result = handleUpdateUniverse(mockDb, { id: 1, name: 'Renamed' });
    expect(result.isError).toBeUndefined();
    expect(mockUpdate).toHaveBeenCalledWith({ id: 1, name: 'Renamed', targetSize: undefined });
  });

  it('clears target_size with null', () => {
    const result = handleUpdateUniverse(mockDb, { id: 1, target_size: null });
    expect(result.isError).toBeUndefined();
    expect(mockUpdate).toHaveBeenCalledWith({ id: 1, name: undefined, targetSize: null });
  });
});

describe('handleAddUniverseSymbols', () => {
  it('returns error when universe_id is invalid', () => {
    const result = handleAddUniverseSymbols(mockDb, { universe_id: 0, symbols: ['AAPL'] });
    expect(result.isError).toBe(true);
  });

  it('returns error when symbols is empty after filter', () => {
    const result = handleAddUniverseSymbols(mockDb, { universe_id: 1, symbols: ['', '  '] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('at least one');
  });

  it('adds valid symbols', () => {
    const result = handleAddUniverseSymbols(mockDb, { universe_id: 1, symbols: ['AAPL', 'MSFT'] });
    expect(result.isError).toBeUndefined();
    expect(mockAddSymbols).toHaveBeenCalledWith({ universeId: 1, symbols: ['AAPL', 'MSFT'] });
  });
});

describe('handleRemoveUniverseSymbols', () => {
  it('returns error when symbols is not an array', () => {
    const result = handleRemoveUniverseSymbols(mockDb, { universe_id: 1, symbols: undefined as any });
    expect(result.isError).toBe(true);
  });

  it('removes valid symbols', () => {
    const result = handleRemoveUniverseSymbols(mockDb, { universe_id: 1, symbols: ['AAPL'] });
    expect(result.isError).toBeUndefined();
    expect(mockRemoveSymbols).toHaveBeenCalledWith({ universeId: 1, symbols: ['AAPL'] });
  });
});

// ---------------------------------------------------------------------------
// F3: Delete (T2 confirm + sweep guard)
// ---------------------------------------------------------------------------

describe('handleDeleteUniverse', () => {
  it('returns error when confirm is false -- no delete (AC3 / T2)', async () => {
    const result = await handleDeleteUniverse(mockDb, { id: 1, confirm: false });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('confirm=true');
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('returns error when id is invalid', async () => {
    const result = await handleDeleteUniverse(mockDb, { id: -1, confirm: true });
    expect(result.isError).toBe(true);
  });

  it('refuses when sweep is running -- names session id (AC3)', async () => {
    mockDiscoverServiceApi.mockReturnValue({ baseUrl: 'http://localhost:19876', token: 'tok' });
    mockGetSweepStatus.mockResolvedValue({
      success: true,
      data: { status: 'running', sessionId: 'sweep-abc-123' },
    });

    const result = await handleDeleteUniverse(mockDb, { id: 1, confirm: true });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('sweep is running');
    expect(result.content[0].text).toContain('sweep-abc-123');
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('deletes when sweep is not running', async () => {
    mockDiscoverServiceApi.mockReturnValue({ baseUrl: 'http://localhost:19876', token: 'tok' });
    mockGetSweepStatus.mockResolvedValue({
      success: true,
      data: { status: 'completed', sessionId: 'sweep-old' },
    });

    const result = await handleDeleteUniverse(mockDb, { id: 3, confirm: true });

    expect(result.isError).toBeUndefined();
    expect(mockDelete).toHaveBeenCalledWith(3);
  });

  // TICKET_1276 P2 Batch D (AC5 / TICKET_858): when Electron is absent the
  // sweep-running guard CANNOT be evaluated, so the destructive delete MUST NOT
  // silently proceed unguarded. It returns the explicit electronNotRunning error
  // and does NOT delete. (The former behaviour -- deleting anyway -- was the
  // degraded/unsafe fallback this batch removes.)
  it('refuses the delete with explicit error when Electron is not running -- guard cannot run (AC5)', async () => {
    mockDiscoverServiceApi.mockReturnValue(null);

    const result = await handleDeleteUniverse(mockDb, { id: 2, confirm: true });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not running');
    expect(result.content[0].text).toContain('delete_universe');
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// F4: Nona-universe bridge
// ---------------------------------------------------------------------------

describe('handleGetNonaUniverse', () => {
  it('returns error when id is empty', () => {
    const result = handleGetNonaUniverse(mockDb, { id: '' });
    expect(result.isError).toBe(true);
  });

  it('returns error when not found', () => {
    mockNonaGet.mockReturnValue(null);
    const result = handleGetNonaUniverse(mockDb, { id: 'test-universe' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('returns nona universe row', () => {
    const row = { id: 'test-universe', name: 'Test', marketSleeves: [], symbols: ['AAPL'], createdAt: 1, updatedAt: 2 };
    mockNonaGet.mockReturnValue(row);
    const result = handleGetNonaUniverse(mockDb, { id: 'test-universe' });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(row);
  });
});

describe('handlePersistNonaUniverse', () => {
  it('returns error when id is empty', () => {
    const result = handlePersistNonaUniverse(mockDb, {
      id: '',
      sleeves: [{ providerId: 'yfinance', symbols: ['AAPL'] }],
    });
    expect(result.isError).toBe(true);
  });

  it('returns error when sleeves is empty', () => {
    const result = handlePersistNonaUniverse(mockDb, { id: 'test', sleeves: [] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('at least one sleeve');
  });

  it('persists nona universe', () => {
    const row = { id: 'test', name: 'test', marketSleeves: [], symbols: ['AAPL'], createdAt: 1, updatedAt: 1 };
    mockNonaPersist.mockReturnValue(row);
    const result = handlePersistNonaUniverse(mockDb, {
      id: 'test',
      name: 'My Universe',
      sleeves: [{ providerId: 'yfinance', symbols: ['AAPL'] }],
    });
    expect(result.isError).toBeUndefined();
    expect(mockNonaPersist).toHaveBeenCalledWith({
      id: 'test',
      name: 'My Universe',
      sleeves: [{ providerId: 'yfinance', symbols: ['AAPL'] }],
    });
  });

  it('propagates fail-fast error from NonaUniverseService', () => {
    mockNonaPersist.mockImplementation(() => {
      throw new Error('[TICKET_927_1_2_B] sleeve resolved to zero MarketIds');
    });
    const result = handlePersistNonaUniverse(mockDb, {
      id: 'bad',
      sleeves: [{ providerId: 'invalid', symbols: ['XXX'] }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('zero MarketIds');
  });
});
