import { describe, expect, it, vi } from 'vitest';
import {
  activateModelVersion,
  isModelVersionRowDisabled,
} from '../combinator-interactions';

describe('TICKET_1002: inactive Deep Learning model-version interaction', () => {
  it('activates Deep Learning when the current version row is clicked from Linear mode', () => {
    const onCombinatorModeChange = vi.fn();
    const onActiveVersionChange = vi.fn();

    activateModelVersion({
      combinatorMode: 'statistical',
      canSelectVersion: false,
      versionId: 'active-version',
      onCombinatorModeChange,
      onActiveVersionChange,
    });

    expect(onCombinatorModeChange).toHaveBeenCalledOnce();
    expect(onCombinatorModeChange).toHaveBeenCalledWith('deep_learning');
    expect(onActiveVersionChange).not.toHaveBeenCalled();
  });

  it('activates Deep Learning and selects a compatible version in one click', () => {
    const callOrder: string[] = [];

    activateModelVersion({
      combinatorMode: 'statistical',
      canSelectVersion: true,
      versionId: 'compatible-version',
      onCombinatorModeChange: mode => callOrder.push(`mode:${mode}`),
      onActiveVersionChange: versionId => callOrder.push(`version:${versionId}`),
    });

    expect(callOrder).toEqual([
      'mode:deep_learning',
      'version:compatible-version',
    ]);
  });

  it('activates Deep Learning without selecting an incompatible version', () => {
    const onCombinatorModeChange = vi.fn();
    const onActiveVersionChange = vi.fn();

    activateModelVersion({
      combinatorMode: 'statistical',
      canSelectVersion: false,
      versionId: 'incompatible-version',
      onCombinatorModeChange,
      onActiveVersionChange,
    });

    expect(onCombinatorModeChange).toHaveBeenCalledWith('deep_learning');
    expect(onActiveVersionChange).not.toHaveBeenCalled();
  });

  it('selects a compatible version without re-activating Deep Learning', () => {
    const onCombinatorModeChange = vi.fn();
    const onActiveVersionChange = vi.fn();

    activateModelVersion({
      combinatorMode: 'deep_learning',
      canSelectVersion: true,
      versionId: 'compatible-version',
      onCombinatorModeChange,
      onActiveVersionChange,
    });

    expect(onCombinatorModeChange).not.toHaveBeenCalled();
    expect(onActiveVersionChange).toHaveBeenCalledOnce();
    expect(onActiveVersionChange).toHaveBeenCalledWith('compatible-version');
  });

  it('keeps all version rows enabled while Linear mode is active', () => {
    expect(isModelVersionRowDisabled('statistical', true)).toBe(false);
    expect(isModelVersionRowDisabled('statistical', false)).toBe(false);
  });

  it('disables only non-selectable rows after Deep Learning is active', () => {
    expect(isModelVersionRowDisabled('deep_learning', true)).toBe(false);
    expect(isModelVersionRowDisabled('deep_learning', false)).toBe(true);
  });
});
