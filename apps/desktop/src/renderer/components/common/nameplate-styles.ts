/**
 * Shared styles for metallic nameplate components
 *
 * Used by: MetalNameplate, MiniNameplate
 */

import React from 'react';
import { GRAY_SCALE } from '@shared/constants/colors';

// =============================================================================
// Background Styles
// =============================================================================

/** Brushed steel background gradient */
export const METAL_BACKGROUND = `
  repeating-linear-gradient(
    115deg,
    ${GRAY_SCALE.GRAY_150} 0%,
    ${GRAY_SCALE.GRAY_300} 5%,
    ${GRAY_SCALE.GRAY_75} 10%,
    ${GRAY_SCALE.GRAY_300} 15%,
    ${GRAY_SCALE.GRAY_150} 20%
  ),
  linear-gradient(
    180deg,
    ${GRAY_SCALE.GRAY_400} 0%,
    ${GRAY_SCALE.WHITE} 40%,
    ${GRAY_SCALE.GRAY_200} 100%
  )
`;

/** Background blend mode for metal effect */
export const METAL_BLEND_MODE = 'hard-light';

/** Border color for metal plates */
export const METAL_BORDER = `1px solid ${GRAY_SCALE.GRAY_500}`;

// =============================================================================
// Texture Overlays
// =============================================================================

/** SVG noise texture for metallic grain/sparkle effect */
export const NOISE_TEXTURE_URL = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.5' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%' height='100%' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`;

/** Diagonal shimmer highlight gradient */
export const SHIMMER_GRADIENT = 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.8) 45%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0.8) 55%, transparent 60%)';

// =============================================================================
// Text Styles
// =============================================================================

/** Engraved text gradient */
export const ENGRAVED_TEXT_GRADIENT = `linear-gradient(180deg, ${GRAY_SCALE.GRAY_800} 0%, ${GRAY_SCALE.GRAY_900} 100%)`;

/** Text shadow for engraved effect */
export const ENGRAVED_TEXT_SHADOW = '0px 1px 0px rgba(255,255,255,0.5)';

/** Font family for nameplate text */
export const NAMEPLATE_FONT = '"Inter", system-ui, -apple-system, sans-serif';

// =============================================================================
// Shadow Presets
// =============================================================================

/** Box shadow for large nameplate */
export const LARGE_PLATE_SHADOW = `
  0 10px 20px rgba(0, 0, 0, 0.4),
  inset 0 1px 0 rgba(255, 255, 255, 0.9),
  inset 0 -2px 0 rgba(0, 0, 0, 0.3)
`;

/** Box shadow for mini nameplate */
export const MINI_PLATE_SHADOW = `
  0 2px 4px rgba(0, 0, 0, 0.3),
  inset 0 1px 0 rgba(255, 255, 255, 0.9),
  inset 0 -1px 0 rgba(0, 0, 0, 0.2)
`;

// =============================================================================
// Composite Style Objects
// =============================================================================

/** Base container style for metal plates */
export const metalPlateStyle: React.CSSProperties = {
  background: METAL_BACKGROUND,
  backgroundBlendMode: METAL_BLEND_MODE,
  border: METAL_BORDER,
};

/** Noise texture overlay style */
export const noiseTextureStyle: React.CSSProperties = {
  backgroundImage: NOISE_TEXTURE_URL,
};

/** Shimmer highlight overlay style */
export const shimmerStyle: React.CSSProperties = {
  background: SHIMMER_GRADIENT,
  mixBlendMode: 'soft-light',
};

/** Engraved text style */
export const engravedTextStyle: React.CSSProperties = {
  background: ENGRAVED_TEXT_GRADIENT,
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
  textShadow: ENGRAVED_TEXT_SHADOW,
  fontFamily: NAMEPLATE_FONT,
};
