/**
 * AuditReportPage Component
 *
 * TICKET_546 Phase 4A: Strategy audit report UI.
 * Displays recent audit list with star ratings.
 * TICKET_594: Removed model comparison table (low value, confusing UX).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FileBarChart, Star, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getIntlLocale } from '@shared/utils/format-locale';

// =============================================================================
// Types (matching preload API response shapes)
// =============================================================================

interface AuditListItem {
  id: number;
  algorithm_id: number;
  signal_source: string;
  llm_provider: string;
  llm_model: string;
  overall_score: number;
  star_rating: number;
  create_time: string;
}

// =============================================================================
// Constants
// =============================================================================

const STAR_COLORS: Record<number, string> = {
  5: 'text-green-400',
  4: 'text-blue-400',
  3: 'text-yellow-400',
  2: 'text-orange-400',
  1: 'text-red-400',
};

// =============================================================================
// Sub-component: StarRating
// =============================================================================

const StarRating: React.FC<{ rating: number }> = ({ rating }) => {
  const colorClass = STAR_COLORS[rating] || STAR_COLORS[1];
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={cn(
            'w-3 h-3',
            i < rating ? colorClass : 'text-white/10',
          )}
          fill={i < rating ? 'currentColor' : 'none'}
        />
      ))}
    </div>
  );
};

// =============================================================================
// Sub-component: RecentAuditsList
// =============================================================================

interface RecentAuditsListProps {
  data: AuditListItem[];
  isLoading: boolean;
}

const RecentAuditsList: React.FC<RecentAuditsListProps> = ({ data, isLoading }) => {
  const { t } = useTranslation('ui');
  const locale = getIntlLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-color-terminal-text-secondary terminal-mono text-xs animate-pulse">
          {t('common.loading')}
        </span>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <FileBarChart className="w-8 h-8 text-color-terminal-text-muted mb-2" />
        <p className="text-color-terminal-text-muted text-xs">
          {t('strategy.audit.noData')}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] terminal-mono">
        <thead>
          <tr className="border-b border-color-terminal-border">
            <th className="text-left py-2 px-3 text-color-terminal-text-secondary font-bold uppercase">
              {t('strategy.audit.colAlgorithm')}
            </th>
            <th className="text-left py-2 px-3 text-color-terminal-text-secondary font-bold uppercase">
              {t('strategy.audit.colSignalSource')}
            </th>
            <th className="text-left py-2 px-3 text-color-terminal-text-secondary font-bold uppercase">
              {t('strategy.audit.colProvider')}
            </th>
            <th className="text-left py-2 px-3 text-color-terminal-text-secondary font-bold uppercase">
              {t('strategy.audit.colModel')}
            </th>
            <th className="text-center py-2 px-3 text-color-terminal-text-secondary font-bold uppercase">
              {t('strategy.audit.colScore')}
            </th>
            <th className="text-center py-2 px-3 text-color-terminal-text-secondary font-bold uppercase">
              {t('strategy.audit.colRating')}
            </th>
            <th className="text-right py-2 px-3 text-color-terminal-text-secondary font-bold uppercase">
              {t('strategy.audit.colDate')}
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((item) => (
            <tr
              key={item.id}
              className="border-b border-white/5 hover:bg-white/5 transition-colors"
            >
              <td className="py-2 px-3 text-white font-bold">#{item.algorithm_id}</td>
              <td className="py-2 px-3 text-color-terminal-text-secondary">{item.signal_source}</td>
              <td className="py-2 px-3 text-color-terminal-text-secondary">{item.llm_provider}</td>
              <td className="py-2 px-3 text-color-terminal-text-secondary">{item.llm_model}</td>
              <td className="py-2 px-3 text-center font-bold text-color-terminal-accent-gold">
                {item.overall_score.toFixed(2)}
              </td>
              <td className="py-2 px-3 text-center">
                <StarRating rating={item.star_rating} />
              </td>
              <td className="py-2 px-3 text-right text-color-terminal-text-muted">
                {dateFormatter.format(new Date(item.create_time))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// =============================================================================
// Main Component
// =============================================================================

export const AuditReportPage: React.FC = () => {
  const { t } = useTranslation('ui');

  const [recentAudits, setRecentAudits] = useState<AuditListItem[]>([]);
  const [isLoadingAudits, setIsLoadingAudits] = useState(true);
  const [auditsExpanded, setAuditsExpanded] = useState(true);

  const fetchRecentAudits = useCallback(async () => {
    setIsLoadingAudits(true);
    try {
      const result = await window.electronAPI.audit.list({ limit: 50 });
      if (result.success && result.data) {
        setRecentAudits(result.data);
      }
    } catch (error) {
      console.error('[E:STRATEGY:FETCH_AUDITS_FAILED] Failed to fetch recent audits:', error);
    } finally {
      setIsLoadingAudits(false);
    }
  }, []);

  useEffect(() => {
    fetchRecentAudits();
  }, [fetchRecentAudits]);

  return (
    <div className="h-full flex flex-col terminal-theme bg-StratCraftsAI relative overflow-hidden">
      {/* Background elements */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-color-terminal-accent-gold/5 blur-[120px] pointer-events-none rounded-full" />
      <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-blue-500/5 blur-[100px] pointer-events-none rounded-full" />

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-10 z-10 custom-scrollbar">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Page Header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 rounded-lg border border-color-terminal-accent-gold/30 bg-black/40 text-color-terminal-accent-gold">
              <FileBarChart className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-sm font-black terminal-mono uppercase tracking-[0.2em] text-white">
                {t('strategy.audit.title')}
              </h1>
              <p className="text-[10px] text-color-terminal-text-muted mt-0.5">
                {t('strategy.audit.description')}
              </p>
            </div>
          </div>

          {/* Recent Audits Section */}
          <div className="border border-color-terminal-border rounded-lg bg-color-terminal-panel/30 backdrop-blur-md overflow-hidden">
            <button
              onClick={() => setAuditsExpanded(!auditsExpanded)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
            >
              <h2 className="text-xs font-bold terminal-mono uppercase tracking-wider text-color-terminal-accent-gold">
                {t('strategy.audit.recentAudits')}
              </h2>
              {auditsExpanded ? (
                <ChevronUp className="w-4 h-4 text-color-terminal-text-muted" />
              ) : (
                <ChevronDown className="w-4 h-4 text-color-terminal-text-muted" />
              )}
            </button>
            {auditsExpanded && (
              <div className="border-t border-color-terminal-border">
                <RecentAuditsList data={recentAudits} isLoading={isLoadingAudits} />
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.1);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(245, 158, 11, 0.2);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(245, 158, 11, 0.4);
        }
      `}</style>
    </div>
  );
};
