/**
 * ApiKeyInput
 *
 * TICKET_809_1 Phase 3 (TICKET_809_5). Single masked credential input
 * with show/hide toggle, used by `ProviderCard` for every
 * `CredentialKeyField`. Mirrors the visual treatment of the deleted
 * LLMSettingsPanel input but is provider-agnostic.
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';

import { cn } from '../../../lib/utils';
import type { CredentialKeyField } from '../../../../shared/types/credential-contribution';

// Regex stripping BOM (U+FEFF) and zero-width characters (U+200B - U+200D)
// from pasted secrets. Built from String.fromCharCode() so the source file
// stays ASCII-only per repo convention.
const ZERO_WIDTH_STRIP_RE = new RegExp(
  '[' +
    String.fromCharCode(0xfeff) +
    String.fromCharCode(0x200b) +
    String.fromCharCode(0x200c) +
    String.fromCharCode(0x200d) +
    ']',
  'g',
);

export interface ApiKeyInputProps {
  field: CredentialKeyField;
  value: string;
  onChange: (next: string) => void;
  /** Optional inline error message (e.g. pattern mismatch). */
  error?: string;
  /** i18n-resolved label string. */
  label: string;
  /** Optional i18n-resolved placeholder string. */
  placeholder?: string;
  disabled?: boolean;
  /** Auto-focus the first input on a card. */
  autoFocus?: boolean;
}

export function ApiKeyInput({
  field,
  value,
  onChange,
  error,
  label,
  placeholder,
  disabled,
  autoFocus,
}: ApiKeyInputProps): JSX.Element {
  const { t } = useTranslation('settings');
  const [revealed, setRevealed] = useState(false);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      // Sanitize pasted secret: strip leading/trailing whitespace + zero-width chars.
      // Matches the deleted LLMSettingsPanel paste behavior so users do not
      // need to re-discover that "copy-paste of an API key with a trailing
      // newline does not work."
      const raw = e.clipboardData.getData('text');
      if (raw == null) return;
      const cleaned = raw.replace(ZERO_WIDTH_STRIP_RE, '').trim();
      if (cleaned !== raw) {
        e.preventDefault();
        onChange(cleaned);
      }
    },
    [onChange],
  );

  // password fields toggle between password/text on reveal; text and url
  // fields stay as their declared type.
  const inputType =
    field.inputType === 'password' ? (revealed ? 'text' : 'password') : field.inputType;

  const showToggle = field.inputType === 'password';

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={`secret-${field.key}`}
        className="font-mono text-[11px] font-medium text-color-terminal-text-secondary"
      >
        {label}
        {field.required ? (
          <span className="ml-1 text-color-terminal-accent-amber" aria-label={t('secretsPanel.apiKey.aria.required')}>
            *
          </span>
        ) : null}
      </label>
      <div className="relative">
        <input
          id={`secret-${field.key}`}
          type={inputType}
          value={value}
          onChange={e => onChange(e.target.value)}
          onPaste={handlePaste}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          className={cn(
            'w-full px-3 py-2 pr-10',
            'font-mono text-[12px]',
            'rounded border border-color-terminal-border',
            'bg-color-terminal-bg text-color-terminal-text',
            'placeholder:text-color-terminal-text-muted',
            'focus:outline-none focus:border-color-terminal-accent-teal focus:ring-1 focus:ring-color-terminal-accent-teal/30',
            error && 'border-color-terminal-accent-red focus:border-color-terminal-accent-red focus:ring-color-terminal-accent-red/30',
            disabled && 'opacity-60 cursor-not-allowed',
          )}
        />
        {showToggle ? (
          <button
            type="button"
            onClick={() => setRevealed(r => !r)}
            disabled={disabled}
            aria-label={revealed ? t('secretsPanel.apiKey.aria.hideValue') : t('secretsPanel.apiKey.aria.showValue')}
            className={cn(
              'absolute right-2 top-1/2 -translate-y-1/2',
              'p-1 text-color-terminal-text-muted hover:text-color-terminal-text',
              'transition-colors duration-150',
              disabled && 'opacity-50 cursor-not-allowed',
            )}
          >
            {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="font-mono text-[10px] text-color-terminal-accent-red">{error}</p>
      ) : null}
    </div>
  );
}
