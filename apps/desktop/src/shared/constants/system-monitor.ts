/**
 * System Monitor constants -- TICKET_1281.
 *
 * Single source of truth for the three long-running research workloads whose
 * per-workload CPU/mem/GPU the web-dashboard monitor panel attributes, and for
 * the systemd unit identity used to resolve each one. TICKET_179 (no magic
 * numbers) + TICKET_854 (code reuse): the LSTM unit prefix here is the same
 * string `lstm-training-service.ts` uses to name its transient units, imported
 * from this file so the collector and the launcher can never drift apart.
 */

/** Stable workload identifiers surfaced in WorkloadStats[].id and the UI. */
export type WorkloadId = 'sweep' | 'mining' | 'lstm' | 'research-env';

/**
 * TICKET_1281 D2: LSTM transient-unit name prefix. `lstm-training-service.ts`
 * names each run's `systemd-run --user` unit `${SYSTEMD_LSTM_UNIT_PREFIX}<runId>`;
 * the workload monitor globs `${SYSTEMD_LSTM_UNIT_PREFIX}*` to find the live one.
 */
export const SYSTEMD_LSTM_UNIT_PREFIX = 'stratcraft-lstm-train-' as const;

/**
 * How each workload's live systemd unit is resolved:
 *  - 'fixed'  -> a single, statically-named user unit (the sweep/mining chains).
 *  - 'prefix' -> a glob over `<unitPrefix>*` (LSTM: one transient unit per run).
 * `progressFile` is the persistent state sink read for the status/progress line
 * (never a stale `.log`; process-analysis methodology). null when none exists yet.
 */
export interface WorkloadDef {
  id: WorkloadId;
  /** i18n key suffix under `systemMonitor.workload.<key>`. */
  labelKey: string;
  resolve: 'fixed' | 'prefix';
  /** systemd --user unit name (resolve='fixed') or glob prefix (resolve='prefix'). */
  unit: string;
  progressFile: string | null;
}

/**
 * The three workloads. Unit names match the launcher scripts documented in the
 * reference launch commands (`catboost-sweep`, `factor-mining`) and the LSTM
 * training service's transient-unit prefix.
 */
export const WORKLOAD_DEFS: readonly WorkloadDef[] = [
  { id: 'sweep', labelKey: 'sweep', resolve: 'fixed', unit: 'catboost-sweep', progressFile: 'sweep-progress.json' },
  { id: 'mining', labelKey: 'mining', resolve: 'fixed', unit: 'factor-mining', progressFile: null },
  { id: 'lstm', labelKey: 'lstm', resolve: 'prefix', unit: SYSTEMD_LSTM_UNIT_PREFIX, progressFile: 'lstm-progress.json' },
] as const;

/** Timeout for each `systemctl`/`nvidia-smi` introspection call (ms). */
export const MONITOR_INTROSPECT_TIMEOUT_MS = 5_000;

/** Poll cadence for the system-monitor SSE + snapshot sampler (ms). Matches the
 *  existing 2s resource-monitor / SSE poll so CPU deltas line up. */
export const SYSTEM_MONITOR_POLL_INTERVAL_MS = 2_000;

/** TICKET_1301: default whole-system admission ceiling. */
export const WORKLOAD_ADMISSION_MAX_SYSTEM_PERCENT = 85;

/** TICKET_1301 / TICKET_1071: measured sweep peak RSS per concurrent worker. */
export const SWEEP_PER_WORKER_RSS_MB = 3_900;

/** TICKET_1301 / TICKET_1282: measured factor-mining single-process peak RSS. */
export const MINING_PEAK_RSS_MB = 27_000;

/** Conservative sweep geometry used by the cross-workload admission estimate. */
export const SWEEP_ADMISSION_CONCURRENCY = 6;

/** Keep recently-written progress rows visible after the unit exits. */
export const WORKLOAD_DETECTED_STALE_MINUTES = 30;

/** Duration for the terminal research-environment success row before removal. */
export const RESEARCH_ENV_WORKLOAD_COMPLETED_VISIBLE_MS = 5_000;

/** Linux USER_HZ used by /proc/<pid>/stat CPU accounting. */
export const LINUX_PROC_CLOCK_TICKS_PER_SECOND = 100;

/** Persistent queue is reconsidered independently of the 2s monitor cadence. */
export const WORKLOAD_QUEUE_POLL_INTERVAL_MS = 10_000;

/** Settings bounds for the cross-workload admission ceiling. */
export const WORKLOAD_ADMISSION_CEILING_MIN_PERCENT = 50;
export const WORKLOAD_ADMISSION_CEILING_MAX_PERCENT = 95;

/** Unknown running-workload estimates retain this much RSS headroom. */
export const UNKNOWN_RUNNING_WORKLOAD_HEADROOM_MULTIPLIER = 1.2;
