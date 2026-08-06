/**
 * Strategy Plugin UI Components
 *
 * StratCraftsAI-styled UI components for Strategy Studio.
 *
 * @see TICKET_077 - StratCraftsAI UI Component Library
 * @see TICKET_078 - Input Theming and Portal Patterns
 */

// TICKET_893: AccessGate - full-page auth/entitlement gate
export { AccessGate } from './AccessGate';
export type { AccessGateProps } from './AccessGate';

export { ExpressionInput } from './ExpressionInput';
export type { ExpressionInputProps } from './ExpressionInput';

export { StrategyCard } from './StrategyCard';
export type { StrategyCardProps } from './StrategyCard';

export { RegimeSelector } from './RegimeSelector';
export type { RegimeSelectorProps, RegimeOption, BespokeData } from './RegimeSelector';

export { IndicatorSelector } from './IndicatorSelector';
export type { IndicatorSelectorProps, IndicatorBlock, IndicatorDefinition, IndicatorParam, StrategyTemplate } from './IndicatorSelector';

export { DirectionalIndicatorSelector } from './DirectionalIndicatorSelector';
export type { DirectionalIndicatorSelectorProps, DirectionalIndicatorBlock, TradeDirection } from './DirectionalIndicatorSelector';

export { PortalDropdown } from './PortalDropdown';
export type { PortalDropdownProps } from './PortalDropdown';

export { ValidateInputBeforeGenerate, useValidateBeforeGenerate } from './ValidateInputBeforeGenerate';
export type { ValidateInputBeforeGenerateProps, ValidationConfig, UseValidateBeforeGenerateOptions } from './ValidateInputBeforeGenerate';

export { CodeDisplay } from './CodeDisplay';
export type { CodeDisplayProps, CodeDisplayState } from './CodeDisplay';


// TICKET_190: BYOK API Key Prompt
export { ApiKeyPrompt } from './ApiKeyPrompt';
export type { ApiKeyPromptProps } from './ApiKeyPrompt';

// TICKET_518: BYOK First-Run Setup Dialog
export { BYOKSetupDialog } from './BYOKSetupDialog';
export type { BYOKSetupDialogProps } from './BYOKSetupDialog';

// TICKET_199: NamingDialog for Builder Pages
export { NamingDialog } from './NamingDialog';
export type { NamingDialogProps, NamingDialogContextData } from './NamingDialog';

// TICKET_077_D3: Generate Content Wrapper
export { GenerateContentWrapper } from './GenerateContentWrapper';
export type { GenerateContentWrapperProps } from './GenerateContentWrapper';

// TICKET_077_11: SliderInputGroup
export { SliderInputGroup } from './SliderInputGroup';
export type { SliderInputGroupProps } from './SliderInputGroup';

// TICKET_077_12: ModelSelector
export { ModelSelector } from './ModelSelector';
export type { ModelSelectorProps, ModelOption } from './ModelSelector';

// TICKET_077_13: PresetButtonGroup
export { PresetButtonGroup } from './PresetButtonGroup';
export type { PresetButtonGroupProps, PresetOption, PresetButtonVariant } from './PresetButtonGroup';

// TICKET_077_14: ToggleSwitch
export { ToggleSwitch } from './ToggleSwitch';
export type { ToggleSwitchProps } from './ToggleSwitch';

// TICKET_077_15: CollapsiblePanel
export { CollapsiblePanel } from './CollapsiblePanel';
export type { CollapsiblePanelProps, BadgeVariant } from './CollapsiblePanel';

// TICKET_077_16: SignalFilterPanel
export { SignalFilterPanel } from './SignalFilterPanel';
export type {
  SignalFilterPanelProps,
  SignalFilterConfig,
  DirectionMode,
  CombinationLogic,
  FrequencyLevel,
} from './SignalFilterPanel';

// TICKET_077_17: TimeRangeSelector
export { TimeRangeSelector } from './TimeRangeSelector';
export type { TimeRangeSelectorProps, TimeRangeMode } from './TimeRangeSelector';

// TICKET_077_19: Kronos AI Entry Components
export { TemplateToolbar } from './TemplateToolbar';
export type { TemplateToolbarProps, TemplateToolbarLabels } from './TemplateToolbar';

export { RawIndicatorSelector } from './RawIndicatorSelector';
export type { RawIndicatorSelectorProps, RawIndicatorBlock } from './RawIndicatorSelector';

export { TraderPresetSelector } from './TraderPresetSelector';
export type { TraderPresetSelectorProps, TraderPresetOption, TraderPresetMode } from './TraderPresetSelector';

