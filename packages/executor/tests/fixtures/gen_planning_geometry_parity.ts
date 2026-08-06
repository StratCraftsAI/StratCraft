/**
 * TICKET_1292 Phase 5 5B (MC-11) -- golden parity fixture generator.
 *
 * Captures the OUTPUT of the TypeScript cv-sizing-contract.ts (the pre-rewire
 * single source of truth per TICKET_849) and the Python embargo.auto_embargo
 * across the full boundary matrix, so the C++ planning-geometry owner can be
 * proven value-identical to the authority it replaces BEFORE any consumer is
 * rewired.
 *
 * Run from repo root:
 *   npx tsx packages/executor/tests/fixtures/gen_planning_geometry_parity.ts \
 *     > packages/executor/tests/fixtures/planning_geometry_parity_v1.json
 *
 * The Python embargo values are captured by a sibling script
 * (gen_embargo_parity.py) and merged in; this script owns the CV-sizing math.
 */

import {
  requiredPullBars,
  planPaths,
  checkRefusal,
  type CvSizingContract,
  type CvScheme,
} from '../../../../apps/desktop/src/main/services/signal-discovery/cv-sizing-contract';

interface Case {
  label: string;
  contract: CvSizingContract;
  totalBars: number;
}

const cases: Case[] = [];

const push = (label: string, contract: CvSizingContract, totalBars: number): void => {
  cases.push({ label, contract, totalBars });
};

// --- walk_forward across fold counts, embargo, warmup, netNew ---
for (const folds of [2, 3, 5, 10]) {
  for (const embargo of [0, 5, 24]) {
    for (const warmup of [0, 100, 362]) {
      for (const netNew of [1, 100, 600, 5000]) {
        const c: CvSizingContract = {
          scheme: 'walk_forward',
          totalSegments: folds + 1,
          testSegments: 1,
          embargoBars: embargo,
          horizonBars: 0,
          warmupBars: warmup,
          netNewBars: netNew,
        };
        const req = requiredPullBars(c);
        // Probe totalBars at, just below, and above the required threshold, plus
        // thin-data and generous cases -- exercises refusal endpoints exactly.
        for (const tb of [req, req - 1, req + 1, Math.max(1, Math.floor(req / 2)), req * 4]) {
          if (tb <= 0) continue;
          push(
            `wf_f${folds}_e${embargo}_w${warmup}_n${netNew}_tb${tb}`,
            c,
            tb,
          );
        }
      }
    }
  }
}

// --- single_split ---
for (const embargo of [0, 5]) {
  for (const warmup of [0, 100]) {
    for (const netNew of [1, 100]) {
      const c: CvSizingContract = {
        scheme: 'single_split',
        totalSegments: 2,
        testSegments: 1,
        embargoBars: embargo,
        horizonBars: 0,
        warmupBars: warmup,
        netNewBars: netNew,
      };
      const req = requiredPullBars(c);
      for (const tb of [req, req + 10, Math.max(1, req - 1)]) {
        push(`ss_e${embargo}_w${warmup}_n${netNew}_tb${tb}`, c, tb);
      }
    }
  }
}

// --- cpcv across N/k, with horizon ---
for (const N of [4, 6, 8, 12]) {
  for (const k of [1, 2, 3]) {
    if (k >= N) continue;
    for (const embargo of [0, 5]) {
      for (const horizon of [0, 10]) {
        for (const netNew of [100, 600]) {
          const c: CvSizingContract = {
            scheme: 'cpcv',
            totalSegments: N,
            testSegments: k,
            embargoBars: embargo,
            horizonBars: horizon,
            warmupBars: 50,
            netNewBars: netNew,
          };
          const req = requiredPullBars(c);
          for (const tb of [req, req + 100, Math.max(1, Math.floor(req * 0.6))]) {
            push(`cpcv_N${N}_k${k}_e${embargo}_h${horizon}_n${netNew}_tb${tb}`, c, tb);
          }
        }
      }
    }
  }
}

// --- expanding (walk-forward twin) ---
for (const folds of [3, 5]) {
  const c: CvSizingContract = {
    scheme: 'expanding',
    totalSegments: folds + 1,
    testSegments: 1,
    embargoBars: 5,
    horizonBars: 0,
    warmupBars: 100,
    netNewBars: 600,
  };
  const req = requiredPullBars(c);
  for (const tb of [req, req + 1]) {
    push(`exp_f${folds}_tb${tb}`, c, tb);
  }
}

const out = cases.map((cs) => {
  const req = requiredPullBars(cs.contract);
  const refusal = checkRefusal(cs.contract, cs.totalBars);
  const paths = refusal === null ? planPaths(cs.contract, cs.totalBars) : [];
  return {
    label: cs.label,
    contract: {
      scheme: cs.contract.scheme as CvScheme,
      totalSegments: cs.contract.totalSegments,
      testSegments: cs.contract.testSegments,
      embargoBars: cs.contract.embargoBars,
      horizonBars: cs.contract.horizonBars,
      warmupBars: cs.contract.warmupBars,
      netNewBars: cs.contract.netNewBars,
    },
    totalBars: cs.totalBars,
    requiredPullBars: req,
    refusal: refusal
      ? {
          totalBars: refusal.totalBars,
          requiredPullBars: refusal.requiredPullBars,
          perPathIsBars: refusal.perPathIsBars,
          floorRequired: refusal.floorRequired,
          embargoBars: refusal.embargoBars,
          totalSegments: refusal.totalSegments,
          testSegments: refusal.testSegments,
        }
      : null,
    paths: paths.map((p) => ({
      pathIndex: p.pathIndex,
      totalPaths: p.totalPaths,
      testSegmentIndices: p.testSegmentIndices,
      isStartBar: p.isStartBar,
      isEndBar: p.isEndBar,
      oosStartBar: p.oosStartBar,
      oosEndBar: p.oosEndBar,
      purgedBars: p.purgedBars,
    })),
  };
});

process.stdout.write(JSON.stringify({ version: 1, cases: out }, null, 2) + '\n');
