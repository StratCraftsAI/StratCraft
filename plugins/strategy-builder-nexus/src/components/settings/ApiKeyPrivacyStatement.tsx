/**
 * ApiKeyPrivacyStatement - Privacy and security statement for API key storage
 *
 * TICKET_190: BYOK Guest Mode and API Key Privacy
 *
 * Displays clear privacy information about how API keys are stored,
 * following industry best practices (Cline, Continue, etc.).
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ShieldCheck,
  Lock,
  ServerOff,
  MonitorOff,
  Trash2,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react';
import { cn } from '../../lib/utils';

// =============================================================================
// Types
// =============================================================================

interface ApiKeyPrivacyStatementProps {
  /** Show in compact mode (collapsible) */
  compact?: boolean;
  /** Additional CSS classes */
  className?: string;
}

interface PrivacyItemConfig {
  icon: React.ElementType;
  itemKey: 'encrypted' | 'localOnly' | 'noSync' | 'fullControl';
}

// =============================================================================
// Privacy Items Configuration
// =============================================================================

const PRIVACY_ITEMS: PrivacyItemConfig[] = [
  { icon: Lock, itemKey: 'encrypted' },
  { icon: ServerOff, itemKey: 'localOnly' },
  { icon: MonitorOff, itemKey: 'noSync' },
  { icon: Trash2, itemKey: 'fullControl' },
];

// =============================================================================
// Component
// =============================================================================

export function ApiKeyPrivacyStatement({
  compact = false,
  className,
}: ApiKeyPrivacyStatementProps): JSX.Element {
  const { t } = useTranslation('strategy-builder');
  const [expanded, setExpanded] = useState(!compact);

  if (compact) {
    return (
      <div
        className={cn(
          'rounded-lg border border-white/10 bg-gradient-to-r from-color-terminal-accent-teal/5 to-transparent',
          className
        )}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between p-4 text-left"
        >
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-color-terminal-accent-teal" />
            <span className="font-medium">{t('apiKeyPrivacy.heading')}</span>
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {expanded && (
          <div className="px-4 pb-4 pt-0">
            <PrivacyContent />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-color-terminal-accent-teal/20 bg-gradient-to-r from-color-terminal-accent-teal/5 to-transparent p-4',
        className
      )}
    >
      <div className="flex items-center gap-3 mb-4">
        <ShieldCheck className="h-6 w-6 text-color-terminal-accent-teal" />
        <h3 className="text-lg font-semibold">{t('apiKeyPrivacy.heading')}</h3>
      </div>
      <PrivacyContent />
    </div>
  );
}

// =============================================================================
// Privacy Content (shared between compact and full modes)
// =============================================================================

function PrivacyContent(): JSX.Element {
  const { t } = useTranslation('strategy-builder');
  return (
    <div className="space-y-4">
      {/* Privacy Items */}
      <div className="grid gap-3">
        {PRIVACY_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.itemKey} className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5">
                <Icon className="h-4 w-4 text-color-terminal-accent-teal" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">
                  {t(`apiKeyPrivacy.items.${item.itemKey}.title`)}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t(`apiKeyPrivacy.items.${item.itemKey}.description`)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Industry Reference */}
      <div className="flex items-start gap-2 pt-3 border-t border-white/5">
        <Info className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          {t('apiKeyPrivacy.footer')}
        </p>
      </div>
    </div>
  );
}

export default ApiKeyPrivacyStatement;
