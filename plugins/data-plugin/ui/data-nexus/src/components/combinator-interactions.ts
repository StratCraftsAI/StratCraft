import type { CombinatorMode } from '../types/combinator';

export interface ActivateModelVersionOptions {
  combinatorMode: CombinatorMode;
  canSelectVersion: boolean;
  versionId: string;
  onCombinatorModeChange: (mode: CombinatorMode) => void;
  onActiveVersionChange?: (versionId: string) => void;
}

/**
 * Applies both intents carried by a model-version row click: activate the
 * Deep Learning combinator and, when allowed, select the targeted version.
 */
export function activateModelVersion({
  combinatorMode,
  canSelectVersion,
  versionId,
  onCombinatorModeChange,
  onActiveVersionChange,
}: ActivateModelVersionOptions): void {
  if (combinatorMode !== 'deep_learning') {
    onCombinatorModeChange('deep_learning');
  }
  if (canSelectVersion) {
    onActiveVersionChange?.(versionId);
  }
}

/**
 * An otherwise inactive version row must remain enabled while the Linear
 * Ensemble is selected so that its click can activate Deep Learning.
 */
export function isModelVersionRowDisabled(
  combinatorMode: CombinatorMode,
  canSelectVersion: boolean,
): boolean {
  return combinatorMode === 'deep_learning' && !canSelectVersion;
}
