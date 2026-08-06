/**
 * TICKET_077_31 / TICKET_998: Fit-Quality Gauge (Tier 0 shared).
 *
 * N-zone pipeline bar showing model fit quality.
 * Pure presentation -- depends only on lstm-fit-quality-contract (pure module).
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  assessFitQuality,
  getZoneColor,
  DEFAULT_CONFIG,
  type FitQualityConfig,
} from '../contracts/lstm-fit-quality-contract';

const FIT_CONFIG: FitQualityConfig = DEFAULT_CONFIG;

export const FitQualityGauge: React.FC<{
  perFoldSharpes: number[] | null;
  meanValSharpe: number | null;
  sampleCount?: number | null;
  modelParamCount?: number | null;
  live?: boolean;
}> = ({ perFoldSharpes, meanValSharpe, sampleCount, modelParamCount, live }) => {
  const { t } = useTranslation('data');
  const fit = useMemo(
    () => assessFitQuality(FIT_CONFIG, perFoldSharpes, meanValSharpe, sampleCount, modelParamCount),
    [perFoldSharpes, meanValSharpe, sampleCount, modelParamCount],
  );
  const colors = getZoneColor(FIT_CONFIG, fit.zone);

  const ds = fit.dataSufficiency;
  const dsFillPct = ds ? Math.min(100, (ds.ratio / ds.targetRatio) * 100) : 0;
  const dsColor = ds
    ? ds.ratio >= ds.targetRatio ? 'rgba(34,197,94,0.8)' : ds.ratio >= 1.0 ? 'rgba(249,115,22,0.8)' : 'rgba(239,68,68,0.8)'
    : 'transparent';

  return (
    <div className="space-y-1.5">
      {ds && (
        <div className="space-y-1 mb-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-color-terminal-text-muted uppercase tracking-wide">
              {t('fitQuality.dataSufficiency')}
            </span>
            <span className="text-[10px] font-mono" style={{ color: dsColor }}>
              {dsFillPct.toFixed(1)}%&nbsp;&nbsp;({ds.sampleCount.toLocaleString()} / {ds.modelParamCount.toLocaleString()})
            </span>
          </div>
          <div className="relative h-2 rounded-full overflow-hidden bg-white/5">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${dsFillPct}%`, backgroundColor: dsColor }}
            />
          </div>
          <div className="text-[9px] text-color-terminal-text-muted font-mono">
            {t('fitQuality.needRatio', { targetRatio: ds.targetRatio, currentRatio: ds.ratio.toFixed(2) })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-color-terminal-text-muted uppercase tracking-wide">
          {t('fitQuality.modelFitQuality')}
        </span>
        <span className="text-[10px] font-semibold font-mono" style={{ color: colors.text }}>
          {t(fit.label)}
          {live && (
            <svg className="inline w-2.5 h-2.5 ml-1 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          )}
        </span>
      </div>

      <div className="relative h-3 rounded-full overflow-hidden flex">
        {FIT_CONFIG.zones.map((zone, i) => (
          <div
            key={zone.id}
            className="h-full"
            style={{
              width: `${zone.barWidthPercent}%`,
              backgroundColor: zone.color.bar,
              borderRight: i < FIT_CONFIG.zones.length - 1 ? `1px solid ${zone.color.border}` : undefined,
            }}
          />
        ))}
        <div
          className="absolute top-0 h-full w-1 rounded-full transition-all duration-500"
          style={{
            left: `${fit.position}%`,
            transform: 'translateX(-50%)',
            backgroundColor: colors.marker,
            boxShadow: `0 0 6px ${colors.glow}`,
          }}
        />
      </div>

      <div className="flex text-[9px]">
        {FIT_CONFIG.zones.map(zone => (
          <span
            key={zone.id}
            className="text-center"
            style={{ width: `${zone.barWidthPercent}%`, color: zone.color.text, opacity: 0.6 }}
          >
            {zone.label.toUpperCase()}
          </span>
        ))}
      </div>

      <div className="text-[10px] text-color-terminal-text-muted font-mono">{t(fit.detail, fit.detailParams)}</div>

      {perFoldSharpes && perFoldSharpes.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {perFoldSharpes.map((s, i) => (
            <span
              key={i}
              className={`font-mono px-1.5 py-0.5 rounded text-[9px] border ${
                s >= 0
                  ? 'border-green-700/30 bg-green-900/20 text-green-300'
                  : 'border-red-700/30 bg-red-900/20 text-red-300'
              }`}
            >
              F{i + 1}: {s.toFixed(3)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
