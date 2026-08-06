/** Structured progress owned by the shared research-environment operation. */
export interface ResearchEnvironmentWorkloadUpdate {
  jobId: string;
  state: 'admitted' | 'running' | 'completed' | 'failed';
  summary: string;
  fraction: number | null;
  pid: number | null;
  error?: string;
  updatedAt: string;
}

export const RESEARCH_ENV_PROBE_PROGRESS_PREFIX = '<<<STRATCRAFT_RESEARCH_PROBE_PROGRESS>>>';

const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const COUNT = /(?:\(|\b)(\d+)\s*\/\s*(\d+)(?:\)|\b)/;

/** Convert pixi terminal output into a stable stage without exposing raw logs. */
export function parsePixiProgressLine(line: string): Pick<ResearchEnvironmentWorkloadUpdate, 'summary' | 'fraction'> | null {
  const plain = line.replace(ANSI_ESCAPE, '').trim();
  const stage = /resolv/i.test(plain)
    ? 'Resolving dependencies'
    : /download|fetch/i.test(plain)
      ? 'Downloading packages'
      : /install|link/i.test(plain)
        ? 'Installing packages'
        : null;
  if (!stage) return null;
  const count = plain.match(COUNT);
  if (!count) return { summary: stage, fraction: null };
  const current = Number(count[1]);
  const total = Number(count[2]);
  return {
    summary: `${stage} (${current}/${total})`,
    fraction: total > 0 ? Math.min(1, current / total) : null,
  };
}

/** Parse the machine-framed per-capability marker emitted by the verifier. */
export function parseProbeProgressLine(line: string): Pick<ResearchEnvironmentWorkloadUpdate, 'summary' | 'fraction'> | null {
  if (!line.startsWith(RESEARCH_ENV_PROBE_PROGRESS_PREFIX)) return null;
  const fields = line.slice(RESEARCH_ENV_PROBE_PROGRESS_PREFIX.length).split(':');
  if (fields.length !== 3) return null;
  const current = Number(fields[0]);
  const total = Number(fields[1]);
  const capability = fields[2];
  if (!Number.isInteger(current) || !Number.isInteger(total) || current < 1 || total < current || !capability) return null;
  return {
    summary: `Verifying capabilities (${current}/${total}): ${capability}`,
    fraction: current / total,
  };
}
