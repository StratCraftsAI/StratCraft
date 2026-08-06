/**
 * StatusDot - Reusable status indicator component
 * 
 * Displays color-coded status with optional pulse animation
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export type StatusType = 'running' | 'warning' | 'error' | 'idle' | 'online' | 'offline' | 'degraded';

interface StatusDotProps {
  status: StatusType;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const StatusDot: React.FC<StatusDotProps> = ({
  status,
  className,
  size = 'sm'
}) => {
  const { t } = useTranslation('ui');
  const sizeClasses = {
    sm: 'w-2 h-2',
    md: 'w-3 h-3',
    lg: 'w-4 h-4'
  };

  const statusColors: Record<StatusType, string> = {
    running: 'bg-color-terminal-accent-teal animate-pulse',
    online: 'bg-color-terminal-accent-teal animate-pulse',
    warning: 'bg-color-terminal-accent-gold',
    degraded: 'bg-color-terminal-accent-gold',
    error: 'bg-color-terminal-accent-red animate-pulse',
    offline: 'bg-color-terminal-accent-red',
    idle: 'bg-color-terminal-text-muted opacity-30'
  };

  return (
    <div 
      className={cn(
        'rounded-full',
        sizeClasses[size],
        statusColors[status],
        className
      )}
      title={t(`statusDot.${status}`, { defaultValue: status })}
    />
  );
};

export default StatusDot;
