/**
 * Distribution Constants
 *
 * TICKET_631 Phase 4.1 / TICKET_635: Distribution Detection Flag System
 *
 * Runtime detection of public release vs full (development) release.
 * The public repo's package.json contains "distribution": "public" (injected by publish-community.sh).
 * The development repo has no distribution field, defaulting to 'full'.
 */

export type DistributionType = 'public' | 'full';

/** The package.json field name that stores the distribution type */
export const DISTRIBUTION_FIELD = 'distribution';

/** Default distribution when no field is present (development repo) */
export const DEFAULT_DISTRIBUTION: DistributionType = 'full';

/** Valid distribution values */
export const VALID_DISTRIBUTIONS: readonly DistributionType[] = ['public', 'full'] as const;
