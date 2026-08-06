/**
 * TICKET_661_1 AC-6 / AC-8 / AC-10 coverage for the shared execution-admission
 * operation -- the single owner every entry point delegates to.
 */

import { describe, it, expect } from 'vitest';
import { admitStrategyForExecution } from './strategy-execution-admission';

const CPP_STRATEGY = `
#include <stratforge/strategy.hpp>
class MyStrategy final : public stratforge::Strategy {};
QNX_STRATEGY_FACTORY_EXPORT(MyStrategy)
`;

const PYTHON_STRATEGY = `
import backtrader as bt

class MyPyStrategy(bt.Strategy):
    def next(self):
        self.buy()
`;

describe('admitStrategyForExecution', () => {
  it('admits a plain C++ record', () => {
    const result = admitStrategyForExecution({ evidence: { dbCode: CPP_STRATEGY } });
    expect(result.admitted).toBe(true);
  });

  it('refuses a legacy Python record with the regeneration remedy code', () => {
    const result = admitStrategyForExecution({ evidence: { dbCode: PYTHON_STRATEGY } });
    expect(result.admitted).toBe(false);
    if (result.admitted) throw new Error('unreachable');
    expect(result.refusal.code).toBe('legacy_python_strategy');
  });

  it('refuses a Python research artifact with the composition remedy code', () => {
    const result = admitStrategyForExecution({
      evidence: {
        dbCode: PYTHON_STRATEGY,
        classificationMetadata: JSON.stringify({ language: 'python' }),
      },
      researchArtifact: true,
    });
    expect(result.admitted).toBe(false);
    if (result.admitted) throw new Error('unreachable');
    expect(result.refusal.code).toBe('python_research_artifact');
  });

  it('refuses the section 3.1 bypass shape: code-only Python, non-JSON metadata', () => {
    const result = admitStrategyForExecution({
      evidence: {
        dbCode: PYTHON_STRATEGY,
        filePath: null,
        classificationMetadata: 'definitely not json',
      },
    });
    // The traced defect admitted this record and fed it to the C++ wrapper.
    expect(result.admitted).toBe(false);
    if (result.admitted) throw new Error('unreachable');
    expect(result.refusal.code).toBe('legacy_python_strategy');
  });

  it('refuses a record whose evidence contradicts, with the ambiguity code', () => {
    const result = admitStrategyForExecution({
      evidence: {
        filePath: '/s/thing.cpp',
        attachmentCode: PYTHON_STRATEGY,
        attachmentReadable: true,
      },
    });
    expect(result.admitted).toBe(false);
    if (result.admitted) throw new Error('unreachable');
    expect(result.refusal.code).toBe('ambiguous_language');
    expect(result.refusal.classification.conflicts.length).toBeGreaterThan(0);
  });

  it('refuses a record with no source at all with the no-source code', () => {
    const result = admitStrategyForExecution({ evidence: {} });
    expect(result.admitted).toBe(false);
    if (result.admitted) throw new Error('unreachable');
    expect(result.refusal.code).toBe('no_source');
  });

  it('refuses an archived record regardless of language', () => {
    const result = admitStrategyForExecution({
      evidence: { dbCode: CPP_STRATEGY },
      archived: true,
    });
    expect(result.admitted).toBe(false);
    if (result.admitted) throw new Error('unreachable');
    expect(result.refusal.code).toBe('archived_record');
  });

  it('refuses a C++ record whose persisted readiness is blocked', () => {
    const result = admitStrategyForExecution({
      evidence: { dbCode: CPP_STRATEGY },
      executionReadiness: 'blocked',
    });
    expect(result.admitted).toBe(false);
    if (result.admitted) throw new Error('unreachable');
    expect(result.refusal.code).toBe('archived_record');
  });

  it('admits a C++ record with an undefined readiness (pre-migration record)', () => {
    const result = admitStrategyForExecution({
      evidence: { dbCode: CPP_STRATEGY },
      executionReadiness: undefined,
    });
    expect(result.admitted).toBe(true);
  });

  it('admits a C++ record already admitted', () => {
    const result = admitStrategyForExecution({
      evidence: { dbCode: CPP_STRATEGY },
      executionReadiness: 'admitted',
    });
    expect(result.admitted).toBe(true);
  });

  it('carries the full classification on both outcomes for the actionable remedy', () => {
    const admitted = admitStrategyForExecution({ evidence: { dbCode: CPP_STRATEGY } });
    expect(admitted.admitted && admitted.classification.signals.length).toBeGreaterThan(0);

    const refused = admitStrategyForExecution({ evidence: { dbCode: PYTHON_STRATEGY } });
    if (refused.admitted) throw new Error('unreachable');
    expect(refused.refusal.classification.signals.length).toBeGreaterThan(0);
    expect(refused.refusal.detail.length).toBeGreaterThan(0);
  });
});
