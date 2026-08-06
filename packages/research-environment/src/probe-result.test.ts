/**
 * TICKET_1335 L4 tests: probe-output interpretation.
 *
 * The payload used by the "real output" test below is the verbatim stdout of the
 * probe program run against the live locked environment on 2026-07-30, not a
 * hand-written approximation. That matters because two of the assertions here
 * encode facts that were only discovered by running it:
 *
 *   - `pandas_ta` exposes no `__version__`, so versions must come from
 *     distribution metadata or `ready` is structurally unreachable;
 *   - PySR reports its Julia backend separately, and a Python-layer error must
 *     not be attributed to `julia_verify`.
 */

import { describe, expect, it } from 'vitest';

import {
  RESEARCH_CAPABILITIES,
  researchEnvironmentStatusSchema,
  type ResearchCapability,
} from '@StratCraft/types';

import { PROBE_RESULT_BEGIN, PROBE_RESULT_END } from './probe-program';
import {
  RESEARCH_ENV_PROBE_ERROR_CODES,
  ResearchEnvironmentProbeError,
  parseProbeOutput,
  projectProbeResults,
  stageForProbeCause,
  uniformCapabilities,
} from './probe-result';

const EXPECTED_VERSIONS: Record<ResearchCapability, string> = {
  histdata: '0.1.0',
  duckdb: '1.5.3',
  gplearn: '0.4.3',
  gpquant: '0.1.6',
  pysr: '1.5.10',
  pandas_ta: '0.4.71b0',
};

/** Representative stdout captured from the locked interpreter after AC24. */
const LIVE_PROBE_STDOUT = `
${PROBE_RESULT_BEGIN}
{"interpreter": "/workspace/StratCraft/.pixi/envs/default/bin/python", "pythonVersion": "3.12.13", "capabilities": {"histdata": {"ok": true, "version": "0.1.0", "verification": "Offline fixture parsed and converted to two canonical OHLCV rows with timestamp[ms]; temporary output removed."}, "duckdb": {"ok": true, "version": "1.5.3", "verification": "In-memory query returned 42; numpy 2.2.6 and pyarrow 18.1.0 imported."}, "gplearn": {"ok": true, "version": "0.4.3", "verification": "Deterministic fit/predict correlation 1.0000; scikit-learn 1.8.0, scipy 1.14.1."}, "gpquant": {"ok": true, "version": "0.1.6", "verification": "Imported and constructed SymbolicRegressor with the repository's argument shape."}, "pysr": {"ok": true, "version": "1.5.10", "verification": "Julia backend initialized; bounded regression correlation 1.0000.", "backend_ok": true}, "pandas_ta": {"ok": true, "version": "0.4.71b0", "verification": "Accessor '.ta.rsi(14)' returned 139 finite values against pandas 2.3.3."}}}
${PROBE_RESULT_END}
`;

function wrap(payload: unknown): string {
  return `noise\n${PROBE_RESULT_BEGIN}\n${JSON.stringify(payload)}\n${PROBE_RESULT_END}\ntrailing\n`;
}

function allOk(): Record<string, unknown> {
  return Object.fromEntries(
    RESEARCH_CAPABILITIES.map(capability => [
      capability,
      { ok: true, version: EXPECTED_VERSIONS[capability], verification: 'ok' },
    ]),
  );
}

