/**
 * TICKET_1334 P4 (D4 / AC5_1) -- host-side runtime-role view store.
 *
 * TICKET_367 Layer 2: this store must hold the main-process payload VERBATIM and
 * make no decision of its own. What is asserted here is exactly that -- the
 * reducer is idempotent across pull and push, the selectors read `status` rather
 * than re-deriving it, and "not yet known" stays distinct from "no external
 * runtime" so the label cannot flash a wrong answer on the first tick.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { ServiceApiRuntimeRoleState } from '@StratCraft/types';

import {
  selectExternalHolder,
  selectIsServedExternally,
  useServiceApiRoleStore,
} from '../useServiceApiRoleStore';

const EXTERNAL: ServiceApiRuntimeRoleState = {
  status: 'external',
  holder: { host: 'headless', pid: 2832541, claimedAtMs: 1785372200000 },
};
const HOLDER: ServiceApiRuntimeRoleState = {
  status: 'holder',
  holder: { host: 'electron', pid: 111, claimedAtMs: 0 },
  port: 41711,
};

beforeEach(() => {
  useServiceApiRoleStore.getState().reset();
});

describe('useServiceApiRoleStore', () => {
  it('starts with an UNKNOWN role, not with "no external runtime"', () => {
    // Collapsing the two would render a confident "served locally" during the
    // first tick of every launch (TICKET_858).
    expect(useServiceApiRoleStore.getState().role).toBeNull();
    expect(selectIsServedExternally(useServiceApiRoleStore.getState())).toBe(false);
    expect(selectExternalHolder(useServiceApiRoleStore.getState())).toBeNull();
  });

  it('holds the payload VERBATIM (TICKET_367 Layer 2)', () => {
    useServiceApiRoleStore.getState().applyRole(EXTERNAL);
    // Same reference: no cloning, no derived fields, no reshaping.
    expect(useServiceApiRoleStore.getState().role).toBe(EXTERNAL);
  });

  it('applies pull and push through the SAME idempotent reducer', () => {
    const { applyRole } = useServiceApiRoleStore.getState();
    applyRole(EXTERNAL);
    applyRole(EXTERNAL);
    expect(useServiceApiRoleStore.getState().role).toEqual(EXTERNAL);
  });

  it('follows a transition to `none` so a dead holder stops being labelled', () => {
    const { applyRole } = useServiceApiRoleStore.getState();
    applyRole(EXTERNAL);
    applyRole({ status: 'none' });
    expect(selectIsServedExternally(useServiceApiRoleStore.getState())).toBe(false);
    expect(selectExternalHolder(useServiceApiRoleStore.getState())).toBeNull();
  });

  it('follows a transition to this app taking the role', () => {
    const { applyRole } = useServiceApiRoleStore.getState();
    applyRole(EXTERNAL);
    applyRole(HOLDER);
    expect(selectIsServedExternally(useServiceApiRoleStore.getState())).toBe(false);
  });
});

describe('selectors', () => {
  it('selectIsServedExternally is true ONLY for `external`', () => {
    const { applyRole } = useServiceApiRoleStore.getState();
    for (const [state, expected] of [
      [EXTERNAL, true],
      [HOLDER, false],
      [{ status: 'none' } as ServiceApiRuntimeRoleState, false],
    ] as const) {
      applyRole(state);
      expect(selectIsServedExternally(useServiceApiRoleStore.getState())).toBe(expected);
    }
  });

  it('selectExternalHolder names the holder only when it is external', () => {
    const { applyRole } = useServiceApiRoleStore.getState();
    applyRole(EXTERNAL);
    expect(selectExternalHolder(useServiceApiRoleStore.getState())).toEqual(EXTERNAL.holder);

    // `holder` is populated for the self-held case too; the selector must not
    // leak it as an EXTERNAL holder, or the app would label itself.
    applyRole(HOLDER);
    expect(selectExternalHolder(useServiceApiRoleStore.getState())).toBeNull();
  });

  it('reads `status` rather than re-deriving it from the holder', () => {
    // SURFACE-LAYER PARITY: the ownership decision belongs to
    // `resolveServiceApiRoleState()` in `@StratCraft/types`. A selector that
    // second-guessed `status` from `holder.pid` would put the rule in the
    // renderer too.
    useServiceApiRoleStore.getState().applyRole({
      status: 'holder',
      holder: { host: 'headless', pid: 999, claimedAtMs: 0 },
    });
    expect(selectIsServedExternally(useServiceApiRoleStore.getState())).toBe(false);
  });

  it('reset returns the store to UNKNOWN, not to a resolved state', () => {
    useServiceApiRoleStore.getState().applyRole(EXTERNAL);
    useServiceApiRoleStore.getState().reset();
    expect(useServiceApiRoleStore.getState().role).toBeNull();
  });
});
