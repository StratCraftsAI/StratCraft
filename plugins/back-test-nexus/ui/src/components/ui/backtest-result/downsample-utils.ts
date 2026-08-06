/**
 * TICKET_317/358: Large dataset rendering utilities
 * TICKET_383: Canonical definitions moved to Tier 0 (data-plugin), re-exported here.
 */

export {
  MAX_RENDER_POINTS,
  safeMinMax,
  downsampleOHLC,
  downsampleLTTB,
} from '@plugins/data-plugin/utils/downsample-utils';
