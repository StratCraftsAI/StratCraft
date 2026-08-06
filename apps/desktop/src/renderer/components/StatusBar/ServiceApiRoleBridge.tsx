/**
 * TICKET_1334 P4 (D4 / AC5_1) -- IPC bridge for the Service API runtime role.
 *
 * TICKET_367 Layer 2 puts the IPC in a bridge and the payload in the store, so
 * this render-null component owns the pull-on-mount and the push subscription
 * for `useServiceApiRoleStore`, mirroring `SweepIPCBridge` next to it.
 *
 * WHY A BRIDGE MOUNTED IN THE LAYOUT RATHER THAN A HOOK IN THE PANEL:
 * TWO panels label from this state (`ToolSweepTab` and `SignalDiscoverySection`,
 * both in the Quant Lab plugin), and they mount and unmount independently as the
 * user switches tabs. A per-panel subscription would open and close a listener on
 * every tab switch and would leave the store empty whenever neither is mounted.
 * One app-lifetime subscription in the layout keeps a single listener and means
 * the answer is already there the moment a panel renders.
 *
 * WHY BOTH A PULL AND A SUBSCRIPTION:
 * TICKET_206. The pull answers for a renderer that just started -- the role was
 * decided in main before this window existed. The subscription covers the fact
 * that the role is NOT a boot-time constant: the headless runtime can be stopped
 * or killed, or started, while this window is open. Reading once at mount is
 * exactly the staleness D4's label cannot tolerate, since a label naming a dead
 * process is worse than no label at all.
 */

import { useEffect, useRef } from 'react';
import { useServiceApiRoleStore } from '@/stores/useServiceApiRoleStore';

export function ServiceApiRoleBridge() {
  const applyRole = useServiceApiRoleStore((s) => s.applyRole);
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const api = (window as any).electronAPI?.serviceApi;
    // Optional-chained throughout: this component also mounts in renderer test
    // environments and in the plugin dev harness, where `electronAPI` is absent.
    // Its absence means "no role information", which the store already models as
    // null and the banner renders as nothing.
    api?.getRole?.().then((state: any) => {
      if (state) applyRole(state);
    });
  }, [applyRole]);

  useEffect(() => {
    const api = (window as any).electronAPI?.serviceApi;
    if (!api?.onRoleChanged) return;
    const unsub = api.onRoleChanged((state: any) => {
      if (state) applyRole(state);
    });
    return () => unsub?.();
  }, [applyRole]);

  return null;
}
