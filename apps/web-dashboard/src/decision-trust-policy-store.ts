import { create } from 'zustand'

import type {
  DecisionTrustPolicy,
  DecisionTrustPolicyView,
} from './agent-control-client.ts'

interface DecisionTrustPolicyState {
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error'
  policy: DecisionTrustPolicy | null
  policyVersion: number
  eligibleOperations: string[]
  invalidEntries: DecisionTrustPolicyView['invalidEntries']
  error: string | null
  loadStarted(): void
  loaded(view: DecisionTrustPolicyView): void
  setLevel(level: DecisionTrustPolicy['level']): void
  setTtl(trustWindowTtlMs: number): void
  toggleOperation(operation: string): void
  saving(): void
  failed(error: string): void
}

export const useDecisionTrustPolicyStore = create<DecisionTrustPolicyState>((set) => ({
  status: 'idle',
  policy: null,
  policyVersion: 0,
  eligibleOperations: [],
  invalidEntries: [],
  error: null,
  loadStarted: () => set({ status: 'loading', error: null }),
  loaded: (view) => set({
    status: 'ready',
    policy: {
      ...view.policy,
      allowlist: [...view.policy.allowlist],
    },
    policyVersion: view.policyVersion,
    eligibleOperations: [...view.eligibleOperations],
    invalidEntries: [...view.invalidEntries],
    error: null,
  }),
  setLevel: (level) => set((state) => state.policy
    ? { policy: { ...state.policy, level } }
    : {}),
  setTtl: (trustWindowTtlMs) => set((state) => state.policy
    ? { policy: { ...state.policy, trustWindowTtlMs } }
    : {}),
  toggleOperation: (operation) => set((state) => {
    if (!state.policy) return {}
    const selected = state.policy.allowlist.includes(operation)
    return {
      policy: {
        ...state.policy,
        allowlist: selected
          ? state.policy.allowlist.filter((entry) => entry !== operation)
          : [...state.policy.allowlist, operation].sort(),
      },
    }
  }),
  saving: () => set({ status: 'saving', error: null }),
  failed: (error) => set({ status: 'error', error }),
}))
