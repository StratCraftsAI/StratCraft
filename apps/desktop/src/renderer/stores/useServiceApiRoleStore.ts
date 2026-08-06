/**
 * TICKET_1334 P4 (D4 / AC5_1) -- renderer view store for the Service API
 * runtime role.
 *
 * WHAT IT IS FOR:
 * The desktop app can be fully running while a headless `serve` runtime holds
 * the Service API runtime role (TICKET_1334 D3: the host that loses the O_EXCL
 * claim starts everything else normally -- window, IPC, renderer). In that state
 * the Quant Lab launch controls still WORK, because they reach the same shared
 * operation through whichever process hosts the transport. D4 settled that the
 * controls therefore stay enabled and are LABELLED with who is serving them,
 * rejecting both silently operating the other process (a cognitive-gap trap) and
 * disabling the controls (removing capability the user still has). This store
 * holds the state that label reads.
 *
 * TICKET_367 LAYER 2: this store holds the main-process payload VERBATIM and
 * performs no IPC itself. `ServiceApiRoleBridge` owns the pull-on-mount plus the
 * push subscription, exactly as `SweepIPCBridge` does for the sweep store. It is
 * also why the label is not `useState` in the banner component: the role is
 * cross-cutting state that outlives any one panel's mount, and two panels
 * (`ToolSweepTab` and `SignalDiscoverySection`) render from it.
 *
 * SURFACE-LAYER PARITY: `status` is DECIDED in `@StratCraft/types`
 * (`resolveServiceApiRoleState`) from facts main samples. Nothing here re-derives
 * it -- there is deliberately no selector that inspects `holder.pid` to second-
 * guess `status`, because that would put the ownership rule in the renderer too.
 */

import { create } from 'zustand';
import type { ServiceApiRuntimeRoleState } from '@StratCraft/types';

export interface ServiceApiRoleState {
  /**
   * The last state received from main, or null before the first pull resolves.
   *
   * Null is NOT "no external runtime" -- it is "not yet known", and the banner
   * renders nothing for it. Collapsing the two would flash a wrong answer during
   * the first tick of every launch (TICKET_858: a confident label built on an
   * unknown is a silent failure).
   */
  role: ServiceApiRuntimeRoleState | null;
}

interface ServiceApiRoleActions {
  /** Apply a role state from either the pull handler or a push event.
   *  Idempotent -- both sources carry the identical shape. */
  applyRole: (role: ServiceApiRuntimeRoleState) => void;
  reset: () => void;
}

const INITIAL: ServiceApiRoleState = { role: null };

export const useServiceApiRoleStore = create<ServiceApiRoleState & ServiceApiRoleActions>(
  (set) => ({
    ...INITIAL,
    applyRole: (role) => set({ role }),
    reset: () => set(INITIAL),
  }),
);

/**
 * Is a runtime OTHER than this process serving the Service API?
 *
 * The single predicate the labelling surfaces read. It is a straight read of the
 * shared `status`, not a re-derivation: `holder` / `none` both mean "no external
 * runtime to name". Kept as one exported selector so the two panels cannot drift
 * on what counts as external.
 */
export const selectIsServedExternally = (s: ServiceApiRoleState): boolean =>
  s.role?.status === 'external';

/** The external holder to name in the label, or null when there is none. */
export const selectExternalHolder = (s: ServiceApiRoleState) =>
  s.role?.status === 'external' ? (s.role.holder ?? null) : null;
