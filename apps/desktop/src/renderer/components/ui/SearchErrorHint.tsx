/**
 * SearchErrorHint - Inline error hint dropdown for search inputs
 *
 * TICKET_077_D4: Reusable component for displaying contextual error messages
 * below search inputs (auth errors, network errors, etc.).
 *
 * @see TICKET_289 - Symbol search auth error feedback (first consumer)
 */

import React from 'react';
import { THEME_COLORS } from '@shared/constants/colors';

export interface SearchErrorHintProps {
  /** Error message to display, null = hidden */
  error: string | null;
  /** Whether the hint is visible (controlled by parent) */
  visible: boolean;
  /** Optional className override */
  className?: string;
}

export const SearchErrorHint: React.FC<SearchErrorHintProps> = ({ error, visible, className }) => {
  if (!visible || !error) return null;

  return (
    <div
      className={className || 'absolute z-50 w-full mt-1 rounded border border-red-500/30 shadow-lg px-3 py-2.5 text-sm terminal-mono text-red-400'}
      style={{ backgroundColor: THEME_COLORS.ERROR_HINT_BG }}
    >
      {error}
    </div>
  );
};

export default SearchErrorHint;
