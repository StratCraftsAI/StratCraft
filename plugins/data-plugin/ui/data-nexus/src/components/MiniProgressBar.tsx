/**
 * TICKET_077_31: MiniProgressBar (Tier 0 shared).
 */

import React from 'react';

export const MiniProgressBar: React.FC<{
  current: number;
  total: number;
  label: string;
}> = ({ current, total, label }) => {
  const pct = total > 0 ? Math.min((current / total) * 100, 100) : 0;
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px] text-color-terminal-text-muted">
        <span>{label}</span>
        <span>{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-color-terminal-border/40 overflow-hidden">
        <div
          className="h-full rounded-full bg-color-terminal-accent-teal transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};
