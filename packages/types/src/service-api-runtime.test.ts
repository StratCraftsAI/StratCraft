/**
 * TICKET_1334 P0 -- pure contract tests for the Service API runtime-role record.
 *
 * These cover the DECISION half (parse / staleness / describe). The filesystem
 * half -- O_EXCL contention, reaping, release -- is covered against the real
 * kernel in
 * `apps/desktop/src/main/services/api/__tests__/runtime-claim.1334.test.ts`,
 * because that property IS a filesystem property and a mocked fs would assert
 * the mock's semantics instead of the kernel's.
 */

import { describe, expect, it } from 'vitest';

import {
  SERVICE_API_HOSTS,
  SERVICE_API_HOST_LABELS,
  describeServiceApiClaim,
  formatServiceApiRuntimeClaim,
  isServiceApiClaimStale,
  isServiceApiHost,
  parseServiceApiRuntimeClaim,
  // TICKET_1334 P4 (D4 / AC5_1)
  SERVICE_API_ROLE_STATUSES,
  isSameServiceApiRoleState,
  resolveServiceApiRoleState,
  type ServiceApiRuntimeClaim,
} from './service-api-runtime';

const ELECTRON_CLAIM: ServiceApiRuntimeClaim = {
  host: 'electron',
  pid: 4242,
  claimedAtMs: 1785372100000,
};

describe('host identity', () => {
  it('names both hosts and labels every one of them', () => {
    expect(SERVICE_API_HOSTS).toEqual(['electron', 'headless']);
    for (const host of SERVICE_API_HOSTS) {
      expect(SERVICE_API_HOST_LABELS[host]).toBeTruthy();
    }
  });

  it('accepts the known hosts and rejects anything else', () => {
    expect(isServiceApiHost('electron')).toBe(true);
    expect(isServiceApiHost('headless')).toBe(true);
    expect(isServiceApiHost('cli-chain')).toBe(false);
    expect(isServiceApiHost(undefined)).toBe(false);
    expect(isServiceApiHost(1)).toBe(false);
  });
});

describe('parseServiceApiRuntimeClaim', () => {
  it('accepts a well-formed claim', () => {
    const claim = parseServiceApiRuntimeClaim(JSON.stringify(ELECTRON_CLAIM));
    expect(claim).toEqual(ELECTRON_CLAIM);
  });

  it('round-trips whatever the formatter writes -- one encoding, both hosts', () => {
    const raw = formatServiceApiRuntimeClaim(ELECTRON_CLAIM);
    expect(parseServiceApiRuntimeClaim(raw)).toEqual(ELECTRON_CLAIM);
  });

  it('rejects an unknown host', () => {
    expect(parseServiceApiRuntimeClaim(JSON.stringify({ host: 'nope', pid: 1 }))).toBeNull();
  });

  it('rejects a claim with NO pid -- it would carry no liveness evidence', () => {
    // Unlike SweepRunClaim (which may be unit-shaped), the API role is always
    // held by the process writing the claim, so a pid-less claim could never be
    // distinguished from a live holder and would brick every future start.
    expect(parseServiceApiRuntimeClaim(JSON.stringify({ host: 'headless' }))).toBeNull();
    expect(
      parseServiceApiRuntimeClaim(JSON.stringify({ host: 'headless', pid: 'many' })),
    ).toBeNull();
    expect(
      parseServiceApiRuntimeClaim(JSON.stringify({ host: 'headless', pid: 1.5 })),
    ).toBeNull();
  });

  it('rejects a non-positive pid -- process.kill(0, 0) probes our own group', () => {
    // A 0 pid would signal the caller's whole process group and therefore report
    // spuriously ALIVE, making the claim unreapable.
    expect(parseServiceApiRuntimeClaim(JSON.stringify({ host: 'electron', pid: 0 }))).toBeNull();
    expect(parseServiceApiRuntimeClaim(JSON.stringify({ host: 'electron', pid: -1 }))).toBeNull();
  });

  it('rejects malformed JSON and non-objects', () => {
    expect(parseServiceApiRuntimeClaim('{ truncated')).toBeNull();
    expect(parseServiceApiRuntimeClaim('null')).toBeNull();
    expect(parseServiceApiRuntimeClaim('42')).toBeNull();
    expect(parseServiceApiRuntimeClaim('[]')).toBeNull();
    expect(parseServiceApiRuntimeClaim('')).toBeNull();
  });

  it('defaults a non-finite claim time to 0 rather than trusting it', () => {
    const claim = parseServiceApiRuntimeClaim(
      JSON.stringify({ host: 'headless', pid: 9, claimedAtMs: 'soon' }),
    );
    expect(claim?.claimedAtMs).toBe(0);
    expect(claim?.pid).toBe(9);
  });
});

