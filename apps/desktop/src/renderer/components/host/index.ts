/**
 * Host Components - Framework-level components for Host/Plugin architecture
 *
 * These components are the "shell" that plugins inject content into.
 * They contain no business logic - all functionality comes from plugins.
 *
 * @see TICKET_059 - Host/Plugin Architecture
 * @see TICKET_093 - Plugin Settings Decoupling (settings components moved to plugin layer)
 */

export { TreeViewContainer } from './TreeViewContainer';
export { BreadcrumbBar } from './BreadcrumbBar';
export { ViewContainer } from './ViewContainer';
export { EditorTabManager } from './EditorTabManager';
export { PageHeader } from './PageHeader';
export { AuthWidget } from './AuthWidget';
export type { AuthWidgetProps } from './AuthWidget';
export type { AuthUser, AuthPlan } from '@/hooks/useAuth';

// TICKET_105: Feature Gating UI Components
export { TierBadge } from './TierBadge';
export type { TierLevel, TierBadgeProps } from './TierBadge';
export { LockedPagePlaceholder } from './LockedPagePlaceholder';
export type { LockedPagePlaceholderProps } from './LockedPagePlaceholder';

// TICKET_093: Plugin settings components moved to plugin layer
// - PluginSettingsPage -> plugins/strategy-builder-nexus/src/components/settings/PluginSettingsPage.tsx
// - PluginConfigSettings -> plugins/strategy-builder-nexus/src/components/settings/ConfigTab.tsx
// - PluginSecretSettings -> REMOVED (TICKET_647: secrets tab deleted, LLM keys in LLM tab, dead credentials removed)

// TICKET_775: Cross-boundary bridge -- listens for nexus:persistence-error
// events dispatched from plugin-layer fire-and-forget IPC failures and
// surfaces them as in-app toasts via useMessage.
export { PersistenceErrorListener } from './PersistenceErrorListener';
export type { PersistenceErrorDetail } from './PersistenceErrorListener';

// TICKET_782_1: Cross-boundary bridge -- listens for nexus:compile-gate-rejected
// dispatched from Signal Discovery when the Round 5 C++ compile gate drops a
// hallucinated signal blob, and surfaces it as a warning toast.
export { CompileGateRejectedListener } from './CompileGateRejectedListener';
export type { CompileGateRejectedDetail } from './CompileGateRejectedListener';

// TICKET_811: Cross-boundary bridge -- listens for nexus:tool-sweep-blocked
// dispatched from Tool Sweep when the BYOK provider gate trips, and
// surfaces an error toast with an "Open Settings" action button.
export { ToolSweepBlockedListener } from './ToolSweepBlockedListener';
export type { ToolSweepBlockedDetail } from './ToolSweepBlockedListener';