describe('parseProbeOutput', () => {
  it('parses the verbatim output of the live locked interpreter', () => {
    const parsed = parseProbeOutput(LIVE_PROBE_STDOUT);
    expect(parsed.pythonVersion).toBe('3.12.13');
    expect(parsed.capabilities.histdata.version).toBe('0.1.0');
    expect(parsed.capabilities.pandas_ta.version).toBe('0.4.71b0');
    expect(parsed.capabilities.pysr.backend_ok).toBe(true);
  });

  it('ignores surrounding output rather than requiring exclusive stdout', () => {
    // The probe cannot guarantee a clean stdout: Julia prints precompilation
    // notices and pandas_ta emits warnings. JSON.parse(stdout) would fail on the
    // first such line and report a healthy environment as unverifiable.
    const noisy = `[juliapkg] precompiling SymbolicRegression\n${wrap({
      interpreter: '/i', pythonVersion: '3.12.13', capabilities: allOk(),
    })}\nFutureWarning: something\n`;
    expect(parseProbeOutput(noisy).capabilities.duckdb.ok).toBe(true);
  });

  it('reports NO_PAYLOAD when the verifier never emitted a result', () => {
    try {
      parseProbeOutput('Traceback (most recent call last): ImportError\n');
      throw new Error('expected a probe error');
    } catch (error) {
      expect((error as ResearchEnvironmentProbeError).code)
        .toBe(RESEARCH_ENV_PROBE_ERROR_CODES.NO_PAYLOAD);
    }
  });

  it('reports MALFORMED_PAYLOAD for undecodable JSON', () => {
    const broken = `${PROBE_RESULT_BEGIN}\n{not json\n${PROBE_RESULT_END}`;
    try {
      parseProbeOutput(broken);
      throw new Error('expected a probe error');
    } catch (error) {
      expect((error as ResearchEnvironmentProbeError).code)
        .toBe(RESEARCH_ENV_PROBE_ERROR_CODES.MALFORMED_PAYLOAD);
    }
  });

  // TICKET_1335 AC13: a probe that emits well-formed JSON of the WRONG SHAPE is
  // a distinct hazard from undecodable JSON. Both must refuse rather than let a
  // structurally empty result be read as "nothing failed".
  it.each([
    ['a JSON scalar instead of an object', 42],
    ['a JSON null', null],
    ['an object with no capabilities key', { interpreter: '/i' }],
    ['a non-object capabilities value', { capabilities: 'all good' }],
    ['a null capabilities value', { capabilities: null }],
  ])('reports MALFORMED_PAYLOAD for %s', (_label, payload) => {
    try {
      parseProbeOutput(wrap(payload));
      throw new Error('expected a probe error');
    } catch (error) {
      expect((error as ResearchEnvironmentProbeError).code)
        .toBe(RESEARCH_ENV_PROBE_ERROR_CODES.MALFORMED_PAYLOAD);
    }
  });

  it('defaults a non-string interpreter and pythonVersion rather than throwing', () => {
    // These are diagnostic strings, not readiness evidence. A probe that reported
    // them oddly must not fail an otherwise complete capability set.
    const parsed = parseProbeOutput(wrap({
      interpreter: 7,
      pythonVersion: null,
      capabilities: allOk(),
    }));
    expect(parsed.interpreter).toBe('');
    expect(parsed.pythonVersion).toBe('');
  });

  it('rejects a payload that omits a capability instead of defaulting it', () => {
    // Silently defaulting an omitted capability would let a truncated probe
    // certify an environment.
    const capabilities = allOk();
    delete capabilities.gpquant;
    try {
      parseProbeOutput(wrap({ interpreter: '/i', pythonVersion: '3.12.13', capabilities }));
      throw new Error('expected a probe error');
    } catch (error) {
      expect((error as Error).message).toContain('gpquant');
    }
  });

  it('rejects a capability entry whose ok field is not boolean', () => {
    const capabilities = allOk();
    capabilities.duckdb = { ok: 'yes', version: '1.5.3' };
    expect(() => parseProbeOutput(wrap({
      interpreter: '/i', pythonVersion: '3.12.13', capabilities,
    }))).toThrow(ResearchEnvironmentProbeError);
  });

  it('drops an unrecognized cause rather than passing it through', () => {
    const capabilities = allOk();
    capabilities.pysr = { ok: false, cause: 'meltdown', message: 'x' };
    const parsed = parseProbeOutput(wrap({
      interpreter: '/i', pythonVersion: '3.12.13', capabilities,
    }));
    expect(parsed.capabilities.pysr.cause).toBeUndefined();
  });

  it('takes the last payload when stdout contains more than one', () => {
    const first = wrap({ interpreter: '/old', pythonVersion: '3.11.0', capabilities: allOk() });
    const second = wrap({ interpreter: '/new', pythonVersion: '3.12.13', capabilities: allOk() });
    expect(parseProbeOutput(first + second).interpreter).toBe('/new');
  });
});