describe('isServiceApiClaimStale', () => {
  it('is stale when the holder pid is dead', () => {
    expect(isServiceApiClaimStale(ELECTRON_CLAIM, { pidAlive: false })).toBe(true);
  });

  it('is NOT stale when the holder pid is alive', () => {
    expect(isServiceApiClaimStale(ELECTRON_CLAIM, { pidAlive: true })).toBe(false);
  });

  it('FAILS CLOSED -- unprobed liveness counts as alive, never reaped', () => {
    // Reaping a live claim yields two API servers and restores the
    // last-writer-wins discovery-file defect; retaining a dead one yields a loud
    // refusal an operator can resolve. Retain-on-doubt is the cheap error.
    expect(isServiceApiClaimStale(ELECTRON_CLAIM, {})).toBe(false);
    expect(isServiceApiClaimStale(ELECTRON_CLAIM, { pidAlive: undefined })).toBe(false);
  });
});

describe('describeServiceApiClaim', () => {
  it('names the holder host AND pid, per the D3 refusal wording', () => {
    const description = describeServiceApiClaim(ELECTRON_CLAIM);
    expect(description).toContain(SERVICE_API_HOST_LABELS.electron);
    expect(description).toContain('pid=4242');
  });

  it('distinguishes the two hosts', () => {
    expect(describeServiceApiClaim({ host: 'headless', pid: 7, claimedAtMs: 0 })).toContain(
      SERVICE_API_HOST_LABELS.headless,
    );
  });
});

// =============================================================================
// TICKET_1334 P4 (D4 / AC5_1) -- runtime-role STATE resolution.
//
// This is the decision the desktop labelling reads: holds / lost-to-a-live-
// incumbent / no incumbent. It lives here, in the pure contract, precisely so
// that the Electron surface and any future surface render one answer instead of
// each re-deriving "who serves the Service API" (CLAUDE.md SURFACE-LAYER
// PARITY). The IO that samples the facts is tested against the real filesystem
// in `runtime-role.1334.test.ts`.
// =============================================================================

