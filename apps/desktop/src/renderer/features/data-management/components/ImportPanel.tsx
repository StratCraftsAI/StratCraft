/**
 * ImportPanel - BYOD package import UI (TICKET_308 / TICKET_308_3_3)
 *
 * Two sections:
 *  1. Imported Packages List (click to expand -> symbol/interval detail)
 *  2. Data Package Import (select -> preview -> confirm -> progress)
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Upload, Database, Loader2, FolderOpen, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, Trash2, RefreshCw, HeartPulse, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Z_INDEX_MODAL } from '@shared/constants/z-index';
import {
  useImportPackage,
  type ImportAdjustMode,
} from '../hooks/useImportPackage';
import { PackageNameModal } from './PackageNameModal';
import {
  IMPORTED_ARCHIVAL_CADENCES,
  type ArchivalCadence,
} from '@shared/constants/data-import';
import { useDataManagementStore } from '../useDataManagementStore';

const ADJUST_MODES: ImportAdjustMode[] = ['none', 'qfq', 'hfq'];

const FIELD_CLASS =
  'h-9 px-3 rounded border border-white/15 bg-white/5 text-sm text-white/90 ' +
  'focus:outline-none focus:ring-1 focus:ring-cyan-400/60 focus:border-cyan-400/60';

const BTN_ENABLED =
  'inline-flex items-center gap-2 h-9 px-4 rounded text-sm font-medium transition-colors ' +
  'bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30';
const BTN_DISABLED =
  'inline-flex items-center gap-2 h-9 px-4 rounded text-sm font-medium ' +
  'bg-white/5 text-white/30 cursor-not-allowed';

interface ScanResult {
  packageName: string;
  sourceDialect: string;
  symbols: string[];
  intervals: string[];
  fileCount: number;
  totalSizeBytes: number;
  validationErrors: Array<{ file?: string; field?: string; message: string }>;
}

interface PackageFileInfo {
  symbol: string;
  interval: string;
  firstTimestamp: number;
  lastTimestamp: number;
  rowCount: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatEpoch(epoch: number): string {
  if (!epoch) return '-';
  const d = new Date(epoch * 1000);
  return d.toISOString().slice(0, 10);
}

export const ImportPanel: React.FC = () => {
  const { t } = useTranslation('ui');
  const { packages, refreshPackages, removePackage, checkPackageHealth } = useImportPackage();

  // --- Data package import state (3-phase: select -> preview -> import) ---
  const importDraft = useDataManagementStore((s) => s.importForm);
  const setImportDraft = useDataManagementStore((s) => s.setImportDraft);
  const resetImportDraft = useDataManagementStore((s) => s.resetImportDraft);
  const { pkgSourcePath, pkgName, pkgAdjustMode, pkgArchivalCadence } = importDraft;
  const setPkgSourcePath = useCallback((v: string | null) => setImportDraft({ pkgSourcePath: v }), [setImportDraft]);
  const setPkgName = useCallback((v: string) => setImportDraft({ pkgName: v }), [setImportDraft]);
  const setPkgAdjustMode = useCallback((v: ImportAdjustMode) => setImportDraft({ pkgAdjustMode: v }), [setImportDraft]);
  const setPkgArchivalCadence = useCallback((v: ArchivalCadence) => setImportDraft({ pkgArchivalCadence: v }), [setImportDraft]);
  const [pkgScanning, setPkgScanning] = useState(false);
  const [pkgScanResult, setPkgScanResult] = useState<ScanResult | null>(null);
  const [pkgImporting, setPkgImporting] = useState(false);
  const [pkgProgress, setPkgProgress] = useState<string | null>(null);
  const [pkgError, setPkgError] = useState<string | null>(null);

  // --- Imported packages expanded detail ---
  const [expandedPkg, setExpandedPkg] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<PackageFileInfo[]>([]);
  const [expandedLoading, setExpandedLoading] = useState(false);

  // TICKET_913 P2: naming modal state
  const [showNameModal, setShowNameModal] = useState(false);

  // TICKET_308_3_4: lifecycle state
  const [removingPkg, setRemovingPkg] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<{ pkg: string; missing: number; total: number } | null>(null);
  const [healthChecking, setHealthChecking] = useState(false);
  const [confirmRemovePkg, setConfirmRemovePkg] = useState<string | null>(null);

  const resetPkgState = useCallback(() => {
    resetImportDraft();
    setPkgScanResult(null);
    setPkgImporting(false);
    setPkgProgress(null);
    setPkgError(null);
    setPkgScanning(false);
    setShowNameModal(false);
  }, [resetImportDraft]);

  const handleNameConfirm = useCallback((confirmedName: string) => {
    setPkgName(confirmedName);
    setShowNameModal(false);
  }, []);

  const handleNameCancel = useCallback(() => {
    setShowNameModal(false);
    resetPkgState();
  }, [resetPkgState]);

  const scanPackage = useCallback(async (sourcePath: string) => {
    setPkgScanning(true);
    setPkgError(null);
    setPkgScanResult(null);
    setPkgSourcePath(sourcePath);

    try {
      const result = await window.electronAPI.data.scanDataPackage({
        request: { sourcePath, packageName: pkgName.trim() || undefined },
      });
      setPkgScanResult(result as ScanResult);
      if (!pkgName.trim()) setPkgName(result.packageName);
      setShowNameModal(true);
    } catch (err) {
      setPkgError(
        t('dataManagement.importPackage.scanFailed', {
          message: err instanceof Error ? err.message : String(err),
        })
      );
    } finally {
      setPkgScanning(false);
    }
  }, [pkgName, t]);

  const handleSelectDirectory = useCallback(async () => {
    if (pkgImporting || pkgScanning) return;
    try {
      const result = await window.electronAPI.file.openDialog({
        title: t('dataManagement.importPackage.selectDirectory'),
        properties: ['openDirectory'],
      });
      if (!result || result.canceled || !result.filePaths?.length) return;
      resetPkgState();
      await scanPackage(result.filePaths[0]);
    } catch (err) {
      setPkgError(err instanceof Error ? err.message : String(err));
    }
  }, [pkgImporting, pkgScanning, t, resetPkgState, scanPackage]);

  const handleSelectDuckDb = useCallback(async () => {
    if (pkgImporting || pkgScanning) return;
    try {
      const result = await window.electronAPI.file.openDialog({
        title: t('dataManagement.importPackage.selectDuckDb'),
        properties: ['openFile'],
        filters: [{ name: 'DuckDB', extensions: ['duckdb'] }],
      });
      if (!result || result.canceled || !result.filePaths?.length) return;
      resetPkgState();
      await scanPackage(result.filePaths[0]);
    } catch (err) {
      setPkgError(err instanceof Error ? err.message : String(err));
    }
  }, [pkgImporting, pkgScanning, t, resetPkgState, scanPackage]);

  const handleConfirmImport = useCallback(async () => {
    if (!pkgSourcePath || pkgImporting) return;
    const name = pkgName.trim() || pkgScanResult?.packageName || 'imported-package';

    setPkgImporting(true);
    setPkgError(null);
    setPkgProgress(t('dataManagement.importPackage.validating'));

    const taskId = crypto.randomUUID();
    const unsub = window.electronAPI.data.onImportProgress((data) => {
      if (data.taskId !== taskId) return;
      if (data.phase === 'validating') setPkgProgress(t('dataManagement.importPackage.validating'));
      else if (data.phase === 'importing' && data.symbol) {
        setPkgProgress(t('dataManagement.importPackage.importingSymbol', { symbol: data.symbol, interval: data.interval ?? '', current: data.seriesIndex ?? 0, total: data.seriesTotal ?? 0 }));
      } else if (data.phase === 'registering') setPkgProgress(t('dataManagement.importPackage.registering'));
      else if (data.phase === 'complete') {
        setPkgProgress(t('dataManagement.importPackage.complete', { count: data.seriesImported ?? 0 }));
      } else if (data.phase === 'error') {
        setPkgError(data.message || t('dataManagement.importPackage.importFailed'));
      }
    });

    try {
      await window.electronAPI.data.importDataPackage({
        taskId,
        request: {
          sourcePath: pkgSourcePath,
          packageName: name,
          adjustMode: pkgAdjustMode,
          // TICKET_919_10: propagate user-declared cadence. The service
          // resolves this as request-level override > manifest field >
          // DIALECT_ARCHIVAL_DEFAULT. Picking 'monthly_archive' here for
          // a HistData / Dukascopy export tells the orchestrator to floor
          // discovery windows to the cadence's last published month-end.
          archivalCadence: pkgArchivalCadence,
        },
      });
      await refreshPackages();
    } catch (err) {
      setPkgError(err instanceof Error ? err.message : String(err));
    } finally {
      setPkgImporting(false);
      if (typeof unsub === 'function') unsub();
    }
  }, [pkgSourcePath, pkgImporting, pkgName, pkgScanResult, pkgAdjustMode, pkgArchivalCadence, t, refreshPackages]);

  const handleTogglePackageDetail = useCallback(async (packageName: string) => {
    if (expandedPkg === packageName) {
      setExpandedPkg(null);
      setExpandedFiles([]);
      return;
    }
    setExpandedPkg(packageName);
    setExpandedLoading(true);
    try {
      const files = await window.electronAPI.data.listImportedPackageFiles(packageName);
      setExpandedFiles(Array.isArray(files) ? files : []);
    } catch {
      setExpandedFiles([]);
    } finally {
      setExpandedLoading(false);
    }
  }, [expandedPkg]);

  const handleRemovePackage = useCallback((packageName: string) => {
    setConfirmRemovePkg(packageName);
  }, []);

  const executeRemovePackage = useCallback(async () => {
    const packageName = confirmRemovePkg;
    if (!packageName) return;
    setConfirmRemovePkg(null);
    setRemovingPkg(packageName);
    try {
      await removePackage(packageName);
      if (expandedPkg === packageName) {
        setExpandedPkg(null);
        setExpandedFiles([]);
      }
      setHealthStatus(null);
    } finally {
      setRemovingPkg(null);
    }
  }, [confirmRemovePkg, removePackage, expandedPkg]);

  const handleHealthCheck = useCallback(async (packageName: string) => {
    setHealthChecking(true);
    setHealthStatus(null);
    try {
      const result = await checkPackageHealth(packageName);
      if (result) {
        const missing = result.filter((f) => !f.exists).length;
        setHealthStatus({ pkg: packageName, missing, total: result.length });
      }
    } finally {
      setHealthChecking(false);
    }
  }, [checkPackageHealth]);

  const handleReimport = useCallback((pkg: { packageName: string; sourceDialect: string }) => {
    resetPkgState();
    setPkgName(pkg.packageName);
  }, [resetPkgState]);

  const hasPreview = pkgScanResult !== null && !showNameModal;
  const hasValidationErrors = (pkgScanResult?.validationErrors?.length ?? 0) > 0;
  const effectivePkgName = pkgName.trim() || pkgScanResult?.packageName || '';
  const isReimport = effectivePkgName !== '' && packages.some((p) => p.packageName === effectivePkgName);

  return (
    <div className="h-full overflow-auto p-6 space-y-6 text-white/90">
      {/* Imported package list (click to expand) */}
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5 max-w-3xl">
        <div className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-white/70 mb-3">
          <Database className="w-4 h-4" />
          {t('dataManagement.import.importedPackages')}
        </div>
        {packages.length === 0 ? (
          <p className="text-xs text-white/40">{t('dataManagement.import.empty')}</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {packages.map((pkg) => (
              <li key={pkg.packageName}>
                <div className="w-full flex items-center justify-between py-2 text-sm terminal-mono hover:bg-white/[0.03] rounded px-1 transition-colors group">
                  <button
                    type="button"
                    onClick={() => handleTogglePackageDetail(pkg.packageName)}
                    className="flex items-center gap-2 text-white/90 flex-1 min-w-0 text-left"
                  >
                    {expandedPkg === pkg.packageName
                      ? <ChevronDown className="w-3.5 h-3.5 text-white/40 shrink-0" />
                      : <ChevronRight className="w-3.5 h-3.5 text-white/40 shrink-0" />}
                    {pkg.packageName}
                  </button>
                  <span className="flex items-center gap-3 text-xs text-white/50">
                    <span className="uppercase">{pkg.sourceDialect}</span>
                    <span className="px-1.5 py-0.5 rounded bg-white/5 uppercase">
                      {pkg.adjustMode}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleRemovePackage(pkg.packageName); }}
                      disabled={removingPkg === pkg.packageName}
                      className="p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity text-white/30 hover:text-red-400 hover:bg-red-400/10 disabled:opacity-50"
                      title={t('dataManagement.importPackage.remove')}
                    >
                      {removingPkg === pkg.packageName
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <X className="w-3.5 h-3.5" />}
                    </button>
                  </span>
                </div>
                {expandedPkg === pkg.packageName && (
                  <div className="pl-7 pb-3 space-y-3">
                    {expandedLoading ? (
                      <span className="text-xs text-white/40 flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                      </span>
                    ) : expandedFiles.length === 0 ? (
                      <span className="text-xs text-white/40">-</span>
                    ) : (
                      <table className="text-xs text-white/60 terminal-mono w-full">
                        <thead>
                          <tr className="text-white/40 text-left">
                            <th className="pr-4 pb-1 font-normal">{t('dataManagement.import.table.col.symbol')}</th>
                            <th className="pr-4 pb-1 font-normal">{t('dataManagement.import.table.col.interval')}</th>
                            <th className="pr-4 pb-1 font-normal">{t('dataManagement.import.table.col.from')}</th>
                            <th className="pr-4 pb-1 font-normal">{t('dataManagement.import.table.col.to')}</th>
                            <th className="pr-4 pb-1 font-normal text-right">{t('dataManagement.import.table.col.rows')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {expandedFiles.map((f) => (
                            <tr key={`${f.symbol}-${f.interval}`}>
                              <td className="pr-4 py-0.5">{f.symbol}</td>
                              <td className="pr-4 py-0.5">{f.interval}</td>
                              <td className="pr-4 py-0.5">{formatEpoch(f.firstTimestamp)}</td>
                              <td className="pr-4 py-0.5">{formatEpoch(f.lastTimestamp)}</td>
                              <td className="pr-4 py-0.5 text-right">{f.rowCount.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {/* TICKET_308_3_4: lifecycle actions */}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleReimport(pkg)}
                        className="inline-flex items-center gap-1.5 h-7 px-3 rounded text-xs font-medium transition-colors text-white/60 hover:text-white/90 hover:bg-white/5"
                      >
                        <RefreshCw className="w-3 h-3" />
                        {t('dataManagement.importPackage.reimport')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleHealthCheck(pkg.packageName)}
                        disabled={healthChecking}
                        className="inline-flex items-center gap-1.5 h-7 px-3 rounded text-xs font-medium transition-colors text-white/60 hover:text-white/90 hover:bg-white/5"
                      >
                        {healthChecking && healthStatus === null ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <HeartPulse className="w-3 h-3" />
                        )}
                        {t('dataManagement.importPackage.healthCheck')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemovePackage(pkg.packageName)}
                        disabled={removingPkg === pkg.packageName}
                        className="inline-flex items-center gap-1.5 h-7 px-3 rounded text-xs font-medium transition-colors text-red-400/60 hover:text-red-400 hover:bg-red-400/5"
                      >
                        {removingPkg === pkg.packageName ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                        {removingPkg === pkg.packageName
                          ? t('dataManagement.importPackage.removing')
                          : t('dataManagement.importPackage.remove')}
                      </button>
                    </div>
                    {/* Health check result */}
                    {healthStatus && healthStatus.pkg === pkg.packageName && (
                      <div className={`text-xs terminal-mono flex items-center gap-1.5 ${
                        healthStatus.missing > 0 ? 'text-amber-400' : 'text-emerald-400'
                      }`}>
                        {healthStatus.missing > 0 ? (
                          <>
                            <AlertTriangle className="w-3 h-3" />
                            {t('dataManagement.importPackage.healthMissing', {
                              missing: healthStatus.missing,
                              total: healthStatus.total,
                            })}
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-3 h-3" />
                            {t('dataManagement.importPackage.healthOk', { count: healthStatus.total })}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* TICKET_308_3_3: Import Data Package (select -> preview -> confirm -> progress) */}
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5 max-w-3xl space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-white/70">
          <FolderOpen className="w-4 h-4" />
          {t('dataManagement.importPackage.title')}
        </div>
        <p className="text-xs text-white/50">
          {t('dataManagement.importPackage.subtitle')}
        </p>

        {/* Phase 1: Source selection (show when no preview and not importing) */}
        {!hasPreview && !pkgImporting && (
          <>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={pkgScanning}
                onClick={handleSelectDirectory}
                className={pkgScanning ? BTN_DISABLED : BTN_ENABLED}
              >
                {pkgScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderOpen className="w-4 h-4" />}
                {pkgScanning ? t('dataManagement.importPackage.scanning') : t('dataManagement.importPackage.selectDirectory')}
              </button>
              <button
                type="button"
                disabled={pkgScanning}
                onClick={handleSelectDuckDb}
                className={pkgScanning ? BTN_DISABLED : BTN_ENABLED}
              >
                {pkgScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                {pkgScanning ? t('dataManagement.importPackage.scanning') : t('dataManagement.importPackage.selectDuckDb')}
              </button>
            </div>
          </>
        )}

        {/* Phase 2: Preview panel */}
        {hasPreview && !pkgImporting && (
          <div className="space-y-4">
            <div className="rounded border border-white/10 bg-white/[0.02] p-4 space-y-3">
              {/* Package name (set via modal) + adjust mode + archival cadence (TICKET_919_10) */}
              <div className="grid grid-cols-3 gap-4">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wider text-white/50">
                    {t('dataManagement.import.packageName')}
                  </span>
                  <span className="h-9 flex items-center px-3 text-sm text-white/90 terminal-mono">
                    {effectivePkgName}
                  </span>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wider text-white/50">
                    {t('dataManagement.import.adjustMode')}
                  </span>
                  <select
                    value={pkgAdjustMode}
                    onChange={(e) => setPkgAdjustMode(e.target.value as ImportAdjustMode)}
                    className={FIELD_CLASS}
                  >
                    {ADJUST_MODES.map((m) => (
                      <option key={m} value={m}>
                        {t(`dataManagement.import.adjustModes.${m}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wider text-white/50">
                    {t('dataManagement.import.archivalCadence')}
                  </span>
                  <select
                    value={pkgArchivalCadence}
                    onChange={(e) => setPkgArchivalCadence(e.target.value as ArchivalCadence)}
                    className={FIELD_CLASS}
                    title={t('dataManagement.import.archivalCadenceHint')}
                  >
                    {IMPORTED_ARCHIVAL_CADENCES.map((c) => (
                      <option key={c} value={c}>
                        {t(`dataManagement.import.archivalCadences.${c}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Preview info grid */}
              <div className="grid grid-cols-3 gap-x-6 gap-y-2 text-xs">
                <div>
                  <span className="text-white/40">{t('dataManagement.importPackage.previewDialect')}</span>
                  <p className="text-white/80 uppercase terminal-mono">{pkgScanResult!.sourceDialect}</p>
                </div>
                <div>
                  <span className="text-white/40">{t('dataManagement.importPackage.previewFiles')}</span>
                  <p className="text-white/80 terminal-mono">{pkgScanResult!.fileCount}</p>
                </div>
                <div>
                  <span className="text-white/40">{t('dataManagement.importPackage.previewSize')}</span>
                  <p className="text-white/80 terminal-mono">{formatBytes(pkgScanResult!.totalSizeBytes)}</p>
                </div>
                <div>
                  <span className="text-white/40">{t('dataManagement.importPackage.previewSymbols')}</span>
                  <p className="text-white/80 terminal-mono">
                    {pkgScanResult!.symbols.length > 0
                      ? pkgScanResult!.symbols.length
                      : t('dataManagement.importPackage.noSymbolsDetected')}
                  </p>
                </div>
                <div>
                  <span className="text-white/40">{t('dataManagement.importPackage.previewIntervals')}</span>
                  <p className="text-white/80 terminal-mono">
                    {pkgScanResult!.intervals.length > 0
                      ? pkgScanResult!.intervals.join(', ')
                      : '-'}
                  </p>
                </div>
                <div>
                  <span className="text-white/40">{t('dataManagement.importPackage.previewValidation')}</span>
                  <p className={`terminal-mono ${hasValidationErrors ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {hasValidationErrors
                      ? t('dataManagement.importPackage.previewErrors', { count: pkgScanResult!.validationErrors.length })
                      : t('dataManagement.importPackage.previewValid')}
                  </p>
                </div>
              </div>

              {/* Symbol list (collapsed if >10) */}
              {pkgScanResult!.symbols.length > 0 && pkgScanResult!.symbols.length <= 20 && (
                <div className="text-xs text-white/50 terminal-mono leading-relaxed">
                  {pkgScanResult!.symbols.join(', ')}
                </div>
              )}
              {pkgScanResult!.symbols.length > 20 && (
                <div className="text-xs text-white/50 terminal-mono leading-relaxed">
                  {pkgScanResult!.symbols.slice(0, 20).join(', ')}
                  {` +${pkgScanResult!.symbols.length - 20}`}
                </div>
              )}

              {/* Validation errors */}
              {hasValidationErrors && (
                <div className="space-y-1">
                  {pkgScanResult!.validationErrors.map((e, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-amber-400">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                      <span>{e.file ? `${e.file}: ` : ''}{e.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleConfirmImport}
                  disabled={hasValidationErrors}
                  className={hasValidationErrors ? BTN_DISABLED : (isReimport
                    ? 'inline-flex items-center gap-2 h-9 px-4 rounded text-sm font-medium transition-colors bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
                    : BTN_ENABLED)}
                >
                  <Upload className="w-4 h-4" />
                  {isReimport
                    ? t('dataManagement.importPackage.confirmReimport')
                    : t('dataManagement.importPackage.confirmImport')}
                </button>
                <button
                  type="button"
                  onClick={resetPkgState}
                  className="inline-flex items-center gap-2 h-9 px-4 rounded text-sm font-medium transition-colors text-white/50 hover:text-white/80 hover:bg-white/5"
                >
                  {t('dataManagement.importPackage.changeSource')}
                </button>
              </div>
              {isReimport && (
                <p className="text-[11px] text-amber-400/70">
                  {t('dataManagement.importPackage.reimportHint')}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Phase 3: Import in progress */}
        {pkgImporting && (
          <div className="flex items-center gap-3">
            <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
            <span className="text-xs text-white/60 terminal-mono">
              {pkgProgress || t('dataManagement.importPackage.importing')}
            </span>
          </div>
        )}

        {/* Completion message (persists after import finishes) */}
        {!pkgImporting && pkgProgress && !pkgError && (
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-emerald-300 terminal-mono">{pkgProgress}</span>
            <button
              type="button"
              onClick={resetPkgState}
              className="ml-2 text-xs text-white/40 hover:text-white/70 transition-colors"
            >
              {t('dataManagement.importPackage.changeSource')}
            </button>
          </div>
        )}

        {/* Error display */}
        {pkgError && (
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <span className="text-xs text-red-400 terminal-mono">{pkgError}</span>
            <button
              type="button"
              onClick={resetPkgState}
              className="ml-2 text-xs text-white/40 hover:text-white/70 transition-colors shrink-0"
            >
              {t('dataManagement.importPackage.changeSource')}
            </button>
          </div>
        )}
      </div>

      {/* TICKET_913 P2: package naming modal */}
      <PackageNameModal
        visible={showNameModal}
        defaultName={pkgName || pkgScanResult?.packageName || ''}
        existingPackageNames={packages.map((p) => p.packageName)}
        onConfirm={handleNameConfirm}
        onCancel={handleNameCancel}
      />

      {/* Remove-package confirmation modal */}
      {confirmRemovePkg !== null && createPortal(
        <RemovePackageConfirmDialog
          packageName={confirmRemovePkg}
          onConfirm={executeRemovePackage}
          onCancel={() => setConfirmRemovePkg(null)}
        />,
        document.body
      )}
    </div>
  );
};


function RemovePackageConfirmDialog({
  packageName,
  onConfirm,
  onCancel,
}: {
  packageName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('ui');
  const mouseDownOnBackdrop = useRef(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onConfirm, onCancel]);

  return (
    <div
      className={cn(
        'fixed inset-0',
        'flex items-center justify-center',
        'bg-black/60 backdrop-blur-[4px]',
        'animate-in fade-in duration-150'
      )}
      style={{ zIndex: Z_INDEX_MODAL }}
      onMouseDown={() => { mouseDownOnBackdrop.current = true; }}
      onMouseUp={() => {
        if (mouseDownOnBackdrop.current) onCancel();
        mouseDownOnBackdrop.current = false;
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="remove-pkg-dialog-title"
    >
      <div
        className={cn(
          'min-w-[320px] max-w-[400px]',
          'rounded-lg border border-color-terminal-border',
          'bg-color-terminal-surface',
          'shadow-[0_8px_32px_rgba(0,0,0,0.5)]',
          'animate-in zoom-in-95 duration-150'
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className={cn(
            'flex items-center gap-2 px-4 py-3',
            'border-b border-color-terminal-border border-l-[3px]',
            'bg-color-terminal-panel rounded-t-lg',
            'border-l-color-terminal-accent-gold'
          )}
        >
          <AlertTriangle className="w-[18px] h-[18px] flex-shrink-0 text-color-terminal-accent-gold" />
          <span
            id="remove-pkg-dialog-title"
            className={cn(
              'flex-1 font-mono text-[12px] font-semibold',
              'text-color-terminal-text'
            )}
          >
            {t('dataManagement.importPackage.removeTitle', 'Remove Package')}
          </span>
          <button
            onClick={onCancel}
            className={cn(
              'p-1',
              'text-color-terminal-text-muted hover:text-color-terminal-text',
              'transition-colors duration-200'
            )}
            aria-label={t('common.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-6">
          <p
            className={cn(
              'font-mono text-[12px] leading-relaxed',
              'text-color-terminal-text text-center'
            )}
          >
            {t('dataManagement.importPackage.removeConfirm', { name: packageName })}
          </p>
        </div>

        <div
          className={cn(
            'flex justify-center gap-3 px-4 py-4',
            'border-t border-color-terminal-border'
          )}
        >
          <button
            onClick={onCancel}
            className={cn(
              'min-w-[80px] px-4 py-2',
              'font-mono text-[12px] font-semibold',
              'rounded border border-color-terminal-border',
              'bg-transparent text-color-terminal-text-secondary',
              'hover:border-color-terminal-text-muted hover:text-color-terminal-text',
              'transition-all duration-200'
            )}
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              'min-w-[80px] px-4 py-2',
              'font-mono text-[12px] font-semibold',
              'rounded border border-red-500',
              'bg-red-500/10 text-red-400',
              'hover:bg-red-500/20',
              'transition-all duration-200'
            )}
            autoFocus
          >
            {t('dataManagement.importPackage.removeButton', 'Remove')}
          </button>
        </div>
      </div>
    </div>
  );
}
