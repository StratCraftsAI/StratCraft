/**
 * TICKET_863_9_A -- Source commit SHA resolver.
 *
 * The signal-quality-audit writer stamps every audit row with the
 * commit SHA of the tier-rule code that produced it. When a tier-mapping
 * rule changes (a future schema_version bump or a threshold tweak), the
 * SHA lets readers tell "this audit row was produced by old rules; here
 * is a newer one from this run".
 *
 * Resolution order (first hit wins, then cached for process lifetime):
 *   1. process.env.GIT_COMMIT_SHA  -- CI / packaged builds inject this
 *   2. `git rev-parse HEAD`         -- development fallback only
 *   3. 'unknown'                    -- never throws
 *
 * Open question (TICKET_863_9_A line 278): should the git-fallback be
 * disabled in production builds? Today it is allowed everywhere because
 * `execSync` returning a non-zero exit just funnels into the 'unknown'
 * fallback -- packaged installs without a .git dir degrade safely.
 */

import { execSync } from 'child_process';
import { appLog } from './logger';
import { GIT_REV_PARSE_TIMEOUT_MS } from '../../shared/constants/timing';

let cachedSha: string | null = null;

const ENV_KEY = 'GIT_COMMIT_SHA';
const FALLBACK = 'unknown';

export function getSourceCommitSha(): string {
  if (cachedSha !== null) {
    return cachedSha;
  }

  const envSha = process.env[ENV_KEY];
  if (typeof envSha === 'string' && envSha.trim().length > 0) {
    cachedSha = envSha.trim();
    return cachedSha;
  }

  try {
    const out = execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_REV_PARSE_TIMEOUT_MS,
    }).trim();
    if (out.length > 0) {
      cachedSha = out;
      return cachedSha;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appLog.warn(
      `[source-commit-sha] git rev-parse fallback failed (using '${FALLBACK}'): ${msg}`,
    );
  }

  cachedSha = FALLBACK;
  return cachedSha;
}

/**
 * Reset the cached SHA. Tests only -- production code resolves once per
 * process lifetime and never invalidates.
 */
export function _resetSourceCommitShaCache(): void {
  cachedSha = null;
}
