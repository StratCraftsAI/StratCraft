/**
 * TICKET_1335_1 Phase 3 -- durable job progress (D5).
 *
 * Read-only by construction: current stage, elapsed time, and the bounded,
 * already-redacted log tail. There is no input, no command entry, and no
 * embedded terminal (D4 non-goal) -- the log tail is text the service produced,
 * not a channel back into it.
 *
 * NO MANUFACTURED PERCENTAGES (D5):
 * Pixi does not report a measurable denominator for a solve-and-download, so
 * there is no honest total to divide by. A progress bar here would have to
 * invent one, and an invented bar that sits at 90% for ten minutes is worse than
 * no bar: it makes a working install look hung. Stage plus elapsed time is what
 * the service actually knows, so it is what this renders.
 *
 * WHY OPERATION IDENTITY COMES FROM THE JOB (AC6a):
 * The heading names `job.operation`, which the service reports, rather than
 * whichever button this renderer last saw pressed. After a renderer reload
 * during a repair there IS no remembered button, and a repair relabelled as an
 * installation is precisely the defect AC6a names.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResearchEnvironmentJob } from '@StratCraft/types';
import { RESEARCH_ENVIRONMENT_JOB_POLL_MS } from '@shared/constants/timing';
import { formatElapsed, jobElapsedMs } from '../presentation';

export interface EnvironmentJobProgressProps {
  job: ResearchEnvironmentJob;
}

/**
 * Elapsed time for one job, frozen once the job is terminal.
 *
 * The ticking interval reuses the job poll cadence rather than introducing a
 * second timing constant (TICKET_179): a display that refreshes faster than the
 * data behind it would only animate stale values.
 */
function useElapsed(job: ResearchEnvironmentJob): string | null {
  const terminal = job.state === 'succeeded' || job.state === 'failed';
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (terminal || !job.startedAt) return undefined;
    const id = setInterval(() => setNow(Date.now()), RESEARCH_ENVIRONMENT_JOB_POLL_MS);
    return () => clearInterval(id);
  }, [terminal, job.startedAt]);

  const elapsed = jobElapsedMs(job, now);
  return elapsed === null ? null : formatElapsed(elapsed);
}

export function EnvironmentJobProgress({
  job,
}: EnvironmentJobProgressProps): JSX.Element {
  const { t } = useTranslation('ui');
  const elapsed = useElapsed(job);
  const logTail = job.logTail ?? [];
  const headingId = 'environment-job-progress-heading';

  return (
    <section
      data-testid="environment-job-progress"
      data-operation={job.operation}
      data-job-state={job.state}
      // AC11/AC6a: named from the heading, which names the OPERATION the
      // service reports. A screen-reader user arriving mid-repair therefore
      // hears "Repair progress", not an unnamed region.
      aria-labelledby={headingId}
      // TICKET_910 tier B (outline): follows the filled summary above it.
      className="border rounded-[6px] p-3 flex flex-col gap-2 border-[#233554]"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 id={headingId} className="text-[12px] font-semibold text-gray-200">
          {t(`researchEnvironment.progress.${job.operation}`)}
        </h2>
        {elapsed && (
          <span
            data-testid="job-elapsed"
            // A bare `03:41` is meaningless read aloud out of context.
            aria-label={t('researchEnvironment.a11y.elapsed', { elapsed })}
            className="text-[11px] text-gray-500 font-mono"
          >
            {elapsed}
          </span>
        )}
      </div>

      {/*
        Announced politely: a multi-minute install advancing a stage is worth
        hearing without stealing focus from whatever the user is doing (AC11).
      */}
      <p
        aria-live="polite"
        data-testid="job-current-stage"
        className="text-[11px] text-gray-300"
      >
        {job.currentStage
          ? t(`researchEnvironment.stages.${job.currentStage}`)
          : t(`researchEnvironment.jobStates.${job.state}`)}
      </p>

      {logTail.length > 0 && (
        <pre
          data-testid="job-log-tail"
          // `tabIndex` because a scrollable region must be reachable without a
          // mouse; `role="log"` names what the region is to a screen reader.
          //
          // AC11: a focusable element with no visible focus ring is a keyboard
          // trap in practice -- the user tabs into it and cannot see where they
          // are. The ring matches the action button's.
          tabIndex={0}
          role="log"
          aria-label={t('researchEnvironment.a11y.logTail')}
          className="max-h-48 overflow-auto bg-black/40 border border-[#233554] rounded-[6px] p-2 text-[10px] font-mono text-gray-400 whitespace-pre-wrap focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
        >
          {logTail.join('\n')}
        </pre>
      )}
    </section>
  );
}

export default EnvironmentJobProgress;
