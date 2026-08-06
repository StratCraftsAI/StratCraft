/**
 * TICKET_1335_1 Phase 3 -- environment header, evidence, and the one action.
 *
 * D3/AC9: overall state, platform identity, and -- when `ready` -- the evidence
 * that backs the claim: the resolved interpreter, the last verification time,
 * the Pixi version, and the manifest/lock identity.
 *
 * D4/AC4: exactly ONE environment-level action is offered, chosen by
 * `selectPrimaryAction` from the shared state. Notably `failed` maps to REPAIR,
 * not install: a failed environment exists on disk and must be revalidated
 * against the same committed lock, whereas installing over it would skip
 * revalidation of the artifacts that are already there.
 *
 * AC5 -- WHY THERE IS NO CONFIRMATION DIALOG IN THIS FILE:
 * Install and Repair are confirmed local machine mutations, and the confirmation
 * is owned by Electron Main, which already renders a native
 * `dialog.showMessageBox()` with distinct install/repair copy and constructs the
 * single-use, `webContents.id`-bound `LocalMutationApproval` from what it
 * observed (`research-environment-approval.ts`). A renderer-side confirmation
 * step would be a SECOND consent surface whose result carries no authority --
 * the user would answer the same question twice, and the renderer's answer would
 * be discarded. The preload methods accept no argument precisely so that nothing
 * here can be mistaken for consent. When the human declines, the handler returns
 * `code: 'approval_declined'`, which the page reports as a notice rather than an
 * environment failure.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ResearchEnvironmentOperation,
  ResearchEnvironmentStatus,
} from '@StratCraft/types';

export interface EnvironmentSummaryProps {
  status: ResearchEnvironmentStatus;
  /** The one action for this state, or null when nothing is offerable. */
  primaryAction: ResearchEnvironmentOperation | null;
  /** True while an operation is in flight; the action is suppressed. */
  isBusy: boolean;
  onAction: (operation: ResearchEnvironmentOperation) => void;
}

const STATE_CLASS: Record<ResearchEnvironmentStatus['state'], string> = {
  ready: 'text-green-400 border-green-500/30 bg-green-500/10',
  failed: 'text-red-300 border-red-500/30 bg-red-500/10',
  installing: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10',
  repairing: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10',
  verifying: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10',
  uninstalling: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10',
  absent: 'text-gray-400 border-gray-500/30 bg-gray-500/10',
};

/** One `<dt>/<dd>` pair, omitted entirely when the service reported no value. */
function Fact({
  label,
  value,
  testId,
  mono = false,
}: {
  label: string;
  value: string | undefined;
  testId: string;
  mono?: boolean;
}): JSX.Element | null {
  if (!value) return null;
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd
        data-testid={testId}
        className={`text-gray-300 break-all ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </dd>
    </>
  );
}

export function EnvironmentSummary({
  status,
  primaryAction,
  isBusy,
  onAction,
}: EnvironmentSummaryProps): JSX.Element {
  const { t } = useTranslation('ui');

  return (
    <section
      data-testid="environment-summary"
      data-state={status.state}
      // AC11: a `<section>` is a landmark only when it has an accessible name.
      // Unnamed, it is skipped by screen-reader landmark navigation entirely,
      // which is how a keyboard user loses the ability to jump to the one
      // section holding the action.
      aria-label={t('researchEnvironment.regions.summary')}
      // TICKET_910 tier A (filled): the primary section of the page.
      className="border rounded-[6px] p-3 flex flex-col gap-3 border-[#233554] bg-[#112240]"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {/*
            AC11: the badge reads as a bare word ("Ready") to a screen reader,
            which does not say WHAT is ready. The colour supplies that context
            for a sighted user; `aria-label` supplies it for everyone else.
            Colour is never the sole carrier of meaning here -- the state word
            is always present as text.
          */}
          <span
            data-testid="environment-state"
            aria-label={t('researchEnvironment.a11y.environmentState', {
              state: t(`researchEnvironment.states.${status.state}`),
            })}
            className={`px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wide ${
              STATE_CLASS[status.state]
            }`}
          >
            {t(`researchEnvironment.states.${status.state}`)}
          </span>
          <span
            aria-label={t('researchEnvironment.a11y.platform', {
              platform: status.platform,
              architecture: status.architecture,
            })}
            className="text-[11px] text-gray-500 font-mono"
          >
            {status.platform}
            {'/'}
            {status.architecture}
          </span>
        </div>

        {/*
          Rendered only when there is an action to offer. An in-flight job is
          already doing the thing, and an unsupported platform offers nothing to
          click -- in both cases `selectPrimaryAction` returns null, so the page
          shows progress or the failure panel instead of a dead button.
        */}
        {primaryAction && !isBusy && (
          <button
            type="button"
            data-testid="environment-primary-action"
            data-operation={primaryAction}
            onClick={() => onAction(primaryAction)}
            className="px-3 py-1.5 rounded-[6px] border border-cyan-500/40 bg-cyan-500/10 text-[11px] text-cyan-200 hover:bg-cyan-500/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
          >
            {t(`researchEnvironment.actions.${primaryAction}`)}
          </button>
        )}
      </div>

      {/*
        AC10: stated on the page itself and not only inside the native dialog,
        so the guarantee is visible before the user commits to reading a modal.
      */}
      <p className="text-[11px] text-gray-400">
        {t('researchEnvironment.summary.liveWorkloadNotice')}
      </p>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        <Fact
          label={t('researchEnvironment.summary.interpreter')}
          value={status.interpreterPath}
          testId="environment-interpreter"
          mono
        />
        <Fact
          label={t('researchEnvironment.summary.lastVerified')}
          value={status.lastVerifiedAt}
          testId="environment-last-verified"
        />
        <Fact
          label={t('researchEnvironment.summary.pixiVersion')}
          value={status.pixiVersion}
          testId="environment-pixi-version"
          mono
        />
      </dl>

      {/*
        Lock identity is technical evidence rather than an everyday fact, so it
        lives in an expandable area (D3) -- present for anyone auditing which
        lock produced this environment, out of the way for everyone else.
      */}
      {(status.manifestSha256 || status.lockSha256) && (
        <details data-testid="environment-lock-identity">
          {/*
            A `<summary>` is keyboard-focusable by default, but the browser's
            default outline is invisible against this background -- AC11
            requires FOCUS INDICATION, not merely reachability, so the ring is
            supplied explicitly and matched to the action button's.
          */}
          <summary className="text-[11px] text-gray-400 cursor-pointer rounded-[6px] focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400">
            {t('researchEnvironment.summary.technicalDetails')}
          </summary>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] mt-2">
            <Fact
              label={t('researchEnvironment.summary.manifestHash')}
              value={status.manifestSha256}
              testId="environment-manifest-hash"
              mono
            />
            <Fact
              label={t('researchEnvironment.summary.lockHash')}
              value={status.lockSha256}
              testId="environment-lock-hash"
              mono
            />
          </dl>
        </details>
      )}
    </section>
  );
}

export default EnvironmentSummary;
