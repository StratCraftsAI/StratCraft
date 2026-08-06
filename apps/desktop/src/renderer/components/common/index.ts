/**
 * Common component exports
 */

export { ThemeProvider } from './ThemeProvider';
export { ErrorBoundary } from './ErrorBoundary';
export { Loading, LoadingOverlay, LoadingPage } from './Loading';
export { StatusDot } from './StatusDot';
export { TrendIndicator } from './TrendIndicator';
export { MetalNameplate } from './MetalNameplate';
export { MiniNameplate } from './MiniNameplate';
export { StatusPlate } from './StatusPlate';
export { I18nProvider, useI18nContext, useLocale } from './I18nProvider';
export { LanguageSelector } from './LanguageSelector';
export { LLMProviderSelector } from './LLMProviderSelector';
export { AuthRequiredBanner } from './AuthRequiredBanner';
export { AuthRequiredButton } from './AuthRequiredButton';
export { KeychainWarningBanner } from './KeychainWarningBanner';
export { EntitlementExpiredBanner, type EntitlementExpiredBannerProps } from './EntitlementExpiredBanner';
export { OwnershipBadge, type OwnershipBadgeProps } from './OwnershipBadge';
export {
  CompilationStatusBadge,
  useCompilationStatus,
  type CompilationStatus,
  type CompilationStatusBadgeProps,
} from './CompilationStatusBadge';
export type { CompilationStatusUpdate } from '@shared/types/compiler';

export {
  ErrorState,
  type ErrorStateAction,
  type ErrorStateProps,
  type ErrorStateVariant,
} from '@StratCraft/shared-ui';
