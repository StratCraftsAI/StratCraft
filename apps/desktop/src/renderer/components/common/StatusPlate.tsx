/**
 * StatusPlate - Colored status indicator plate for header bars
 *
 * A variant of MiniNameplate with color variants for different statuses.
 * Used in BacktestResultPage to show execution status.
 *
 * @see TICKET_237 - Backtest Result Page Control Buttons
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { STATUS_PLATE_COLORS, NAMEPLATE_COLORS } from '@shared/constants/colors';
import { NAMEPLATE_FONT } from './nameplate-styles';

type StatusVariant = 'testing' | 'cancelled' | 'completed' | 'error';

interface StatusPlateProps {
  text: string;
  variant: StatusVariant;
  className?: string;
}

// Color configurations for each variant
const VARIANT_STYLES: Record<StatusVariant, {
  background: string;
  border: string;
  textColor: string;
  shadow: string;
}> = {
  testing: {
    background: `linear-gradient(180deg, ${NAMEPLATE_COLORS.PANEL_BORDER} 0%, ${NAMEPLATE_COLORS.SURFACE_BG} 100%)`,
    border: `1px solid ${STATUS_PLATE_COLORS.TESTING_BORDER}`,
    textColor: STATUS_PLATE_COLORS.TESTING,
    shadow: `0 2px 8px ${STATUS_PLATE_COLORS.TESTING_SHADOW}, inset 0 1px 0 ${STATUS_PLATE_COLORS.TESTING_SHADOW}`,
  },
  cancelled: {
    background: `linear-gradient(180deg, ${NAMEPLATE_COLORS.ERROR_BORDER} 0%, ${NAMEPLATE_COLORS.ERROR_BG} 100%)`,
    border: `1px solid ${STATUS_PLATE_COLORS.ERROR_BORDER}`,
    textColor: STATUS_PLATE_COLORS.ERROR,
    shadow: `0 2px 8px ${STATUS_PLATE_COLORS.ERROR_SHADOW}, inset 0 1px 0 ${STATUS_PLATE_COLORS.ERROR_SHADOW}`,
  },
  completed: {
    background: `linear-gradient(180deg, ${NAMEPLATE_COLORS.SUCCESS_BORDER} 0%, ${NAMEPLATE_COLORS.SUCCESS_BG} 100%)`,
    border: `1px solid ${STATUS_PLATE_COLORS.COMPLETED_BORDER}`,
    textColor: STATUS_PLATE_COLORS.COMPLETED,
    shadow: `0 2px 8px ${STATUS_PLATE_COLORS.COMPLETED_SHADOW}, inset 0 1px 0 ${STATUS_PLATE_COLORS.COMPLETED_SHADOW}`,
  },
  error: {
    background: `linear-gradient(180deg, ${NAMEPLATE_COLORS.ERROR_BORDER} 0%, ${NAMEPLATE_COLORS.ERROR_BG} 100%)`,
    border: `1px solid ${STATUS_PLATE_COLORS.ERROR_BORDER}`,
    textColor: STATUS_PLATE_COLORS.ERROR,
    shadow: `0 2px 8px ${STATUS_PLATE_COLORS.ERROR_SHADOW}, inset 0 1px 0 ${STATUS_PLATE_COLORS.ERROR_SHADOW}`,
  },
};

export const StatusPlate: React.FC<StatusPlateProps> = ({
  text,
  variant,
  className,
}) => {
  const styles = VARIANT_STYLES[variant];

  return (
    <div
      className={cn(
        'relative flex items-center justify-center px-4 py-0.5 rounded select-none',
        className
      )}
      style={{
        background: styles.background,
        border: styles.border,
        boxShadow: styles.shadow,
      }}
    >
      {/* Subtle glow effect */}
      <div
        className="absolute inset-0 opacity-30 pointer-events-none rounded"
        style={{
          background: `radial-gradient(ellipse at center, ${styles.textColor}20 0%, transparent 70%)`,
        }}
      />

      {/* Text */}
      <span
        className="relative z-10 text-[12px] font-black tracking-[0.2em] uppercase"
        style={{
          color: styles.textColor,
          textShadow: `0 0 8px ${styles.textColor}40`,
          fontFamily: NAMEPLATE_FONT,
        }}
      >
        {text}
      </span>
    </div>
  );
};

export default StatusPlate;
