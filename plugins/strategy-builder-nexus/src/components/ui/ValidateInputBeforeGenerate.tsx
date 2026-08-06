/**
 * ValidateInputBeforeGenerate Component (TICKET_087)
 *
 * Reusable validation wrapper for generator pages.
 * Validates that at least one input exists before allowing generation.
 *
 * @see TICKET_087 - Start Generate Flow Implementation
 * @see FRONTEND_REGIME_DETECTOR_PROTOCOL.md - Web frontend reference
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ValidationConfig {
  /** Items to validate (rules, indicators, expressions, etc.) */
  items: unknown[];
  /** Custom validation function (optional) */
  customValidator?: (items: unknown[]) => boolean;
  /** Error message when validation fails */
  errorMessage?: string;
}

export interface ValidateInputBeforeGenerateProps {
  /** Validation configuration */
  config: ValidationConfig;
  /** Callback when validation passes */
  onValidationPass: () => void;
  /** Callback when validation fails (optional) */
  onValidationFail?: (errorMessage: string) => void;
  /** Children (typically the Generate button) */
  children: React.ReactNode;
  /** Disabled state (e.g., during loading) */
  disabled?: boolean;
  /** Additional class name */
  className?: string;
}

// -----------------------------------------------------------------------------
// Default Validation
// -----------------------------------------------------------------------------

/**
 * Default validation: at least one item required
 * Matches web frontend validateLogicInputs(): rules && rules.length > 0
 */
function defaultValidator(items: unknown[]): boolean {
  return Array.isArray(items) && items.length > 0;
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

/**
 * ValidateInputBeforeGenerate
 *
 * Wraps a button/action element and validates inputs before triggering the action.
 * Shows error message if validation fails.
 *
 * Usage:
 * ```tsx
 * <ValidateInputBeforeGenerate
 *   config={{ items: rules, errorMessage: 'Please add at least one indicator' }}
 *   onValidationPass={handleGenerate}
 * >
 *   <Button>Start Generate</Button>
 * </ValidateInputBeforeGenerate>
 * ```
 */
export const ValidateInputBeforeGenerate: React.FC<ValidateInputBeforeGenerateProps> = ({
  config,
  onValidationPass,
  onValidationFail,
  children,
  disabled = false,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');
  const { items, customValidator, errorMessage } = config;
  const defaultErrorMsg = errorMessage || t('ui.validateInput.errorDefault');

  const handleClick = useCallback(() => {
    if (disabled) return;

    // Use custom validator if provided, otherwise default
    const validator = customValidator || defaultValidator;
    const isValid = validator(items);

    if (isValid) {
      onValidationPass();
    } else {
      const message = errorMessage || defaultErrorMsg;
      if (onValidationFail) {
        onValidationFail(message);
      } else {
        // Default: show alert (can be replaced with toast/notification)
        console.warn('[W:STRATEGY:VALIDATE_INPUT] [ValidateInputBeforeGenerate]', message);
      }
    }
  }, [items, customValidator, errorMessage, onValidationPass, onValidationFail, disabled, t, defaultErrorMsg]);

  return (
    <div className={className} onClick={handleClick}>
      {children}
    </div>
  );
};

// -----------------------------------------------------------------------------
// Hook (Alternative Usage)
// -----------------------------------------------------------------------------

export interface UseValidateBeforeGenerateOptions {
  /** Items to validate */
  items: unknown[];
  /** Custom validation function */
  customValidator?: (items: unknown[]) => boolean;
  /** Error message when validation fails */
  errorMessage?: string;
  /** Callback when validation fails */
  onValidationFail?: (message: string) => void;
}

/**
 * useValidateBeforeGenerate Hook
 *
 * Alternative to component wrapper for more flexible usage.
 *
 * Usage:
 * ```tsx
 * const { validate, isValid } = useValidateBeforeGenerate({
 *   items: rules,
 *   errorMessage: 'Please add at least one indicator',
 * });
 *
 * const handleGenerate = () => {
 *   if (validate()) {
 *     // proceed with generation
 *   }
 * };
 * ```
 */
export function useValidateBeforeGenerate(options: UseValidateBeforeGenerateOptions) {
  const { t } = useTranslation('strategy-builder');
  const { items, customValidator, errorMessage, onValidationFail } = options;

  const validator = customValidator || defaultValidator;
  const isValid = validator(items);

  const validate = useCallback((): boolean => {
    const valid = validator(items);
    if (!valid) {
      const message = errorMessage || t('ui.validateInput.errorDefault');
      if (onValidationFail) {
        onValidationFail(message);
      } else {
        console.warn('[W:STRATEGY:VALIDATE_INPUT_HOOK] [useValidateBeforeGenerate]', message);
      }
    }
    return valid;
  }, [items, validator, errorMessage, onValidationFail, t]);

  return {
    validate,
    isValid,
  };
}

export default ValidateInputBeforeGenerate;
