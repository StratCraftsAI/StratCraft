import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { ShieldAlert } from 'lucide-react';

export interface AccessGateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  ctaLabel: string;
  ctaIcon?: LucideIcon;
  onAction: () => void;
  testId?: string;
}

export const AccessGate: React.FC<AccessGateProps> = ({
  icon: Icon = ShieldAlert,
  title,
  description,
  ctaLabel,
  ctaIcon: CtaIcon,
  onAction,
  testId = 'access-gate',
}) => (
  <div
    data-testid={testId}
    className="flex flex-col items-center justify-center py-20 px-6 text-center"
  >
    <Icon className="w-14 h-14 mb-5 text-amber-500 opacity-60" />
    <h3 className="text-lg font-semibold text-color-terminal-text mb-2">
      {title}
    </h3>
    <p className="text-color-terminal-text-secondary mb-6 max-w-md leading-relaxed">
      {description}
    </p>
    <button
      onClick={onAction}
      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md
                 bg-amber-500/20 text-amber-400
                 hover:bg-amber-500/30 transition-colors
                 border border-amber-500/30"
    >
      {CtaIcon && <CtaIcon className="w-4 h-4" />}
      {ctaLabel}
    </button>
  </div>
);
