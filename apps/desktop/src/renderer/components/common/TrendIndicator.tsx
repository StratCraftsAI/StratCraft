/**
 * TrendIndicator - Display trend direction and percentage change
 * 
 * Shows up/down arrows with color-coded percentage
 */

import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TrendIndicatorProps {
  value: number; // Percentage change (positive or negative)
  className?: string;
  showValue?: boolean;
}

export const TrendIndicator: React.FC<TrendIndicatorProps> = ({ 
  value, 
  className,
  showValue = true
}) => {
  const isPositive = value > 0;
  const isNeutral = value === 0;

  const Icon = isNeutral ? Minus : isPositive ? TrendingUp : TrendingDown;
  const colorClass = isNeutral 
    ? 'text-color-terminal-text-muted' 
    : isPositive 
      ? 'text-green-400' 
      : 'text-color-terminal-accent-red';

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Icon className={cn('w-3 h-3', colorClass)} />
      {showValue && (
        <span className={cn('text-xs font-bold', colorClass)}>
          {isPositive && '+'}
          {value.toFixed(1)}%
        </span>
      )}
    </div>
  );
};

export default TrendIndicator;
