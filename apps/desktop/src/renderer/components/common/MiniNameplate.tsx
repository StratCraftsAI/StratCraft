/**
 * MiniNameplate - Compact metallic nameplate for header bars
 *
 * A smaller version of MetalNameplate for use in BreadcrumbBar or similar.
 * Uses shared styles from nameplate-styles.ts
 */

import React from 'react';
import { cn } from '@/lib/utils';
import {
  metalPlateStyle,
  noiseTextureStyle,
  shimmerStyle,
  engravedTextStyle,
  MINI_PLATE_SHADOW,
} from './nameplate-styles';

interface MiniNameplateProps {
  text: string;
  className?: string;
}

export const MiniNameplate: React.FC<MiniNameplateProps> = ({
  text,
  className,
}) => {
  return (
    <div
      className={cn(
        'relative flex items-center justify-center px-4 py-0.5 rounded select-none',
        className
      )}
      style={{
        ...metalPlateStyle,
        boxShadow: MINI_PLATE_SHADOW,
      }}
    >
      {/* Subtle grain texture */}
      <div
        className="absolute inset-0 opacity-20 pointer-events-none mix-blend-overlay rounded"
        style={noiseTextureStyle}
      />

      {/* Shimmer highlight */}
      <div
        className="absolute inset-0 opacity-40 pointer-events-none rounded"
        style={shimmerStyle}
      />

      {/* Text */}
      <span
        className="relative z-10 text-[12px] font-black tracking-[0.2em] uppercase"
        style={engravedTextStyle}
      >
        {text}
      </span>
    </div>
  );
};

export default MiniNameplate;
