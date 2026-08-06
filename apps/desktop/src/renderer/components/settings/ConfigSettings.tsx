/**
 * ConfigSettings - System Configuration Settings Page
 *
 * TICKET_046: System-Level Configuration Implementation (Phase 3)
 * Provides UI for managing system configuration.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '@/stores';
import { useTranslation } from 'react-i18next';
import {
  Settings,
  FolderOpen,
  Gauge,
  RefreshCw,
  AlertTriangle,
  RotateCcw,
  Info,
  Cpu,
  HardDrive,
  BarChart3,
  KeyRound,
  // TICKET_875: icons for sections consolidated from the former ADVANCED tab
  HelpCircle,
  BookOpen,
  Shield,
  Activity,
  // TICKET_927_2_2: Data routing sub-panel
  Route,
} from 'lucide-react';
// TICKET_809_1 Phase 4 / TICKET_809
import { SecretsPanel, SecureStoreLifecyclePanel } from './SecretsPanel';
// TICKET_927_2_2: Data routing sub-panel
import { DataRoutingPanel } from './DataRoutingPanel';
// TICKET_875: stores/hooks for the consolidated ADVANCED sections
import { useOnboarding } from '@/hooks/useOnboarding';
import { useAssistantStore } from '@/stores';
import { registerLlmContributions } from '../../services/llm-contributions';
// TICKET_809_1 Phase 5 / TICKET_808
import { registerDataProviderContributions } from '../../services/data-provider-contributions';
// TICKET_809_1 Phase 6 / TICKET_809_6
import { registerAuthContributions } from '../../services/auth-contributions';
import {
  SCOREBOARD_WINDOW_BARS_MIN,
  SCOREBOARD_WINDOW_BARS_MAX,
  // TICKET_1283: per-workload resource governance bounds
  RESOURCE_CAP_MIN,
  RESOURCE_CAP_MAX,
  RESOURCE_CAP_AGGREGATE_MAX,
} from '../../../shared/types/config';
import {
  WORKLOAD_ADMISSION_CEILING_MAX_PERCENT,
  WORKLOAD_ADMISSION_CEILING_MIN_PERCENT,
  WORKLOAD_ADMISSION_MAX_SYSTEM_PERCENT,
} from '../../../shared/constants/system-monitor';
import { cn } from '@/lib/utils';
import { getIntlLocale } from '@shared/utils/format-locale';

// =============================================================================
// Navigation Configuration
// =============================================================================

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
}

const getNavItems = (t: (key: string) => string): NavItem[] => [
  { id: 'performance', label: t('settings:config.nav.performance'), icon: Gauge },
  { id: 'sync', label: t('settings:config.nav.sync'), icon: HardDrive },
  { id: 'scoreboard', label: t('settings:config.nav.scoreboard'), icon: BarChart3 },
  // TICKET_1283: per-workload resource governance caps
  { id: 'resourceGovernance', label: t('settings:config.nav.resourceGovernance'), icon: Cpu },
  // TICKET_809_1 Phase 4 / TICKET_809
  { id: 'credentials', label: t('settings:secretsPanel.sectionLlm'), icon: KeyRound },
  // TICKET_809_1 Phase 5 / TICKET_808
  { id: 'data-providers', label: t('settings:secretsPanel.sectionData'), icon: KeyRound },
  // TICKET_927_2_2: Per-market provider preference (Data routing)
  { id: 'data-routing', label: t('settings:config.nav.dataRouting'), icon: Route },
  // TICKET_809_1 Phase 6 / TICKET_809_6
  { id: 'auth-session', label: t('settings:secretsPanel.sectionAuth'), icon: KeyRound },
  // TICKET_875: sections consolidated from the former ADVANCED tab
  // (TICKET_877_1 removed the dead Backtest twin + Developer Mode sections)
  { id: 'diagnostics', label: t('settings:config.nav.diagnostics'), icon: FolderOpen },
  { id: 'onboarding', label: t('settings:config.nav.onboarding'), icon: HelpCircle },
  { id: 'privacy', label: t('settings:config.nav.privacy'), icon: Shield },
];

// =============================================================================
// Types
// =============================================================================

interface PathsConfig {
  plugins: string[];
}

interface PerformanceConfig {
  maxBacktestTasks: number;
}

interface SyncConfig {
  targetDir: string;
  lastSyncedAt: string | null;
  lastSyncedMachineId: string;
}

interface ScoreboardConfigShape {
  windowBars: number;
}

// TICKET_1283: per-workload resource governance
interface ResourceGovernanceConfigShape {
  sweep: { capPercent: number };
  mining: { capPercent: number };
  lstm: { capPercent: number };
  enabled: boolean;
  admissionCeilingPercent: number;
}

interface SystemConfig {
  paths: PathsConfig;
  performance: PerformanceConfig;
  sync: SyncConfig;
  scoreboard: ScoreboardConfigShape;
  resourceGovernance: ResourceGovernanceConfigShape;
}

// =============================================================================
// Section Components
// =============================================================================

interface SectionProps {
  id?: string;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function Section({ id, title, icon, children }: SectionProps): JSX.Element {
  return (
    <div id={id} className="rounded-lg border border-white/10 scroll-mt-4">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        {icon}
        <h3 className="font-medium">{title}</h3>
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </div>
  );
}

interface FieldProps {
  label: string;
  description?: string;
  error?: string;
  children: React.ReactNode;
}

function Field({ label, description, error, children }: FieldProps): JSX.Element {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium">{label}</label>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      {children}
      {error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          {error}
        </p>
      )}
    </div>
  );
}

// =============================================================================
// Input Components
// =============================================================================

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}

function NumberInput({ value, onChange, min, max, disabled }: NumberInputProps): JSX.Element {
  const clamp = (raw: string): void => {
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) {
      onChange(min ?? 0);
      return;
    }
    let v = parsed;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(v);
  };

  return (
    <input
      type="number"
      value={value}
      onChange={(e) => clamp(e.target.value)}
      onBlur={(e) => clamp(e.target.value)}
      min={min}
      max={max}
      disabled={disabled}
      className="w-full rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm focus:border-color-terminal-accent-teal focus:outline-none disabled:opacity-50"
    />
  );
}

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

function TextInput({ value, onChange, placeholder, disabled }: TextInputProps): JSX.Element {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm focus:border-color-terminal-accent-teal focus:outline-none disabled:opacity-50"
    />
  );
}

interface SelectInputProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}

function SelectInput({ value, onChange, options, disabled }: SelectInputProps): JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm focus:border-color-terminal-accent-teal focus:outline-none disabled:opacity-50"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value} className="bg-color-terminal-panel">
          {opt.label}
        </option>
      ))}
    </select>
  );
}

// =============================================================================
// Toggle / SettingRow (TICKET_875: ported from the former AdvancedSettings)
// =============================================================================

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

function ToggleSwitch({ checked, onChange, disabled }: ToggleSwitchProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-color-terminal-accent-teal",
        checked ? "bg-color-terminal-accent-teal" : "bg-white/20",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out",
          checked ? "translate-x-4" : "translate-x-0"
        )}
      />
    </button>
  );
}

interface SettingRowProps {
  icon: React.ElementType;
  iconColor?: string;
  title: string;
  description: string;
  children: React.ReactNode;
}

function SettingRow({
  icon: Icon,
  iconColor = "text-color-terminal-accent-teal",
  title,
  description,
  children,
}: SettingRowProps): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 py-4 border-b border-white/10 last:border-0">
      <div className="flex items-start gap-3">
        <div className={cn("mt-0.5", iconColor)}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <h4 className="text-sm font-medium text-color-terminal-text-primary">{title}</h4>
          <p className="text-xs text-color-terminal-text-muted mt-0.5 max-w-md">{description}</p>
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function ConfigSettings(): JSX.Element {
  const { t } = useTranslation(['settings']);
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  // TICKET_641_3: Config health status for UI notification
  const [configHealth, setConfigHealth] = useState<{
    status: 'healthy' | 'warning' | 'error';
    message: string;
    usingFallback: boolean;
  } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // TICKET_1208 P5: Active section preserved across view switches via Zustand.
  const activeSection = useAppStore((s) => s.settingsActiveSection);
  const setActiveSection = useAppStore((s) => s.setSettingsActiveSection);
  const [syncing, setSyncing] = useState(false);

  // TICKET_809_1 Phase 4/5/6: ensure provider contributions are
  // registered before SecretsPanel renders. All registrars are
  // idempotent, so calling on every mount is safe.
  useEffect(() => {
    registerLlmContributions();
    registerDataProviderContributions();
    registerAuthContributions();
  }, []);

  // TICKET_811: respond to cross-component navigation intents (e.g.
  // Tool Sweep BYOK toast's "Open Settings" action button). The
  // navigation source has already set activeView=settings via the app
  // store; this effect lands the user on the requested section.
  useEffect(() => {
    const onSectionIntent = (event: Event) => {
      const detail = (event as CustomEvent<{ section?: string }>).detail;
      if (!detail?.section) return;
      const allowed = getNavItems(t).map(n => n.id);
      if (allowed.includes(detail.section)) {
        setActiveSection(detail.section);
      }
    };
    window.addEventListener('nexus:settings-section', onSectionIntent);
    return () => {
      window.removeEventListener('nexus:settings-section', onSectionIntent);
    };
  }, [t]);
  const [restoring, setRestoring] = useState(false);
  const NAV_ITEMS = getNavItems(t);

  // ---------------------------------------------------------------------------
  // TICKET_875: state/handlers consolidated from the former ADVANCED tab.
  // These are independent of the SystemConfig state above and do not touch
  // handleChange / config.set -- they own their own persistence channels.
  // ---------------------------------------------------------------------------

  // TICKET_593: Onboarding state
  const {
    enabled: onboardingEnabled,
    toggle: toggleOnboarding,
    reset: resetOnboarding,
  } = useOnboarding();

  // TICKET_593_1: Assistant mode state
  const assistantEnabled = useAssistantStore((s) => s.assistantEnabled);
  const setAssistantEnabled = useAssistantStore((s) => s.setAssistantEnabled);

  // TICKET_573 Phase 4A: Privacy consent state (crash reports always-on)
  const [analyticsConsent, setAnalyticsConsent] = useState(false);

  useEffect(() => {
    // Load privacy consent status
    (async () => {
      try {
        const result = await window.electronAPI.consent.getStatus();
        if (result.success && result.consent) {
          setAnalyticsConsent(result.consent.analytics);
        }
      } catch (error) {
        console.error('[E:SETTINGS:CONSENT_LOAD_FAILED] Failed to load consent status:', error);
      }
    })();
  }, []);

  // TICKET_573_1: Diagnostics -- open log folder
  const handleOpenLogFolder = async () => {
    try {
      await window.electronAPI.diagnostics.openLogFolder();
    } catch (error) {
      console.error('[E:SETTINGS:LOG_FOLDER_OPEN_FAILED] Failed to open log folder:', error);
    }
  };

  const handleOpenDecisionTrustPolicy = async () => {
    await window.electronAPI.decisionTrustPolicy.openSettings();
  };

  // TICKET_573 Phase 4A: Privacy consent handler (crash reports always-on)
  const handleAnalyticsConsentChange = async (enabled: boolean) => {
    setAnalyticsConsent(enabled);
    try {
      await window.electronAPI.consent.setConsent(true, enabled);
      // TICKET_196_6 Phase 6: refresh cached consent so telemetry picks it up.
      const { initTelemetry } = await import('@/services/telemetry-renderer');
      await initTelemetry();
    } catch (error) {
      console.error('[E:SETTINGS:CONSENT_UPDATE_FAILED] Failed to update analytics consent:', error);
      setAnalyticsConsent(!enabled); // Revert on failure
    }
  };

  // TICKET_593_1: Assistant mode toggle handler
  const handleAssistantModeChange = async (enabled: boolean) => {
    setAssistantEnabled(enabled);
    try {
      await window.electronAPI.onboarding.setAssistantMode(enabled);
    } catch (error) {
      console.error('[E:SETTINGS:ASSISTANT_MODE_UPDATE_FAILED] Failed to update assistant mode:', error);
      setAssistantEnabled(!enabled); // Revert on failure
    }
  };

  // Load configuration
  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.config.getAll();
      if (result.success && result.config) {
        setConfig(result.config as SystemConfig);
      }
    } catch (error) {
      console.error('[E:SETTINGS:CONFIG_LOAD_FAILED] Failed to load config:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();

    // Fetch initial config health status
    window.electronAPI.config.getHealth().then((result) => {
      if (result.success && result.health && result.health.status !== 'healthy') {
        setConfigHealth(result.health);
      }
    });

    // Subscribe to config changes
    const unsubChange = window.electronAPI.config.onChanged(() => {
      loadConfig();
    });

    // TICKET_641_3: Subscribe to config health changes for UI notification
    const unsubHealth = window.electronAPI.config.onHealthChanged((health) => {
      if (health.status === 'healthy') {
        setConfigHealth(null);
      } else {
        setConfigHealth(health);
      }
    });

    return () => {
      unsubChange();
      unsubHealth();
    };
  }, [loadConfig]);

  // Handle field change
  const handleChange = async (path: string, value: unknown) => {
    setPendingChanges((prev) => ({ ...prev, [path]: value }));

    // Update local state immediately for responsiveness
    if (config) {
      const parts = path.split('.');
      const newConfig = JSON.parse(JSON.stringify(config));
      let current = newConfig;
      for (let i = 0; i < parts.length - 1; i++) {
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = value;
      setConfig(newConfig);
    }

    const GOV_CAP_PATHS = [
      'resourceGovernance.sweep.capPercent',
      'resourceGovernance.mining.capPercent',
      'resourceGovernance.lstm.capPercent',
    ];
    const isGovCap = GOV_CAP_PATHS.includes(path);

    // Save to backend
    try {
      const result = await window.electronAPI.config.set(path, value);
      if (result.success) {
        // Clear from pending changes
        setPendingChanges((prev) => {
          const next = { ...prev };
          delete next[path];
          return next;
        });
        // Clear error — for gov caps, clear all three (aggregate error may be stale)
        setErrors((prev) => {
          const next = { ...prev };
          if (isGovCap) {
            for (const p of GOV_CAP_PATHS) delete next[p];
          } else {
            delete next[path];
          }
          return next;
        });
      } else {
        setErrors((prev) => ({ ...prev, [path]: result.error || t('settings:errors.saveFailed') }));
      }
    } catch (error) {
      const msg = String(error);
      if (isGovCap && msg.includes('aggregate')) {
        const aggMsg = t('settings:config.resourceGovernance.aggregateExceeded', {
          max: RESOURCE_CAP_AGGREGATE_MAX,
        });
        setErrors((prev) => {
          const next = { ...prev };
          for (const p of GOV_CAP_PATHS) next[p] = aggMsg;
          return next;
        });
      } else {
        setErrors((prev) => ({ ...prev, [path]: msg }));
      }
    }
  };

  // Handle reload
  const handleReload = async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.config.reload();
      if (!result.success) {
        // TICKET_641_3: Reload rejected -- show notification and update health banner
        window.electronAPI.showNotification({
          message: result.error || t('settings:config.health.reloadFailed'),
          type: 'error',
        });
        if (result.health) {
          setConfigHealth(result.health);
        }
      } else {
        // Successful reload clears health error
        setConfigHealth(null);
      }
      await loadConfig();
    } finally {
      setLoading(false);
    }
  };

  // Handle sync folder browse
  const handleBrowseSyncFolder = async () => {
    const result = await window.electronAPI.file.openDialog({
      properties: ['openDirectory'],
      title: t('settings:config.sync.targetFolder'),
    });
    if (result && !result.canceled && result.filePaths?.length > 0) {
      handleChange('sync.targetDir', result.filePaths[0]);
    }
  };

  // Handle sync now
  const handleSyncNow = async () => {
    if (!config?.sync?.targetDir) return;
    setSyncing(true);
    try {
      const result = await window.electronAPI.workspaceSync.export(config.sync.targetDir);
      if (result.success) {
        window.electronAPI.showNotification({
          message: t('settings:config.sync.exportSuccess', {
            strategies: result.exportedStrategies,
            algorithms: result.exportedAlgorithms,
            results: result.exportedResults,
          }),
          type: 'success',
        });
        // Reload config to get updated lastSyncedAt
        loadConfig();
      } else {
        window.electronAPI.showNotification({
          message: t('settings:config.sync.errors.exportFailed', { error: result.error }),
          type: 'error',
        });
      }
    } catch (error) {
      window.electronAPI.showNotification({
        message: t('settings:config.sync.errors.exportFailed', { error: String(error) }),
        type: 'error',
      });
    } finally {
      setSyncing(false);
    }
  };

  // Handle restore from sync
  const handleRestoreFromSync = async () => {
    if (!config?.sync?.targetDir) return;

    const restoreLabel = t('settings:config.sync.buttons.restore');
    const confirmed = await window.electronAPI.showDialog({
      title: t('settings:config.sync.restoreFromSync'),
      message: t('settings:config.sync.confirmRestore'),
      buttons: [t('settings:config.sync.buttons.cancel'), restoreLabel],
      type: 'warning',
    });

    if (confirmed.button !== restoreLabel) return;

    setRestoring(true);
    try {
      const result = await window.electronAPI.workspaceSync.import(config.sync.targetDir);
      if (result.success) {
        window.electronAPI.showNotification({
          message: t('settings:config.sync.importSuccess', {
            strategies: result.importedStrategies,
            algorithms: result.importedAlgorithms,
            results: result.importedResults,
          }),
          type: 'success',
        });
      } else {
        window.electronAPI.showNotification({
          message: t('settings:config.sync.errors.importFailed', { error: result.error }),
          type: 'error',
        });
      }
    } catch (error) {
      window.electronAPI.showNotification({
        message: t('settings:config.sync.errors.importFailed', { error: String(error) }),
        type: 'error',
      });
    } finally {
      setRestoring(false);
    }
  };

  if (loading && !config) {
    return (
      <div className="h-full flex items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 mx-auto text-destructive" />
          <p className="mt-4 text-muted-foreground">{t('settings:errors.loadFailed')}</p>
          <button
            onClick={loadConfig}
            className="mt-4 px-4 py-2 rounded-lg bg-primary text-white text-sm"
          >
            {t('settings:actions.retry')}
          </button>
        </div>
      </div>
    );
  }

  // Scroll to section
  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element && contentRef.current) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveSection(sectionId);
    }
  };

  return (
    <div className="h-full flex bg-StratCraftsAI terminal-theme">
      {/* Left Navigation */}
      <nav className="w-96 flex-shrink-0 border-r border-white/10 p-4">
        <div className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => scrollToSection(item.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                  isActive
                    ? "text-color-terminal-accent-teal"
                    : "text-muted-foreground hover:text-color-terminal-accent-teal"
                )}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Right Content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                <Settings className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">{t('settings:config.title')}</h1>
                <p className="text-muted-foreground">
                  {t('settings:config.description')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleReload}
                disabled={loading}
                className="flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-sm font-medium hover:bg-white/5 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                {t('settings:actions.reload')}
              </button>
            </div>
          </div>

        {/* TICKET_641_3: Config Health Error/Warning Banner */}
        {configHealth && configHealth.status !== 'healthy' && (
          <div className={cn(
            "rounded-lg border p-4 flex items-start gap-3",
            configHealth.status === 'error'
              ? "border-destructive/50 bg-destructive/10"
              : "border-yellow-500/50 bg-yellow-500/10"
          )}>
            <AlertTriangle className={cn(
              "h-5 w-5 mt-0.5 shrink-0",
              configHealth.status === 'error' ? "text-destructive" : "text-yellow-500"
            )} />
            <div className="flex-1 min-w-0">
              <p className={cn(
                "font-medium",
                configHealth.status === 'error' ? "text-destructive" : "text-yellow-500"
              )}>
                {configHealth.status === 'error'
                  ? t('settings:config.health.parseError')
                  : t('settings:config.health.parseWarning')}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {configHealth.message}
              </p>
              {configHealth.usingFallback && (
                <p className="text-xs text-muted-foreground mt-1">
                  {t('settings:config.health.usingFallback')}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Performance Settings */}
        <Section id="performance" title={t('settings:config.nav.performance')} icon={<Gauge className="h-5 w-5 text-primary" />}>
          <Field
            label={t('settings:config.performance.maxBacktestTasks')}
            description={t('settings:config.performance.maxBacktestDescription')}
            error={errors['performance.maxBacktestTasks']}
          >
            <div className="flex gap-2">
              <div className="flex-1">
                <NumberInput
                  value={config.performance.maxBacktestTasks}
                  onChange={(v) => handleChange('performance.maxBacktestTasks', v)}
                  min={1}
                  max={32}
                />
              </div>
              <button
                onClick={async () => {
                  const optimal = await window.electronAPI.config.detectOptimalBacktestTasks();
                  handleChange('performance.maxBacktestTasks', optimal);
                }}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-color-terminal-accent-teal hover:border-color-terminal-accent-teal/50 transition-colors whitespace-nowrap"
                title={t('settings:config.performance.autoDetectTitle')}
              >
                <Cpu className="h-3.5 w-3.5" />
                {t('settings:config.performance.autoDetect')}
              </button>
            </div>
          </Field>
        </Section>

        {/* Sync Settings */}
        <Section id="sync" title={t('settings:config.sync.title')} icon={<HardDrive className="h-5 w-5 text-primary" />}>
          <p className="text-sm text-muted-foreground mb-4">
            {t('settings:config.sync.description')}
          </p>

          <Field
            label={t('settings:config.sync.targetFolder')}
            description={t('settings:config.sync.targetFolderDescription')}
            error={errors['sync.targetDir']}
          >
            <div className="flex gap-2">
              <div className="flex-1">
                <TextInput
                  value={config.sync?.targetDir ?? ''}
                  onChange={(v) => handleChange('sync.targetDir', v)}
                  placeholder={t('settings:config.sync.targetFolderPlaceholder')}
                />
              </div>
              <button
                onClick={handleBrowseSyncFolder}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-color-terminal-accent-teal hover:border-color-terminal-accent-teal/50 transition-colors whitespace-nowrap"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {t('settings:config.sync.browse')}
              </button>
            </div>
          </Field>

          <div className="flex items-center justify-between pt-2">
            <div className="text-sm text-muted-foreground">
              <span className="font-medium">{t('settings:config.sync.lastSynced')}:</span>{' '}
              {config.sync?.lastSyncedAt
                ? new Date(config.sync.lastSyncedAt).toLocaleString(getIntlLocale())
                : t('settings:config.sync.neverSynced')}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleSyncNow}
                disabled={syncing || !config.sync?.targetDir}
                className="flex items-center gap-2 rounded-lg bg-primary/20 border border-primary/30 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? t('settings:config.sync.syncing') : t('settings:config.sync.syncNow')}
              </button>

              <button
                onClick={handleRestoreFromSync}
                disabled={restoring || !config.sync?.targetDir}
                className="flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-color-terminal-accent-teal hover:border-color-terminal-accent-teal/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <RotateCcw className={`h-4 w-4 ${restoring ? 'animate-spin' : ''}`} />
                {restoring ? t('settings:config.sync.restoring') : t('settings:config.sync.restoreFromSync')}
              </button>
            </div>
          </div>
        </Section>

        {/* Scoreboard Settings (TICKET_196_6 Phase 5) */}
        <Section
          id="scoreboard"
          title={t('settings:config.scoreboard.title')}
          icon={<BarChart3 className="h-5 w-5 text-primary" />}
        >
          <p className="text-sm text-muted-foreground mb-4">
            {t('settings:config.scoreboard.description')}
          </p>
          <Field
            label={t('settings:config.scoreboard.windowBars')}
            description={t('settings:config.scoreboard.windowBarsDescription', {
              min: SCOREBOARD_WINDOW_BARS_MIN,
              max: SCOREBOARD_WINDOW_BARS_MAX,
            })}
            error={errors['scoreboard.windowBars']}
          >
            <NumberInput
              value={config.scoreboard?.windowBars ?? 60}
              onChange={(v) => handleChange('scoreboard.windowBars', v)}
              min={SCOREBOARD_WINDOW_BARS_MIN}
              max={SCOREBOARD_WINDOW_BARS_MAX}
            />
          </Field>
        </Section>

        {/* Resource Governance Settings (TICKET_1283) */}
        <Section
          id="resourceGovernance"
          title={t('settings:config.resourceGovernance.title')}
          icon={<Cpu className="h-5 w-5 text-primary" />}
        >
          <p className="text-sm text-muted-foreground mb-4">
            {t('settings:config.resourceGovernance.description')}
          </p>

          <Field label={t('settings:config.resourceGovernance.enabled')}>
            <div className="pt-2">
              <ToggleSwitch
                checked={config.resourceGovernance?.enabled ?? true}
                onChange={(v) => handleChange('resourceGovernance.enabled', v)}
              />
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field
              label={t('settings:config.resourceGovernance.sweepCap')}
              description={t('settings:config.resourceGovernance.capDescription', {
                min: RESOURCE_CAP_MIN,
                max: RESOURCE_CAP_MAX,
              })}
              error={errors['resourceGovernance.sweep.capPercent']}
            >
              <NumberInput
                value={config.resourceGovernance?.sweep?.capPercent ?? 30}
                onChange={(v) => handleChange('resourceGovernance.sweep.capPercent', v)}
                min={RESOURCE_CAP_MIN}
                max={RESOURCE_CAP_MAX}
              />
            </Field>

            <Field
              label={t('settings:config.resourceGovernance.miningCap')}
              description={t('settings:config.resourceGovernance.capDescription', {
                min: RESOURCE_CAP_MIN,
                max: RESOURCE_CAP_MAX,
              })}
              error={errors['resourceGovernance.mining.capPercent']}
            >
              <NumberInput
                value={config.resourceGovernance?.mining?.capPercent ?? 30}
                onChange={(v) => handleChange('resourceGovernance.mining.capPercent', v)}
                min={RESOURCE_CAP_MIN}
                max={RESOURCE_CAP_MAX}
              />
            </Field>

            <Field
              label={t('settings:config.resourceGovernance.lstmCap')}
              description={t('settings:config.resourceGovernance.capDescription', {
                min: RESOURCE_CAP_MIN,
                max: RESOURCE_CAP_MAX,
              })}
              error={errors['resourceGovernance.lstm.capPercent']}
            >
              <NumberInput
                value={config.resourceGovernance?.lstm?.capPercent ?? 30}
                onChange={(v) => handleChange('resourceGovernance.lstm.capPercent', v)}
                min={RESOURCE_CAP_MIN}
                max={RESOURCE_CAP_MAX}
              />
            </Field>

            <Field
              label={t('settings:config.resourceGovernance.admissionCeiling')}
              description={t('settings:config.resourceGovernance.admissionCeilingDesc', {
                min: WORKLOAD_ADMISSION_CEILING_MIN_PERCENT,
                max: WORKLOAD_ADMISSION_CEILING_MAX_PERCENT,
              })}
              error={errors['resourceGovernance.admissionCeilingPercent']}
            >
              <NumberInput
                value={
                  config.resourceGovernance?.admissionCeilingPercent ??
                  WORKLOAD_ADMISSION_MAX_SYSTEM_PERCENT
                }
                onChange={(v) => handleChange('resourceGovernance.admissionCeilingPercent', v)}
                min={WORKLOAD_ADMISSION_CEILING_MIN_PERCENT}
                max={WORKLOAD_ADMISSION_CEILING_MAX_PERCENT}
              />
            </Field>
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            {t('settings:config.resourceGovernance.applyNote')}
          </p>
        </Section>

        {/* TICKET_809_1 Phase 4 / TICKET_809: Credentials (LLM providers) */}
        <Section
          id="credentials"
          title={t('settings:secretsPanel.sectionLlm')}
          icon={<KeyRound className="h-5 w-5 text-primary" />}
        >
          <p className="text-sm text-muted-foreground mb-4">
            {t('settings:secretsPanel.sectionLlmDescription')}
          </p>
          <SecureStoreLifecyclePanel />
          <SecretsPanel mode="page" filter={{ domains: ['llm'] }} />
        </Section>

        {/* TICKET_809_1 Phase 5 / TICKET_808: Credentials (data providers) */}
        <Section
          id="data-providers"
          title={t('settings:secretsPanel.sectionData')}
          icon={<KeyRound className="h-5 w-5 text-primary" />}
        >
          <p className="text-sm text-muted-foreground mb-4">
            {t('settings:secretsPanel.sectionDataDescription')}
          </p>
          <SecretsPanel mode="page" filter={{ domains: ['data'] }} />
        </Section>

        {/* TICKET_927_2_2: per-market provider routing preferences */}
        <Section
          id="data-routing"
          title={t('config.dataRouting.title')}
          icon={<Route className="h-5 w-5 text-primary" />}
        >
          <p className="text-sm text-muted-foreground mb-4">
            {t('config.dataRouting.descriptionPrefix')}{' '}
            <code className="mx-1 rounded bg-white/10 px-1 text-xs">dukascopy_forex</code>
            {t('config.dataRouting.descriptionMiddle')}{' '}
            <code className="mx-1 rounded bg-white/10 px-1 text-xs">dukascopy</code>
            {t('config.dataRouting.descriptionAnd')}{' '}
            <code className="mx-1 rounded bg-white/10 px-1 text-xs">yfinance</code>
            {t('config.dataRouting.descriptionSuffix')}
          </p>
          <DataRoutingPanel />
        </Section>

        {/* TICKET_809_1 Phase 6 / TICKET_809_6: Auth session (read-only) */}
        <Section
          id="auth-session"
          title={t('settings:secretsPanel.sectionAuth')}
          icon={<KeyRound className="h-5 w-5 text-primary" />}
        >
          <p className="text-sm text-muted-foreground mb-4">
            {t('settings:secretsPanel.sectionAuthDescription')}
          </p>
          <SecretsPanel
            mode="page"
            filter={{ domains: ['auth'] }}
            showAuditLog={false}
            showSecurityStatus={false}
          />
        </Section>

        {/* ===================================================================
            TICKET_875: Sections consolidated from the former ADVANCED tab.
            TICKET_877_1: removed the dead Backtest twin (shadowed duplicate of
            Performance.maxBacktestTasks) and the Developer Mode section
            (undeclared config key, zero reads, plus a misleading plugin
            signature-verification toggle that no code path honored).
            =================================================================== */}

        {/* TICKET_573_1: Diagnostics */}
        <Section
          id="diagnostics"
          title={t('settings:advanced.diagnostics.title')}
          icon={<FolderOpen className="h-5 w-5 text-primary" />}
        >
          <SettingRow
            icon={FolderOpen}
            title={t('settings:advanced.diagnostics.openLogFolder')}
            description={t('settings:advanced.diagnostics.openLogFolderDescription')}
          >
            <button
              onClick={handleOpenLogFolder}
              className="px-3 py-1.5 text-xs font-medium rounded border border-white/20 bg-white/5 text-color-terminal-text-primary hover:bg-white/10 transition-colors"
            >
              {t('settings:advanced.diagnostics.openLogFolder')}
            </button>
          </SettingRow>
        </Section>

        {/* TICKET_593: Onboarding */}
        <Section
          id="onboarding"
          title={t('settings:advanced.onboarding.title')}
          icon={<HelpCircle className="h-5 w-5 text-primary" />}
        >
          <SettingRow
            icon={HelpCircle}
            title={t('settings:advanced.onboarding.showGuides')}
            description={t('settings:advanced.onboarding.showGuidesDescription')}
          >
            <ToggleSwitch checked={onboardingEnabled} onChange={toggleOnboarding} />
          </SettingRow>

          <SettingRow
            icon={BookOpen}
            title={t('settings:advanced.onboarding.assistantMode')}
            description={t('settings:advanced.onboarding.assistantModeDescription')}
          >
            <ToggleSwitch checked={assistantEnabled} onChange={handleAssistantModeChange} />
          </SettingRow>

          <SettingRow
            icon={RotateCcw}
            title={t('settings:advanced.onboarding.resetProgress')}
            description={t('settings:advanced.onboarding.resetProgressDescription')}
          >
            <button
              onClick={resetOnboarding}
              className="px-3 py-1.5 text-xs font-medium rounded border border-white/20 bg-white/5 text-color-terminal-text-primary hover:bg-white/10 transition-colors"
            >
              {t('settings:advanced.onboarding.resetButton')}
            </button>
          </SettingRow>
        </Section>

        {/* TICKET_573 Phase 4A: Privacy */}
        <Section
          id="privacy"
          title={t('settings:advanced.privacy.title')}
          icon={<Shield className="h-5 w-5 text-primary" />}
        >
          <p className="text-sm text-muted-foreground mb-4">
            {t('settings:advanced.privacy.description')}
          </p>
          <SettingRow
            icon={Activity}
            title={t('settings:advanced.privacy.crashReports')}
            description={t('settings:advanced.privacy.crashReportsAlwaysOn')}
          >
            <span className="text-xs font-medium text-color-terminal-accent-teal uppercase tracking-wider">
              {t('settings:advanced.privacy.alwaysOn')}
            </span>
          </SettingRow>

          <SettingRow
            icon={BarChart3}
            title={t('settings:advanced.privacy.analytics')}
            description={t('settings:advanced.privacy.analyticsDescription')}
          >
            <ToggleSwitch checked={analyticsConsent} onChange={handleAnalyticsConsentChange} />
          </SettingRow>

          <SettingRow
            icon={Shield}
            title={t('settings:advanced.privacy.decisionTrustPolicy', {
              defaultValue: 'Decision Trust Policy',
            })}
            description={t('settings:advanced.privacy.decisionTrustPolicyDescription', {
              defaultValue:
                'Configure when recent human approval may authorize repeated destructive operations.',
            })}
          >
            <button
              type="button"
              onClick={handleOpenDecisionTrustPolicy}
              className="px-3 py-1.5 text-xs font-medium rounded border border-white/20 bg-white/5 text-color-terminal-text-primary hover:bg-white/10 transition-colors"
              data-testid="open-decision-trust-policy"
            >
              {t('settings:advanced.privacy.configureDecisionTrustPolicy', {
                defaultValue: 'Configure',
              })}
            </button>
          </SettingRow>
        </Section>

        {/* Info Footer */}
        <div className="rounded-lg border border-dashed border-white/10 p-4 text-sm text-muted-foreground">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p>
                {t('settings:config.configFilePath')}{' '}
                <code className="bg-white/10 px-1 py-0.5 rounded text-xs">
                  ~/.config/@StratCraft/desktop/config/StratCraft.config.jsonc
                </code>
              </p>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

export default ConfigSettings;