describe('resolveServiceApiRoleState', () => {
  const HEADLESS_CLAIM: ServiceApiRuntimeClaim = {
    host: 'headless',
    pid: 9931,
    claimedAtMs: 1785372200000,
  };

  it('reports `holder` with the port when THIS process holds the role', () => {
    expect(
      resolveServiceApiRoleState({
        selfHolds: true,
        selfPort: 41711,
        selfClaim: ELECTRON_CLAIM,
      }),
    ).toEqual({ status: 'holder', holder: ELECTRON_CLAIM, port: 41711 });
  });

  it('lets a live self-listener win over whatever the claim file says', () => {
    // An in-process listener is strictly stronger evidence than a file that
    // could be mid-write or left by a predecessor. It also means the common
    // case never depends on the filesystem.
    const state = resolveServiceApiRoleState({
      selfHolds: true,
      selfPort: 41711,
      selfClaim: ELECTRON_CLAIM,
      incumbentClaim: HEADLESS_CLAIM,
      incumbentLiveness: { pidAlive: true },
    });
    expect(state.status).toBe('holder');
    expect(state.holder).toEqual(ELECTRON_CLAIM);
  });

  it('reports `external` naming the holder when a LIVE incumbent holds it', () => {
    // D4: this is the state where the desktop launch controls stay usable and
    // are labelled. The holder must be carried, because D4 rejected silently
    // operating the other process -- a bare boolean could not name it.
    expect(
      resolveServiceApiRoleState({
        selfHolds: false,
        incumbentClaim: HEADLESS_CLAIM,
        incumbentLiveness: { pidAlive: true },
      }),
    ).toEqual({ status: 'external', holder: HEADLESS_CLAIM });
  });

  it('reports `none` when there is no incumbent at all', () => {
    expect(resolveServiceApiRoleState({ selfHolds: false })).toEqual({ status: 'none' });
  });

  it('reports `none`, NOT `external`, for a dead incumbent', () => {
    // A holder killed by SIGKILL/OOM leaves its claim file behind. Labelling
    // the surface with a dead pid would be a confident falsehood -- worse than
    // no label (TICKET_858).
    expect(
      resolveServiceApiRoleState({
        selfHolds: false,
        incumbentClaim: HEADLESS_CLAIM,
        incumbentLiveness: { pidAlive: false },
      }),
    ).toEqual({ status: 'none' });
  });

  it('treats UNPROBED liveness as alive, matching the reap rule', () => {
    // Fail-closed, and deliberately the SAME predicate that decides reaping
    // (`isServiceApiClaimStale`): if the two rules diverged the app could label
    // a runtime it had already reaped.
    expect(
      resolveServiceApiRoleState({
        selfHolds: false,
        incumbentClaim: HEADLESS_CLAIM,
        incumbentLiveness: {},
      }),
    ).toEqual({ status: 'external', holder: HEADLESS_CLAIM });
    expect(
      resolveServiceApiRoleState({ selfHolds: false, incumbentClaim: HEADLESS_CLAIM }),
    ).toEqual({ status: 'external', holder: HEADLESS_CLAIM });
  });

  it('carries no availability/disabled flag -- D4 rejected disabling the controls', () => {
    // Guards the shape itself: there must be nothing here a surface could read
    // as permission to gate a launch control, because the capability is present
    // in every state (D4 option (c) rejected; TICKET_860).
    for (const facts of [
      { selfHolds: true, selfPort: 1, selfClaim: ELECTRON_CLAIM },
      { selfHolds: false, incumbentClaim: HEADLESS_CLAIM, incumbentLiveness: { pidAlive: true } },
      { selfHolds: false },
    ]) {
      const keys = Object.keys(resolveServiceApiRoleState(facts));
      expect(keys.every((k) => ['status', 'holder', 'port'].includes(k))).toBe(true);
    }
  });

  it('only ever produces a declared status', () => {
    for (const facts of [
      { selfHolds: true },
      { selfHolds: false, incumbentClaim: HEADLESS_CLAIM, incumbentLiveness: { pidAlive: true } },
      { selfHolds: false },
    ]) {
      expect(SERVICE_API_ROLE_STATUSES).toContain(resolveServiceApiRoleState(facts).status);
    }
  });
});

describe('isSameServiceApiRoleState', () => {
  const A: ServiceApiRuntimeClaim = { host: 'headless', pid: 10, claimedAtMs: 100 };

  it('treats identical states as the same fact, so an idle app broadcasts nothing', () => {
    expect(
      isSameServiceApiRoleState(
        { status: 'external', holder: A },
        { status: 'external', holder: { ...A } },
      ),
    ).toBe(true);
    expect(isSameServiceApiRoleState({ status: 'none' }, { status: 'none' })).toBe(true);
  });

  it('detects a status transition', () => {
    expect(isSameServiceApiRoleState({ status: 'external', holder: A }, { status: 'none' })).toBe(false);
    expect(isSameServiceApiRoleState({ status: 'none' }, { status: 'holder', port: 1 })).toBe(false);
  });

  it('detects the holder being REPLACED by a different runtime at the same status', () => {
    // A headless daemon restarting under a new pid is a real change the label
    // must follow, even though `status` stayed `external` throughout.
    expect(
      isSameServiceApiRoleState(
        { status: 'external', holder: A },
        { status: 'external', holder: { ...A, pid: 11 } },
      ),
    ).toBe(false);
    expect(
      isSameServiceApiRoleState(
        { status: 'external', holder: A },
        { status: 'external', holder: { ...A, host: 'electron' } },
      ),
    ).toBe(false);
    expect(
      isSameServiceApiRoleState(
        { status: 'external', holder: A },
        { status: 'external', holder: { ...A, claimedAtMs: 999 } },
      ),
    ).toBe(false);
  });

  it('detects a port change and a holder appearing/disappearing', () => {
    expect(
      isSameServiceApiRoleState({ status: 'holder', port: 1 }, { status: 'holder', port: 2 }),
    ).toBe(false);
    expect(
      isSameServiceApiRoleState({ status: 'external', holder: A }, { status: 'external' }),
    ).toBe(false);
  });
});
