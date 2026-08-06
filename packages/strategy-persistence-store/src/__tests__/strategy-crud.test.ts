import { describe, expect, it, vi } from 'vitest';
import {
  buildStrategyClassification,
  generateSignalSource,
  getStrategy,
  listStrategies,
  MissingPipelineDependencyError,
  persistStrategy,
  resolveLocalStrategyName,
  softDeleteStrategy,
  SoftDeleteStrategyError,
  type PersistStrategyDeps,
  type SqliteDatabase,
} from '../index';

/**
 * SQL-routing fake driver: each `prepare(sql)` is matched (first match wins)
 * against a list of `{ match, get, all, run }` handlers so multi-statement
 * functions (e.g. the id-mode soft-delete: SELECT then UPDATE) can return
 * different results per statement. Captures the prepared SQL and bound params.
 */
interface StmtSpec {
  match: RegExp;
  get?: (...p: unknown[]) => unknown;
  all?: (...p: unknown[]) => unknown[];
  run?: (...p: unknown[]) => { changes: number };
}

function routingDb(specs: StmtSpec[]) {
  const prepared: Array<{ sql: string; params: unknown[]; kind: string }> = [];
  const db = {
    prepare: vi.fn((sql: string) => {
      const spec = specs.find((s) => s.match.test(sql));
      if (!spec) throw new Error(`No stmt spec matched SQL:\n${sql}`);
      return {
        get: (...params: unknown[]) => {
          prepared.push({ sql, params, kind: 'get' });
          return spec.get ? spec.get(...params) : undefined;
        },
        all: (...params: unknown[]) => {
          prepared.push({ sql, params, kind: 'all' });
          return spec.all ? spec.all(...params) : [];
        },
        run: (...params: unknown[]) => {
          prepared.push({ sql, params, kind: 'run' });
          return spec.run ? spec.run(...params) : { changes: 1 };
        },
      };
    }),
  } as unknown as SqliteDatabase;
  return { db, prepared };
}

describe('listStrategies (D4)', () => {
  it('lists live rows with the default filter and limit binding', () => {
    const rows = [{ id: 1 }];
    const { db, prepared } = routingDb([{ match: /FROM nona_algorithms/, all: () => rows }]);

    expect(listStrategies(db, { limit: 25 })).toEqual(rows);
    const call = prepared[0];
    expect(call.sql).toContain('deleted_at IS NULL');
    expect(call.sql).toContain("json_extract(classification_metadata, '$.signal_source')");
    expect(call.params).toEqual([25]);
  });

  it('pushes strategy_type + signal_source_prefix filters before the limit', () => {
    const { db, prepared } = routingDb([{ match: /FROM nona_algorithms/, all: () => [] }]);

    listStrategies(db, { limit: 10, strategyType: 9, signalSourcePrefix: 'indicator_detector' });

    expect(prepared[0].sql).toContain('strategy_type = ?');
    expect(prepared[0].sql).toContain('LIKE ?');
    // order: strategy_type, signal_source_prefix, limit
    expect(prepared[0].params).toEqual([9, 'indicator_detector', 10]);
  });
});

describe('getStrategy (D4)', () => {
  it('reads via v_algorithms_all and returns the row', () => {
    const row = { id: 5, strategy_name: 's' };
    const { db, prepared } = routingDb([{ match: /FROM v_algorithms_all/, get: () => row }]);

    expect(getStrategy(db, 5)).toEqual(row);
    expect(prepared[0].sql).toContain('FROM v_algorithms_all');
    expect(prepared[0].params).toEqual([5]);
  });

  it('returns null when the id is unknown/soft-deleted', () => {
    const { db } = routingDb([{ match: /FROM v_algorithms_all/, get: () => undefined }]);
    expect(getStrategy(db, 5)).toBeNull();
  });
});

