/**
 * MetalNameplate - Full-size metallic nameplate with logo and subtitle
 *
 * Used for prominent branding displays (e.g., NexusHubPage header).
 * Uses shared styles from nameplate-styles.ts
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  metalPlateStyle,
  noiseTextureStyle,
  shimmerStyle,
  engravedTextStyle,
  LARGE_PLATE_SHADOW,
} from './nameplate-styles';

interface MetalNameplateProps {
  title?: string;
  subtitle?: string;
  className?: string;
}

export const MetalNameplate: React.FC<MetalNameplateProps> = ({
  title = 'STRATCRAFT',
  subtitle,
  className,
}) => {
  const { t } = useTranslation('ui');
  const resolvedSubtitle = subtitle ?? t('brand.tagline');
  return (
    <div
      className={cn(
        'relative flex items-center justify-start p-5 overflow-hidden select-none',
        'w-full max-w-4xl ml-0 rounded-lg',
        className
      )}
      style={{
        ...metalPlateStyle,
        boxShadow: LARGE_PLATE_SHADOW,
      }}
    >
      {/* Heavy Grain Texture for "Sparkle" */}
      <div
        className="absolute inset-0 opacity-25 pointer-events-none mix-blend-overlay"
        style={noiseTextureStyle}
      />

      {/* Diagonal Shimmer Highlight */}
      <div
        className="absolute inset-0 opacity-50 pointer-events-none"
        style={shimmerStyle}
      />

      {/* Mounting Screws (Darker Steel) */}
      <div className="absolute top-2.5 left-2.5 w-2 h-2 rounded-full bg-zinc-400 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.5),0_1px_0_rgba(255,255,255,0.6)] border border-zinc-500 flex items-center justify-center">
        <div className="w-1 h-[1px] bg-zinc-600 rotate-45 transform" />
      </div>
      <div className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-zinc-400 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.5),0_1px_0_rgba(255,255,255,0.6)] border border-zinc-500 flex items-center justify-center">
        <div className="w-1 h-[1px] bg-zinc-600 rotate-12 transform" />
      </div>
      <div className="absolute bottom-2.5 left-2.5 w-2 h-2 rounded-full bg-zinc-400 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.5),0_1px_0_rgba(255,255,255,0.6)] border border-zinc-500 flex items-center justify-center">
        <div className="w-1 h-[1px] bg-zinc-600 -rotate-12 transform" />
      </div>
      <div className="absolute bottom-2.5 right-2.5 w-2 h-2 rounded-full bg-zinc-400 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.5),0_1px_0_rgba(255,255,255,0.6)] border border-zinc-500 flex items-center justify-center">
        <div className="w-1 h-[1px] bg-zinc-600 -rotate-45 transform" />
      </div>

      {/* Icon Section (Engraved Look) */}
      <div className="relative z-10 mr-5 flex-shrink-0 ml-3 mt-1.5">
        <img
          src="/images/logo/stratcraft_icon.png"
          alt="StratCraft"
          className="object-contain"
          style={{
            width: '60px',
            height: '60px',
            filter: 'drop-shadow(0px 1px 0px rgba(255,255,255,0.6))',
            opacity: 1,
          }}
        />
      </div>

      {/* Text Section */}
      <div className="flex flex-col items-start justify-start z-10 gap-1">
        {/* Main Title */}
        <h1
          className="text-2xl md:text-3xl font-black tracking-[0.15em] leading-none"
          style={engravedTextStyle}
        >
          {title}
        </h1>

        {/* Separator Line */}
        <div className="w-full h-[1px] bg-zinc-500 shadow-[0_1px_0_rgba(255,255,255,0.4)] opacity-60" />

        {/* Subtitle / Slogan */}
        <p
          className="text-[12px] font-bold tracking-[0.4em] uppercase leading-none pl-6"
          style={engravedTextStyle}
        >
          {resolvedSubtitle}
        </p>
      </div>
    </div>
  );
};

export default MetalNameplate;