describe('stageForProbeCause', () => {
  it('routes only backend_init to julia_verify', () => {
    // AC8 depends on this separation being real: PySR must not be able to show
    // Ready when backend initialization failed, and the two stages must be
    // distinguishable in the failure.
    expect(stageForProbeCause('backend_init')).toBe('julia_verify');
    expect(stageForProbeCause('import')).toBe('python_verify');
    expect(stageForProbeCause('probe')).toBe('python_verify');
  });
});

describe('projectProbeResults', () => {
  it('attributes a HistData converter failure specifically to histdata', () => {
    const capabilities = allOk();
    capabilities.histdata = {
      ok: false,
      cause: 'probe',
      version: '0.1.0',
      message: 'Parquet conversion failed',
    };
    const projection = projectProbeResults({
      parsed: parseProbeOutput(wrap({
        interpreter: '/i', pythonVersion: '3.12.13', capabilities,
      })),
      expectedVersions: EXPECTED_VERSIONS,
    });
    expect(projection.capabilities.histdata).toMatchObject({
      state: 'failed', expected: '0.1.0', installed: '0.1.0',
    });
    expect(projection.failure).toMatchObject({
      category: 'verification_failed', capability: 'histdata',
      stage: 'python_verify', cause: 'probe',
    });
  });

  it('reports GPQuant as intentionally absent only when the locked projection proves import failure', () => {
    const parsed = parseProbeOutput(LIVE_PROBE_STDOUT);
    parsed.capabilities.gpquant = { ok: false, cause: 'import', message: 'No module named gpquant' };
    const projected = projectProbeResults({
      parsed, expectedVersions: EXPECTED_VERSIONS, projection: 'without-gpquant',
    });
    expect(projected.failure).toBeUndefined();
    expect(projected.capabilities.gpquant).toMatchObject({
      state: 'intentionally_absent', expected: '0.1.6',
    });
  });

  it('refuses to publish without-gpquant when GPQuant still imports', () => {
    const projected = projectProbeResults({
      parsed: parseProbeOutput(LIVE_PROBE_STDOUT),
      expectedVersions: EXPECTED_VERSIONS,
      projection: 'without-gpquant',
    });
    expect(projected.failure).toMatchObject({
      category: 'verification_failed', capability: 'gpquant', cause: 'probe',
    });
  });

  it('marks every capability ready with its installed version', () => {
    const projection = projectProbeResults({
      parsed: parseProbeOutput(LIVE_PROBE_STDOUT),
      expectedVersions: EXPECTED_VERSIONS,
    });
    expect(projection.failure).toBeUndefined();
    for (const capability of RESEARCH_CAPABILITIES) {
      expect(projection.capabilities[capability].state).toBe('ready');
      expect(projection.capabilities[capability].installed).toBeTruthy();
    }
  });

  it('produces a status the contract parser accepts as ready', () => {
    // The real gate. The schema refuses `ready` unless every capability carries
    // an installed version, so this proves the projection can actually satisfy
    // the contract rather than merely type-check against it.
    const projection = projectProbeResults({
      parsed: parseProbeOutput(LIVE_PROBE_STDOUT),
      expectedVersions: EXPECTED_VERSIONS,
    });
    const parsed = researchEnvironmentStatusSchema.safeParse({
      schemaVersion: 2,
      profile: 'research-default',
      projection: 'default',
      state: 'ready',
      supportedPlatform: true,
      platform: 'linux',
      architecture: 'x64',
      interpreterPath: '/repo/.pixi/envs/default/bin/python',
      lastVerifiedAt: '2026-07-30T00:00:00.000Z',
      capabilities: projection.capabilities,
    });
    expect(parsed.success).toBe(true);
  });

  it('treats success without a version as a failure, not a ready capability', () => {
    // This is the pandas_ta case: it exposes no `__version__`, so an
    // attribute-based probe returns ok with no version. Admitting that as ready
    // would produce a status the boundary parser rejects, surfacing later as an
    // opaque validation error instead of an actionable verification failure.
    const capabilities = allOk();
    capabilities.pandas_ta = { ok: true, verification: 'imported' };
    const projection = projectProbeResults({
      parsed: parseProbeOutput(wrap({
        interpreter: '/i', pythonVersion: '3.12.13', capabilities,
      })),
      expectedVersions: EXPECTED_VERSIONS,
    });
    expect(projection.capabilities.pandas_ta.state).toBe('failed');
    expect(projection.failure).toMatchObject({
      category: 'verification_failed', capability: 'pandas_ta', stage: 'python_verify',
    });
  });

  it('attributes a Julia backend failure to julia_verify with backend_init', () => {
    const capabilities = allOk();
    capabilities.pysr = {
      ok: false, cause: 'backend_init', version: '1.5.10', message: 'Julia failed', backend_ok: false,
    };
    const projection = projectProbeResults({
      parsed: parseProbeOutput(wrap({
        interpreter: '/i', pythonVersion: '3.12.13', capabilities,
      })),
      expectedVersions: EXPECTED_VERSIONS,
    });
    expect(projection.failure).toMatchObject({
      category: 'verification_failed',
      stage: 'julia_verify',
      cause: 'backend_init',
      capability: 'pysr',
    });
    // Version present but state failed: the wheel installed, the backend did not.
    expect(projection.capabilities.pysr.installed).toBe('1.5.10');
    expect(projection.capabilities.pysr.state).toBe('failed');
  });

  it('cannot report pysr ready when the backend failed', () => {
    const capabilities = allOk();
    capabilities.pysr = { ok: false, cause: 'backend_init', version: '1.5.10', message: 'x' };
    const projection = projectProbeResults({
      parsed: parseProbeOutput(wrap({
        interpreter: '/i', pythonVersion: '3.12.13', capabilities,
      })),
      expectedVersions: EXPECTED_VERSIONS,
    });
    expect(projection.capabilities.pysr.state).not.toBe('ready');
  });

  it('blames the first failing capability in contract order, deterministically', () => {
    const capabilities = allOk();
    capabilities.gplearn = { ok: false, cause: 'import', message: 'no numpy' };
    capabilities.pysr = { ok: false, cause: 'import', message: 'no pysr' };
    const projection = projectProbeResults({
      parsed: parseProbeOutput(wrap({
        interpreter: '/i', pythonVersion: '3.12.13', capabilities,
      })),
      expectedVersions: EXPECTED_VERSIONS,
    });
    // RESEARCH_CAPABILITIES order starts with histdata, then gplearn follows duckdb.
    expect(projection.failure).toMatchObject({ capability: 'gplearn' });
  });

  it('attributes a shared-stack import failure to the capability that imports it', () => {
    // D5 step 7 has no capability of its own, and `verification_failed` requires
    // one. A NumPy/pandas ABI failure is therefore reported as the failure of the
    // first capability probe depending on it, with the module named in the message.
    const capabilities = allOk();
    capabilities.duckdb = {
      ok: false,
      cause: 'import',
      message: "ImportError: numpy.core.multiarray failed to import",
    };
    const projection = projectProbeResults({
      parsed: parseProbeOutput(wrap({
        interpreter: '/i', pythonVersion: '3.12.13', capabilities,
      })),
      expectedVersions: EXPECTED_VERSIONS,
    });
    expect(projection.failure).toMatchObject({ capability: 'duckdb', cause: 'import' });
    expect(projection.failure?.message).toContain('numpy');
  });

  it('carries lock-derived expected versions onto every card', () => {
    const projection = projectProbeResults({
      parsed: parseProbeOutput(LIVE_PROBE_STDOUT),
      expectedVersions: EXPECTED_VERSIONS,
    });
    expect(projection.capabilities.gplearn.expected).toBe('0.4.3');
  });

  it('supplies remediation without requiring the surface to parse a message', () => {
    const capabilities = allOk();
    capabilities.pysr = { ok: false, cause: 'backend_init', version: '1.5.10', message: 'x' };
    const projection = projectProbeResults({
      parsed: parseProbeOutput(wrap({
        interpreter: '/i', pythonVersion: '3.12.13', capabilities,
      })),
      expectedVersions: EXPECTED_VERSIONS,
    });
    expect(projection.failure?.remediation).toContain('Repair');
  });
});