describe('softDeleteStrategy (D5)', () => {
  it('single-id: SELECTs then UPDATEs and returns the deleted id', () => {
    const { db, prepared } = routingDb([
      { match: /SELECT id, strategy_name, is_system/, get: () => ({ id: 3, strategy_name: 'x', is_system: 0, deleted_at: null }) },
      { match: /UPDATE nona_algorithms/, run: () => ({ changes: 1 }) },
    ]);

    expect(softDeleteStrategy(db, { mode: 'id', id: 3 })).toEqual({ deletedCount: 1, deletedIds: [3] });
    expect(prepared[0].kind).toBe('get');
    expect(prepared[1].sql).toContain("SET deleted_at = datetime('now')");
    expect(prepared[1].sql).toContain('is_system = 0');
  });

  it('single-id: throws not_found', () => {
    const { db } = routingDb([{ match: /SELECT id, strategy_name, is_system/, get: () => undefined }]);
    expect(() => softDeleteStrategy(db, { mode: 'id', id: 3 })).toThrow(SoftDeleteStrategyError);
    try { softDeleteStrategy(db, { mode: 'id', id: 3 }); } catch (e) {
      expect((e as SoftDeleteStrategyError).reason).toBe('not_found');
    }
  });

  it('single-id: throws already_deleted', () => {
    const { db } = routingDb([{ match: /SELECT id, strategy_name, is_system/, get: () => ({ id: 3, strategy_name: 'x', is_system: 0, deleted_at: '2026-01-01' }) }]);
    try { softDeleteStrategy(db, { mode: 'id', id: 3 }); expect.fail('should throw'); } catch (e) {
      expect((e as SoftDeleteStrategyError).reason).toBe('already_deleted');
    }
  });

  it('single-id: throws system_protected', () => {
    const { db } = routingDb([{ match: /SELECT id, strategy_name, is_system/, get: () => ({ id: 3, strategy_name: 'x', is_system: 1, deleted_at: null }) }]);
    try { softDeleteStrategy(db, { mode: 'id', id: 3 }); expect.fail('should throw'); } catch (e) {
      expect((e as SoftDeleteStrategyError).reason).toBe('system_protected');
    }
  });

  it('filter: uses RETURNING and reports the authoritative deleted ids', () => {
    const { db, prepared } = routingDb([
      { match: /UPDATE nona_algorithms[\s\S]*RETURNING id/, all: () => [{ id: 7 }, { id: 8 }] },
    ]);

    expect(softDeleteStrategy(db, { mode: 'filter', strategyType: 9 })).toEqual({ deletedCount: 2, deletedIds: [7, 8] });
    expect(prepared[0].sql).toContain('RETURNING id');
    expect(prepared[0].params).toEqual([9]);
  });

  it('filter: binds both strategy_type and signal_source_prefix', () => {
    const { db, prepared } = routingDb([
      { match: /UPDATE nona_algorithms[\s\S]*RETURNING id/, all: () => [] },
    ]);

    softDeleteStrategy(db, { mode: 'filter', strategyType: 3, signalSourcePrefix: 'risk_override' });
    expect(prepared[0].params).toEqual([3, 'risk_override']);
  });
});

describe('resolveLocalStrategyName', () => {
  it('returns the requested name when it is free', () => {
    const { db } = routingDb([{ match: /SELECT 1/, get: () => undefined }]);
    expect(resolveLocalStrategyName(db, 'alpha')).toBe('alpha');
  });

  it('suffixes _v2, _v3 until a free name is found', () => {
    let calls = 0;
    // 'alpha' taken, 'alpha_v2' taken, 'alpha_v3' free
    const { db } = routingDb([{ match: /SELECT 1/, get: (name: unknown) => {
      calls += 1;
      return name === 'alpha' || name === 'alpha_v2' ? 1 : undefined;
    } }]);
    expect(resolveLocalStrategyName(db, 'alpha')).toBe('alpha_v3');
    expect(calls).toBeGreaterThanOrEqual(3);
  });
});

describe('buildStrategyClassification + generateSignalSource (D6)', () => {
  it('maps standard and bespoke regimes to signal_source', () => {
    expect(generateSignalSource('trend')).toBe('indicator_detector_trend');
    expect(generateSignalSource('TREND_DETECTION')).toBe('indicator_detector_trend');
    expect(generateSignalSource('bespoke_momentum')).toBe('indicator_detector_bespoke_momentum');
  });

  it('assembles the authoritative metadata + rules shape deterministically', () => {
    const { classificationMetadata: m, strategyRules: r } = buildStrategyClassification({
      className: 'TrendDetector',
      regimeType: 'trend',
      llmProvider: 'openai',
      llmModel: 'gpt',
      rules: [{ type: 'rsi' }, { name: 'macd' }, {}],
      persona: 'p1',
      preference: 'pref',
      tradingStyle: 'aggressive',
      createdAt: '2026-07-27T00:00:00.000Z',
    });
    expect(m.class_name).toBe('TrendDetector');
    expect(m.signal_source).toBe('indicator_detector_trend');
    expect(m.strategy_role).toBe('market_regime');
    expect(m.created_at).toBe('2026-07-27T00:00:00.000Z');
    expect(m.persona).toBe('p1');
    expect(m.preference).toBe('pref');
    expect((m.feature_fingerprint as any).indicator_combo).toEqual(['macd', 'rsi']); // sorted, empties dropped
    expect((m.feature_fingerprint as any).trading_style).toBe('aggressive');
    expect(r.strategy_type).toBe('Market Regime Detection');
    expect((r.detection_config as any).llm_model).toBe('gpt');
    expect(r.rules).toHaveLength(3);
  });

  it('omits optional persona/preference/trading_style/llm_model when unset', () => {
    const { classificationMetadata: m, strategyRules: r } = buildStrategyClassification({
      className: 'C',
      regimeType: 'range',
      llmProvider: 'anthropic',
      createdAt: '2026-07-27T00:00:00.000Z',
    });
    expect(m.persona).toBeUndefined();
    expect(m.preference).toBeUndefined();
    expect((m.feature_fingerprint as any).trading_style).toBeUndefined();
    expect((m.feature_fingerprint as any).persona).toBeNull();
    expect((r.detection_config as any).llm_model).toBeUndefined();
    expect(r.rules).toEqual([]);
  });
});

