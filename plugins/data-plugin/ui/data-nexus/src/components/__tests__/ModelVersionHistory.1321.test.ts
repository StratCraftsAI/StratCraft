/**
 * TICKET_1321: model-version information architecture and shared-contract tests.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LstmModelManifestUI, LstmModelVersionUI } from '../../types/combinator';
import {
  isLegacyModelVersion,
  ModelVersionHistory,
  ModelVersionRow,
  newestFirst,
  registrationOf,
} from '../ModelVersionHistory';

const componentPath = resolve(__dirname, '..', 'ModelVersionHistory.tsx');
const combinatorPath = resolve(__dirname, '..', 'CombinatorSection.tsx');
const pickerPath = resolve(__dirname, '..', 'BacktestModelPicker.tsx');
const hookPath = resolve(__dirname, '..', '..', 'hooks', 'useLstmCombinatorData.ts');
const typePath = resolve(__dirname, '..', '..', 'types', 'combinator.ts');

const t = (key: string, opts?: Record<string, unknown>): string => (
  opts ? `${key}:${JSON.stringify(opts)}` : key
);

function version(overrides: Partial<LstmModelVersionUI> = {}): LstmModelVersionUI {
  return {
    id: 'v011_20260727T233448_n57',
    trainedAt: Date.UTC(2026, 6, 27, 23, 34),
    modelType: 'shared_encoder',
    signalCount: 57,
    meanValSharpe: 0.151,
    compatible: true,
    registration: 'registered',
    ...overrides,
  };
}

function manifest(
  versions: LstmModelVersionUI[],
  activeVersion: string | null,
): LstmModelManifestUI {
  return { activeVersion, versions };
}

describe('TICKET_1321 authoritative version semantics', () => {
  it('treats only N-locked LSTM variants as legacy', () => {
    expect(isLegacyModelVersion(version({ modelType: 'lstm' }))).toBe(true);
    expect(isLegacyModelVersion(version({ modelType: 'lstm_attention' }))).toBe(true);
    expect(isLegacyModelVersion(version({ modelType: 'shared_encoder' }))).toBe(false);
  });

  it('interprets absent pre-gate registration as registered', () => {
    expect(registrationOf(version({ registration: undefined }))).toBe('registered');
    expect(registrationOf(version({ registration: 'registered' }))).toBe('registered');
    expect(registrationOf(version({ registration: 'held' }))).toBe('held');
  });

  it('orders newest first with a deterministic id tie-break', () => {
    const older = version({ id: 'v001', trainedAt: 1 });
    const sameTimeA = version({ id: 'v002', trainedAt: 2 });
    const sameTimeB = version({ id: 'v003', trainedAt: 2 });
    expect(newestFirst([older, sameTimeA, sameTimeB]).map(item => item.id))
      .toEqual(['v003', 'v002', 'v001']);
  });

  it('does not mutate the authoritative manifest order', () => {
    const versions = [
      version({ id: 'v001', trainedAt: 1 }),
      version({ id: 'v002', trainedAt: 2 }),
    ];
    newestFirst(versions);
    expect(versions.map(item => item.id)).toEqual(['v001', 'v002']);
  });
});

describe('TICKET_1321 resting active-version summary', () => {
  it('renders one active summary and keeps retained history collapsed', () => {
    const active = version();
    const older = version({
      id: 'v010_20260726T120000_n57',
      modelType: 'lstm_attention',
      trainedAt: active.trainedAt - 1,
    });
    const html = renderToStaticMarkup(React.createElement(ModelVersionHistory, {
      manifest: manifest([older, active], active.id),
      onSelectVersion: () => undefined,
      t,
    }));

    expect(html).toContain('data-testid="lstm-active-version-summary"');
    expect(html).toContain(active.id);
    expect(html).toContain('signalFactory.currentModel');
    expect(html).toContain('signalFactory.viewVersionHistory');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('id="lstm-version-history"');
    expect(html).not.toContain(older.id);
  });

  it('distinguishes retained-without-active from never-trained state', () => {
    const retained = version({ id: 'v-held', registration: 'held' });
    const html = renderToStaticMarkup(React.createElement(ModelVersionHistory, {
      manifest: manifest([retained], null),
      onSelectVersion: () => undefined,
      t,
    }));

    expect(html).toContain('data-testid="lstm-no-active-version"');
    expect(html).toContain('role="status"');
    expect(html).toContain('signalFactory.noActiveVersion');
    expect(html).toContain('signalFactory.viewVersionHistory');
  });

  it('keeps a ten-version retention window behind one history disclosure', () => {
    const versions = Array.from({ length: 10 }, (_, index) => version({
      id: `v${String(index + 1).padStart(3, '0')}`,
      trainedAt: index + 1,
      registration: index % 2 === 0 ? 'registered' : 'held',
      compatible: index % 3 !== 0,
      modelType: index < 5 ? 'lstm_attention' : 'shared_encoder',
    }));
    const active = versions[9];
    const html = renderToStaticMarkup(React.createElement(ModelVersionHistory, {
      manifest: manifest(versions, active.id),
      onSelectVersion: () => undefined,
      t,
    }));

    expect(html).toContain(active.id);
    expect(html).toContain('&quot;count&quot;:10');
    expect(html).not.toContain('id="lstm-version-history"');
    expect(versions.slice(0, 9).every(item => !html.includes(item.id))).toBe(true);
  });
});

describe('TICKET_1321 version row identity, lifecycle, and accessibility', () => {
  it('uses the unique artifact id as the primary visible identity', () => {
    const item = version();
    const html = renderToStaticMarkup(React.createElement(ModelVersionRow, {
      version: item,
      isActive: false,
      currentSignalCount: 57,
      onSelect: () => undefined,
      t,
    }));

    expect(html).toContain(item.id);
    expect(html).toContain('SHARED_ENCODER');
    expect(html).toContain('signalFactory.versionDefaultVariant');
    expect(html).toContain('signalFactory.versionRowLabel');
  });

  it('shows active, held, incompatible, and legacy as textual states', () => {
    const item = version({
      id: 'v009',
      modelType: 'lstm_attention',
      compatible: false,
      registration: 'held',
      signalCount: 42,
    });
    const html = renderToStaticMarkup(React.createElement(ModelVersionRow, {
      version: item,
      isActive: true,
      currentSignalCount: 57,
      t,
    }));

    expect(html).toContain('signalFactory.active');
    expect(html).toContain('signalFactory.versionHeld');
    expect(html).toContain('signalFactory.versionIncompatibleState');
    expect(html).toContain('signalFactory.versionLegacy');
    expect(html).toContain('signalFactory.versionRosterMismatch');
    expect(html).toContain('&quot;trained&quot;:42');
    expect(html).toContain('&quot;current&quot;:57');
    expect(html).toContain('disabled=""');
  });

  it('keeps compatible non-active versions actionable', () => {
    const html = renderToStaticMarkup(React.createElement(ModelVersionRow, {
      version: version(),
      isActive: false,
      currentSignalCount: 57,
      onSelect: () => undefined,
      t,
    }));
    expect(html).not.toContain('disabled=""');
  });

  it('uses the generic incompatibility explanation when no active roster exists', () => {
    const html = renderToStaticMarkup(React.createElement(ModelVersionRow, {
      version: version({ compatible: false }),
      isActive: false,
      currentSignalCount: null,
      t,
    }));
    expect(html).toContain('signalFactory.versionIncompatible');
    expect(html).not.toContain('signalFactory.versionRosterMismatch');
  });
});

describe('TICKET_1321 cross-surface and ownership contracts', () => {
  it('projects registration from Main IPC into the Tier 0 UI contract', () => {
    const hook = readFileSync(hookPath, 'utf8');
    const types = readFileSync(typePath, 'utf8');
    expect(hook).toContain("registration?: 'registered' | 'held'");
    expect(hook).toContain('registration: v.registration');
    expect(types).toContain("registration?: 'registered' | 'held'");
  });

  it('uses the shared version presentation in both inline and picker surfaces', () => {
    const combinator = readFileSync(combinatorPath, 'utf8');
    const picker = readFileSync(pickerPath, 'utf8');
    expect(combinator).toContain('<ModelVersionHistory');
    expect(picker).toContain('<ModelVersionRow');
  });

  it('keeps transient disclosure state local and lifecycle state out of Renderer inference', () => {
    const component = readFileSync(componentPath, 'utf8');
    expect(component).toContain('useState(false)');
    expect(component).toContain('version.registration');
    expect(component).not.toContain('electronAPI');
    expect(component).not.toContain('maxVersions');
    expect(component).not.toContain('deleteVersion');
  });

  it('keeps snapshots outside version history', () => {
    const component = readFileSync(componentPath, 'utf8');
    const combinator = readFileSync(combinatorPath, 'utf8');
    expect(component).not.toContain('SavedSnapshotsSection');
    expect(combinator).toContain('<SavedSnapshotsSection');
  });

  it('keeps the never-trained state outside version management', () => {
    const combinator = readFileSync(combinatorPath, 'utf8');
    expect(combinator).toContain('modelManifest.versions.length > 0');
    expect(combinator).toContain("t('signalFactory.noLstmYet')");
  });
});