export { ModeDetailsPanel } from './ModeDetailsPanel';
export type { ModeDetailsPanelProps, ModeDetail } from './ModeDetailsPanel';

export { BespokeConfigPanel, DEFAULT_BESPOKE_CONFIG } from './BespokeConfigPanel';
export type { BespokeConfigPanelProps, BespokeConfig, SliderConfig } from './BespokeConfigPanel';

export { PromptTextarea } from './PromptTextarea';
export type { PromptTextareaProps } from './PromptTextarea';

// TICKET_212: Algorithm Selector Dialog
export { AlgorithmSelectorDialog } from './AlgorithmSelectorDialog';
export type { AlgorithmSelectorDialogProps } from './AlgorithmSelectorDialog';

// TICKET_212: Indicator Template Selector Dialog
export { IndicatorTemplateSelectorDialog } from './IndicatorTemplateSelectorDialog';
export type { IndicatorTemplateSelectorDialogProps, IndicatorTemplate } from './IndicatorTemplateSelectorDialog';

// TICKET_077_1: WatchlistConfigPanel for Market Observer (page35)
export { WatchlistConfigPanel } from './WatchlistConfigPanel';
export type { WatchlistConfigPanelProps, WatchlistData, TimeframeOption, DataSourceOption } from './WatchlistConfigPanel';

// TICKET_214: SaveTemplateDialog for Trader AI Entry (page36)
export { SaveTemplateDialog } from './SaveTemplateDialog';
export type { SaveTemplateDialogProps } from './SaveTemplateDialog';
export type { IndicatorTemplate as UserIndicatorTemplate } from './SaveTemplateDialog';

// TICKET_077_26: AdvancedConfigPanel for AI Libero (page37)
export { AdvancedConfigPanel, DEFAULT_PREDICTION_CONFIG, getPresetPredictionConfig } from './AdvancedConfigPanel';
export type { AdvancedConfigPanelProps, PredictionConfig } from './AdvancedConfigPanel';

// TICKET_260: SignalModeSelector for Regime Detector and Entry pages
export { SignalModeSelector } from './SignalModeSelector';
export type { SignalModeSelectorProps, SignalMode, SignalModeContext } from './SignalModeSelector';

// TICKET_274: Risk Override Exit Components (Risk Manager)
export { CircuitBreakerConfig } from './CircuitBreakerConfig';
export type { CircuitBreakerConfigProps } from './CircuitBreakerConfig';

export { TimeLimitConfig } from './TimeLimitConfig';
export type { TimeLimitConfigProps } from './TimeLimitConfig';

export { RegimeDetectionConfig } from './RegimeDetectionConfig';
export type { RegimeDetectionConfigProps } from './RegimeDetectionConfig';

export { DrawdownLimitConfig } from './DrawdownLimitConfig';
export type { DrawdownLimitConfigProps } from './DrawdownLimitConfig';

export { IndicatorGuardConfig } from './IndicatorGuardConfig';
export type { IndicatorGuardConfigProps } from './IndicatorGuardConfig';

export { HardSafetyConfig } from './HardSafetyConfig';
export type { HardSafetyConfigProps } from './HardSafetyConfig';

export { RiskOverrideRuleCard } from './RiskOverrideRuleCard';
export type { RiskOverrideRuleCardProps } from './RiskOverrideRuleCard';

// TICKET_298: GenerateActionBar for Builder Pages
export { GenerateActionBar } from './GenerateActionBar';
export type { GenerateActionBarProps } from './GenerateActionBar';

// TICKET_883_1: SelectDropdown
export { SelectDropdown } from './SelectDropdown';
export type { SelectDropdownProps, SelectOption } from './SelectDropdown';

// TICKET_077_28: FloatingMonitor
export { FloatingMonitor } from './FloatingMonitor';
export type { FloatingMonitorProps, FloatingMonitorGauge, FloatingMonitorCounter, FloatingMonitorAction } from './FloatingMonitor';

// TICKET_077_28: ProviderRow / ProviderRowList (multi-row data source / market picker)
export { ProviderRow } from './ProviderRow';
export type { ProviderRowProps } from './ProviderRow';

export { ProviderRowList } from './ProviderRowList';
export type {
  ProviderRowListProps,
  ProviderRowEntry,
  ProviderRowSliceConfig,
} from './ProviderRowList';

// TICKET_077_29: UniverseSliceSelector (Layer-3 per-row top-N / sub-slice picker)
export { UniverseSliceSelector } from './UniverseSliceSelector';
export type {
  UniverseSliceSelectorProps,
  UniverseSliceSpec,
  RankingMetricId,
} from './UniverseSliceSelector';
