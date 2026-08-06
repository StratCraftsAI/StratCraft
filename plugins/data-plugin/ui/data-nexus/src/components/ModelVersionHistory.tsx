/**
 * TICKET_1321: Shared model-version presentation.
 *
 * Model lifecycle decisions remain owned by the Main-process manifest. This
 * component only presents that authoritative projection and emits a requested
 * activation; it never infers compatibility or registration from UI state.
 */

import React, { useMemo, useState } from 'react';
import type { LstmModelManifestUI, LstmModelVersionUI } from '../types/combinator';

type Translate = (key: string, opts?: Record<string, unknown>) => string;

export function isLegacyModelVersion(version: LstmModelVersionUI): boolean {
  return version.modelType === 'lstm' || version.modelType === 'lstm_attention';
}

export function registrationOf(version: LstmModelVersionUI): 'registered' | 'held' {
  return version.registration === 'held' ? 'held' : 'registered';
}

export function newestFirst(versions: LstmModelVersionUI[]): LstmModelVersionUI[] {
  return [...versions].sort((a, b) => {
    const timeOrder = b.trainedAt - a.trainedAt;
    return timeOrder !== 0 ? timeOrder : b.id.localeCompare(a.id);
  });
}

function formattedTrainingTime(trainedAt: number): string {
  return new Date(trainedAt).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function VersionStateBadges({
  version,
  isActive,
  t,
}: {
  version: LstmModelVersionUI;
  isActive: boolean;
  t: Translate;
}): JSX.Element {
  return (
    <span className="flex flex-wrap items-center gap-1" data-testid={`lstm-version-states-${version.id}`}>
      {isActive && (
        <span className="rounded border border-color-terminal-accent-teal/50 px-1 text-[9px] font-semibold uppercase text-color-terminal-accent-teal">
          {t('signalFactory.active')}
        </span>
      )}
      {registrationOf(version) === 'held' && (
        <span className="rounded border border-amber-500/40 px-1 text-[9px] font-semibold uppercase text-amber-300">
          {t('signalFactory.versionHeld')}
        </span>
      )}
      {!version.compatible && (
        <span className="rounded border border-red-500/40 px-1 text-[9px] font-semibold uppercase text-red-300">
          {t('signalFactory.versionIncompatibleState')}
        </span>
      )}
      {isLegacyModelVersion(version) && (
        <span className="rounded border border-color-terminal-border/50 px-1 text-[9px] font-semibold uppercase text-color-terminal-text-muted">
          {t('signalFactory.versionLegacy')}
        </span>
      )}
      {version.modelType === 'shared_encoder' && (
        <span className="rounded border border-blue-400/30 px-1 text-[9px] font-semibold uppercase text-blue-300">
          {t('signalFactory.versionDefaultVariant')}
        </span>
      )}
    </span>
  );
}

export interface ModelVersionRowProps {
  version: LstmModelVersionUI;
  isActive: boolean;
  currentSignalCount: number | null;
  onSelect?: () => void;
  t: Translate;
}

export function ModelVersionRow({
  version,
  isActive,
  currentSignalCount,
  onSelect,
  t,
}: ModelVersionRowProps): JSX.Element {
  const canSelect = version.compatible && !isActive && onSelect != null;
  const incompatibilityText = currentSignalCount == null
    ? t('signalFactory.versionIncompatible')
    : t('signalFactory.versionRosterMismatch', {
      trained: version.signalCount,
      current: currentSignalCount,
    });

  return (
    <button
      type="button"
      disabled={!canSelect}
      onClick={event => {
        event.stopPropagation();
        onSelect?.();
      }}
      title={!version.compatible ? incompatibilityText : version.id}
      aria-label={t('signalFactory.versionRowLabel', {
        id: version.id,
        modelType: version.modelType.toUpperCase(),
      })}
      className={[
        'w-full rounded border px-2.5 py-2 text-left transition-colors',
        isActive
          ? 'border-color-terminal-accent-teal/50 bg-color-terminal-accent-teal/10'
          : version.compatible
            ? 'border-color-terminal-border/30 bg-transparent'
            : 'border-red-500/25 bg-transparent',
        canSelect
          ? 'cursor-pointer hover:border-color-terminal-accent-teal/40 hover:bg-color-terminal-accent-teal/5'
          : 'cursor-default',
      ].join(' ')}
      data-testid={`lstm-version-row-${version.id}`}
    >
      <span className="flex min-w-0 items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate font-mono text-[10px] text-color-terminal-text" title={version.id}>
            {version.id}
          </span>
          <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-wide text-color-terminal-text-muted">
            {version.modelType.toUpperCase()}
          </span>
        </span>
        <VersionStateBadges version={version} isActive={isActive} t={t} />
      </span>
      <span className="mt-1.5 grid grid-cols-3 gap-2 text-[10px] text-color-terminal-text-muted">
        <span className={version.meanValSharpe >= 0 ? 'text-green-300' : 'text-red-300'}>
          {t('signalFactory.versionSharpe', { value: version.meanValSharpe.toFixed(4) })}
        </span>
        <span>{t('signalFactory.versionSignalCount', { count: version.signalCount })}</span>
        <span className="text-right">{formattedTrainingTime(version.trainedAt)}</span>
      </span>
      {!version.compatible && (
        <span className="mt-1 block text-[9px] text-red-300">
          {incompatibilityText}
        </span>
      )}
    </button>
  );
}

export interface ModelVersionHistoryProps {
  manifest: LstmModelManifestUI;
  onSelectVersion: (version: LstmModelVersionUI) => void;
  t: Translate;
}

export function ModelVersionHistory({
  manifest,
  onSelectVersion,
  t,
}: ModelVersionHistoryProps): JSX.Element {
  const [historyOpen, setHistoryOpen] = useState(false);
  const orderedVersions = useMemo(() => newestFirst(manifest.versions), [manifest.versions]);
  const activeVersion = manifest.versions.find(v => v.id === manifest.activeVersion) ?? null;
  const currentSignalCount = activeVersion?.signalCount ?? null;

  return (
    <section
      className="mt-3 border-t border-color-terminal-border/30 pt-3"
      data-testid="lstm-version-management"
      aria-label={t('signalFactory.modelVersionManagement')}
    >
      {activeVersion ? (
        <div data-testid="lstm-active-version-summary">
          <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-widest text-color-terminal-text-muted">
            {t('signalFactory.currentModel')}
          </div>
          <ModelVersionRow
            version={activeVersion}
            isActive
            currentSignalCount={currentSignalCount}
            t={t}
          />
        </div>
      ) : (
        <div
          role="status"
          className="rounded border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-[10px] text-amber-200"
          data-testid="lstm-no-active-version"
        >
          {t('signalFactory.noActiveVersion', { count: manifest.versions.length })}
        </div>
      )}

      <button
        type="button"
        className="mt-2 flex w-full items-center justify-between rounded border border-color-terminal-border/30 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-color-terminal-text-muted transition-colors hover:border-color-terminal-accent-teal/40 hover:text-color-terminal-text"
        aria-expanded={historyOpen}
        aria-controls="lstm-version-history"
        onClick={event => {
          event.stopPropagation();
          setHistoryOpen(open => !open);
        }}
        data-testid="lstm-version-history-toggle"
      >
        <span>{t('signalFactory.viewVersionHistory', { count: manifest.versions.length })}</span>
        <span aria-hidden="true">{historyOpen ? '\u2212' : '+'}</span>
      </button>

      {historyOpen && (
        <div
          id="lstm-version-history"
          className="mt-1.5 max-h-[240px] space-y-1 overflow-y-auto"
          data-testid="lstm-version-list"
        >
          {orderedVersions.map(version => {
            const isActive = version.id === manifest.activeVersion;
            return (
              <ModelVersionRow
                key={version.id}
                version={version}
                isActive={isActive}
                currentSignalCount={currentSignalCount}
                onSelect={
                  version.compatible && !isActive
                    ? () => onSelectVersion(version)
                    : undefined
                }
                t={t}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
