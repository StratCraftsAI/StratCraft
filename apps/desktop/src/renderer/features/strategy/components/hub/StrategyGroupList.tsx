/**
 * StrategyGroupList Component (Level 3)
 * 
 * Efficient Table view for managing generator lists.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Square, Settings2, Trash2, LineChart } from 'lucide-react';

export const StrategyGroupList: React.FC = () => {
  const { t } = useTranslation('ui');
  // TICKET_786_6 Phase 3: demo placeholder data; replace when wired to real strategy registry.
  const generators = [
    { id: 'GEN-001', name: t('strategy.hub.demo.generators.regimeTrendX1'), status: 'running', pnl: '+12.4%', cpu: '4%', lastRun: t('strategy.hub.demo.lastRun.twoMinAgo') },
    { id: 'GEN-002', name: t('strategy.hub.demo.generators.volAdaptiveBeta'), status: 'idle', pnl: '-2.1%', cpu: '0%', lastRun: t('strategy.hub.demo.lastRun.oneHourAgo') },
    { id: 'GEN-003', name: t('strategy.hub.demo.generators.crossSessArbitrage'), status: 'running', pnl: '+5.8%', cpu: '8%', lastRun: t('strategy.hub.demo.lastRun.active') },
    { id: 'GEN-004', name: t('strategy.hub.demo.generators.cnnSentimentAlpha'), status: 'error', pnl: '---', cpu: '0%', lastRun: t('strategy.hub.demo.lastRun.failed') },
    { id: 'GEN-005', name: t('strategy.hub.demo.generators.highFreqScalperV4'), status: 'running', pnl: '+1.2%', cpu: '15%', lastRun: t('strategy.hub.demo.lastRun.active') },
  ];

  return (
    <div className="flex flex-col h-full terminal-theme">
      {/* Group Header */}
      <div className="px-6 py-4 border-b border-color-terminal-border flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold terminal-mono">{t('strategy.groupList.groupTitle')}</h2>
          <p className="text-[10px] text-color-terminal-text-secondary uppercase mt-1">{t('strategy.groupList.providerRegion')}</p>
        </div>
        <div className="flex gap-2">
          <button className="px-3 py-1 bg-color-terminal-accent-teal text-color-terminal-bg text-[10px] font-bold rounded uppercase">{t('strategy.groupList.runAll')}</button>
          <button className="px-3 py-1 border border-color-terminal-border text-[10px] font-bold rounded uppercase">{t('strategy.groupList.configPack')}</button>
        </div>
      </div>

      {/* Grid Content */}
      <div className="flex-1 overflow-auto">
        <table className="terminal-grid">
          <thead>
            <tr>
              <th className="w-10">{t('strategy.groupList.colId')}</th>
              <th>{t('strategy.groupList.colName')}</th>
              <th className="w-24">{t('strategy.groupList.colStatus')}</th>
              <th className="w-24">{t('strategy.groupList.col7dPnl')}</th>
              <th className="w-20">{t('strategy.groupList.colCpu')}</th>
              <th className="w-24">{t('strategy.groupList.colLastActivity')}</th>
              <th className="w-32 text-right">{t('strategy.groupList.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {generators.map((gen) => (
              <tr key={gen.id}>
                <td className="terminal-mono text-color-terminal-text-secondary">{gen.id}</td>
                <td className="font-bold">{gen.name}</td>
                <td>
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    gen.status === 'running' ? 'bg-teal-500/10 text-color-terminal-accent-teal' :
                    gen.status === 'error' ? 'bg-red-500/10 text-color-terminal-accent-red' :
                    'bg-white/5 text-color-terminal-text-secondary'
                  }`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${
                      gen.status === 'running' ? 'bg-color-terminal-accent-teal shadow-[0_0_5px_currentColor] animate-pulse' :
                      gen.status === 'error' ? 'bg-color-terminal-accent-red' :
                      'bg-color-terminal-text-secondary opacity-50'
                    }`}></div>
                    {gen.status}
                  </span>
                </td>
                <td className={`terminal-mono ${gen.pnl.startsWith('+') ? 'text-color-terminal-accent-teal' : gen.pnl.startsWith('-') ? 'text-color-terminal-accent-red' : ''}`}>
                  {gen.pnl}
                </td>
                <td className="terminal-mono">{gen.cpu}</td>
                <td className="text-[11px] text-color-terminal-text-secondary">{gen.lastRun}</td>
                <td className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button className="p-1.5 text-color-terminal-text-secondary hover:text-color-terminal-accent-teal transition-colors">
                      {gen.status === 'running' ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    </button>
                    <button className="p-1.5 text-color-terminal-text-secondary hover:text-color-terminal-accent-gold transition-colors">
                      <LineChart className="w-3.5 h-3.5" />
                    </button>
                    <button className="p-1.5 text-color-terminal-text-secondary hover:text-white transition-colors">
                      <Settings2 className="w-3.5 h-3.5" />
                    </button>
                    <button className="p-1.5 text-color-terminal-text-secondary hover:text-color-terminal-accent-red transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