describe('persistStrategy (D6 orchestration)', () => {
  const baseInput = {
    insertData: {
      code: 'class S{};',
      strategy_name: 's',
      strategy_type: 9,
      classification_metadata: '{}',
      strategy_rules: '{}',
      user_id: 'local',
    },
    language: 'cpp' as const,
    signalSource: 'indicator_detector_trend',
    llmProvider: 'openai',
    llmModel: 'gpt',
    regime: 'trend',
  };

  function deps(overrides: Partial<PersistStrategyDeps> = {}): PersistStrategyDeps {
    return {
      validateBeforeInsert: vi.fn(async (code: string) => ({ code })),
      insertRow: vi.fn(async () => ({ id: 42, strategyName: 's' })),
      triggerPostInsertPipeline: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it('validates -> inserts -> fires the pipeline in order, returning the id/name/code', async () => {
    const order: string[] = [];
    const d = deps({
      validateBeforeInsert: vi.fn(async (code: string) => { order.push('validate'); return { code: code + '//fixed' }; }),
      insertRow: vi.fn(async (data) => { order.push('insert'); expect(data.code).toBe('class S{};//fixed'); return { id: 42, strategyName: 's_v2' }; }),
      triggerPostInsertPipeline: vi.fn(async (input) => { order.push('pipeline'); expect(input.code).toBe('class S{};//fixed'); expect(input.strategyName).toBe('s_v2'); }),
    });

    const result = await persistStrategy(baseInput, d);
    expect(order).toEqual(['validate', 'insert', 'pipeline']);
    expect(result).toEqual({ algorithmId: 42, strategyName: 's_v2', code: 'class S{};//fixed' });
  });

  it('defaults parentKind to algorithm and threads backendValidationReport', async () => {
    const trigger = vi.fn(async () => {});
    await persistStrategy({ ...baseInput, backendValidationReport: { ok: true } }, deps({ triggerPostInsertPipeline: trigger }));
    expect(trigger).toHaveBeenCalledWith(expect.objectContaining({ parentKind: 'algorithm', backendValidationReport: { ok: true } }));
  });

  it('throws MissingPipelineDependencyError before insert when deps are absent (AC6)', async () => {
    const insertRow = vi.fn();
    await expect(persistStrategy(baseInput, undefined)).rejects.toBeInstanceOf(MissingPipelineDependencyError);
    await expect(persistStrategy(baseInput, { insertRow, triggerPostInsertPipeline: vi.fn() } as any))
      .rejects.toMatchObject({ dependency: 'validateBeforeInsert' });
    await expect(persistStrategy(baseInput, { validateBeforeInsert: vi.fn(), triggerPostInsertPipeline: vi.fn() } as any))
      .rejects.toMatchObject({ dependency: 'insertRow' });
    await expect(persistStrategy(baseInput, { validateBeforeInsert: vi.fn(), insertRow } as any))
      .rejects.toMatchObject({ dependency: 'triggerPostInsertPipeline' });
    expect(insertRow).not.toHaveBeenCalled();
  });

  it('rejects empty code before touching the deps', async () => {
    const d = deps();
    await expect(persistStrategy({ ...baseInput, insertData: { ...baseInput.insertData, code: '   ' } }, d))
      .rejects.toThrow('without strategy code');
    expect(d.insertRow).not.toHaveBeenCalled();
  });
});