describe('capability claiming ok without a version (TICKET_1335 AC13)', () => {
  it('never reports ready, and blames the probe rather than the package', () => {
    // This is the `pandas_ta` failure mode generalized: a package whose
    // distribution metadata is damaged can answer "ok" while being unable to
    // state what version it is. Readiness cannot be attested from that, so the
    // capability must not be `ready` -- and the cause is `probe`, not a package
    // fault, because the package itself may be perfectly fine.
    const capabilities = allOk();
    capabilities.gplearn = { ok: true };

    const projection = projectProbeResults({
      parsed: parseProbeOutput(wrap({
        interpreter: '/i', pythonVersion: '3.12.13', capabilities,
      })),
      expectedVersions: EXPECTED_VERSIONS,
    });

    expect(projection.capabilities.gplearn.state).not.toBe('ready');
    expect(projection.failure?.cause).toBe('probe');
    expect(projection.failure?.message).toContain('no installed version');
  });
});

describe('probe result defaults (TICKET_1335 AC13)', () => {
  it('supplies a verification note when a ready capability omits one', () => {
    const capabilities = allOk();
    capabilities.duckdb = { ok: true, version: EXPECTED_VERSIONS.duckdb };

    const projection = projectProbeResults({
      parsed: parseProbeOutput(wrap({
        interpreter: '/i', pythonVersion: '3.12.13', capabilities,
      })),
      expectedVersions: EXPECTED_VERSIONS,
    });
    expect(projection.capabilities.duckdb.state).toBe('ready');
    expect(projection.capabilities.duckdb.verification).toBeTruthy();
  });

  it('supplies a cause and message when a failing capability omits both', () => {
    // A probe that says "not ok" and nothing else must still produce a
    // renderable failure rather than an empty one.
    const capabilities = allOk();
    capabilities.gpquant = { ok: false, version: EXPECTED_VERSIONS.gpquant };

    const projection = projectProbeResults({
      parsed: parseProbeOutput(wrap({
        interpreter: '/i', pythonVersion: '3.12.13', capabilities,
      })),
      expectedVersions: EXPECTED_VERSIONS,
    });
    expect(projection.failure?.cause).toBe('probe');
    expect(projection.failure?.message).toContain('gpquant');
  });
});

describe('uniformCapabilities', () => {
  it('reports expected versions with no installed version before verification', () => {
    const capabilities = uniformCapabilities(EXPECTED_VERSIONS, 'absent');
    for (const capability of RESEARCH_CAPABILITIES) {
      expect(capabilities[capability].expected).toBe(EXPECTED_VERSIONS[capability]);
      expect(capabilities[capability].installed).toBeUndefined();
      expect(capabilities[capability].state).toBe('absent');
    }
  });

  it('covers every runtime capability so no card can be missing', () => {
    expect(Object.keys(uniformCapabilities(EXPECTED_VERSIONS, 'installing')).sort())
      .toEqual([...RESEARCH_CAPABILITIES].sort());
  });
});
