/**
 * Indicator Exit Page Form State Store
 *
 * TICKET_1208 P6 Layer B: Preserves form inputs across view switches.
 * In-memory only (no persist) — survives unmount/remount, not app restart.
 */

import { create } from 'zustand';
import type { RiskOverrideRule } from '../../services/risk-override-exit-service';

const INITIAL_HARD_SAFETY_MAX_LOSS = -20;

interface IndicatorExitFormState {
  rules: RiskOverrideRule[];
  hardSafetyMaxLoss: number;

  setRules: (rules: RiskOverrideRule[] | ((prev: RiskOverrideRule[]) => RiskOverrideRule[])) => void;
  setHardSafetyMaxLoss: (value: number) => void;
  reset: () => void;
}

export const useIndicatorExitStore = create<IndicatorExitFormState>((set) => ({
  rules: [],
  hardSafetyMaxLoss: INITIAL_HARD_SAFETY_MAX_LOSS,

  setRules: (rules) =>
    set((s) => ({
      rules: typeof rules === 'function' ? rules(s.rules) : rules,
    })),
  setHardSafetyMaxLoss: (value) => set({ hardSafetyMaxLoss: value }),
  reset: () =>
    set({
      rules: [],
      hardSafetyMaxLoss: INITIAL_HARD_SAFETY_MAX_LOSS,
    }),
}));
