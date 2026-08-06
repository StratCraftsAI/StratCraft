/**
 * SymbolSearchField - Reusable symbol search with autocomplete dropdown
 *
 * Extracted from TICKET_077_COMPONENT8 (BacktestDataConfigPanel) for reuse
 * across core features (Data Management, future modules).
 *
 * Features:
 * - 300ms debounced search (TICKET_316: race condition prevention)
 * - Keyboard navigation (Arrow Up/Down, Enter, Escape)
 * - TICKET_331: Cache invalidation on data source change
 * - Loading spinner during search
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { SYMBOL_SEARCH_MIN_QUERY_LENGTH, SYMBOL_SEARCH_DEBOUNCE_MS } from '@shared/constants/validation';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { THEME_COLORS, STATUS_PLATE_COLORS } from '@shared/constants/colors';
import { SearchErrorHint } from '@/components/ui/SearchErrorHint';

// =============================================================================
// Types
// =============================================================================

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange?: string;
  type?: string;
  /** Data availability start time from backend */
  startTime?: string;
  /** Data availability end time from backend */
  endTime?: string;
}

/** TICKET_641_10: Wrapped search response with truncation metadata */
export interface SymbolSearchResponse {
  results: SymbolSearchResult[];
  totalCount: number;
  truncated: boolean;
}

export interface SymbolSearchFieldProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  onSearch?: (query: string) => Promise<SymbolSearchResponse>;
  /** Callback when a symbol is selected from search results */
  onSelect?: (result: SymbolSearchResult) => void;
  /** TICKET_331: Clear cached results when search context changes */
  dataSource?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

// =============================================================================
// Component
// =============================================================================

export const SymbolSearchField: React.FC<SymbolSearchFieldProps> = ({
  label,
  value,
  onChange,
  onSearch,
  onSelect,
  dataSource,
  error,
  disabled,
  className,
  placeholder: placeholderProp,
}) => {
  const { t } = useTranslation('ui');
  const placeholder = placeholderProp ?? t('symbolSearch.placeholder');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SymbolSearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [query, setQuery] = useState(value);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  // TICKET_289: Search error state for auth/network error feedback
  const [searchError, setSearchError] = useState<string | null>(null);
  // TICKET_641_10: Truncation metadata from search response
  const [truncationInfo, setTruncationInfo] = useState<{ totalCount: number; truncated: boolean } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setQuery(value);
  }, [value]);

  // TICKET_331: Clear cached search results when data source changes
  useEffect(() => {
    setSearchResults([]);
    setShowResults(false);
    setSearchError(null);
  }, [dataSource]);

  // TICKET_316: Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // TICKET_1033: Click-outside + Escape dismiss (replaces fragile onBlur timer)
  useEffect(() => {
    if (!showResults) return;
    const handleMousedown = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return;
      setShowResults(false);
      setHighlightedIndex(-1);
    };
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowResults(false);
        setHighlightedIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleMousedown);
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('mousedown', handleMousedown);
      document.removeEventListener('keydown', handleKeydown);
    };
  }, [showResults]);

  // TICKET_316: Debounce (300ms) + Sequence ID to fix race condition
  const handleSearch = useCallback(
    (q: string) => {
      setQuery(q);

      // Increment to invalidate any in-flight request
      const currentId = ++requestIdRef.current;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      if (!onSearch || q.length < SYMBOL_SEARCH_MIN_QUERY_LENGTH) {
        setSearchResults([]);
        setShowResults(false);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      setSearchError(null);
      debounceTimerRef.current = setTimeout(async () => {
        try {
          // TICKET_641_10: Unwrap { results, totalCount, truncated } response
          const response = await onSearch(q);
          // Discard if a newer request was issued while awaiting
          if (currentId !== requestIdRef.current) return;
          setSearchResults(response.results);
          setTruncationInfo({ totalCount: response.totalCount, truncated: response.truncated });
          setShowResults(response.results.length > 0);
          setHighlightedIndex(-1);
        } catch (err) {
          if (currentId !== requestIdRef.current) return;
          setSearchResults([]);
          setTruncationInfo(null);
          // TICKET_289: Detect auth errors and show contextual feedback
          // TICKET_638: Distinguish platform auth errors from BYOK credential errors
          const msg = err instanceof Error ? err.message : String(err);
          const msgLower = msg.toLowerCase();
          const isAuthError = msg.includes('401') || msgLower.includes('unauthorized') ||
              msgLower.includes('session expired') || msgLower.includes('authentication failed') ||
              msgLower.includes('authentication required');
          if (isAuthError) {
            // TICKET_638: Only fire nexus:auth-required for platform session errors,
            // not for BYOK credential failures (e.g., bad Alpaca API key)
            const isPlatformSessionError = msgLower.includes('session expired') ||
                msgLower.includes('authentication required. please log in');
            if (isPlatformSessionError) {
              setSearchError(t('symbolSearch.authRequired'));
              window.dispatchEvent(new Event('nexus:auth-required'));
            } else {
              // BYOK credential error -- provider-specific remediation
              setSearchError(t('symbolSearch.credentialError'));
            }
          } else {
            setSearchError(t('symbolSearch.serviceUnavailable'));
          }
          setShowResults(true);
        } finally {
          if (currentId === requestIdRef.current) {
            setIsSearching(false);
          }
        }
      }, SYMBOL_SEARCH_DEBOUNCE_MS);
    },
    [onSearch]
  );

  const handleSelectResult = (result: SymbolSearchResult) => {
    onChange(result.symbol);
    setQuery(result.symbol);
    setShowResults(false);
    setHighlightedIndex(-1);
    onSelect?.(result);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showResults || searchResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => {
        const next = prev < searchResults.length - 1 ? prev + 1 : 0;
        listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => {
        const next = prev > 0 ? prev - 1 : searchResults.length - 1;
        listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
        return next;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < searchResults.length) {
        handleSelectResult(searchResults[highlightedIndex]);
      }
    }
  };

  return (
    <div ref={containerRef} className={cn('flex flex-col gap-1 relative', className)}>
      {label && (
        <label className="text-[10px] text-color-terminal-text-muted">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (query.length >= 2) {
              if (searchResults.length > 0) {
                setShowResults(true);
              } else {
                // TICKET_331: Re-search when cache was invalidated by data source switch
                handleSearch(query);
              }
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            'w-full px-3 py-1.5 pr-8 bg-transparent border border-white/10 rounded text-xs text-color-terminal-text-primary',
            'placeholder:text-color-terminal-text-muted/50 font-mono',
            'focus:outline-none focus:border-color-terminal-accent-teal',
            'transition-colors',
            error && 'border-red-500',
            disabled && 'opacity-50 cursor-not-allowed',
          )}
        />
        {isSearching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-3 h-3 border-2 border-color-terminal-accent-teal border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {/* TICKET_289: Search error hint dropdown */}
        <SearchErrorHint error={searchError} visible={showResults && !!searchError} />
        {/* Search Results Dropdown */}
        {showResults && !searchError && searchResults.length > 0 && (
          <div
            ref={listRef}
            className="absolute z-50 w-full mt-1 max-h-60 overflow-y-auto rounded border border-white/10 shadow-lg"
            style={{ backgroundColor: THEME_COLORS.ERROR_HINT_BG }}
          >
            {searchResults.map((result, idx) => (
              <button
                key={idx}
                onClick={() => handleSelectResult(result)}
                onMouseEnter={() => setHighlightedIndex(idx)}
                className="w-full px-3 py-2 text-left transition-colors"
                style={{
                  backgroundColor: idx === highlightedIndex ? `${STATUS_PLATE_COLORS.TESTING}26` : undefined,
                  borderLeft: idx === highlightedIndex ? `3px solid ${STATUS_PLATE_COLORS.TESTING}` : '3px solid transparent',
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-color-terminal-accent-teal font-mono">
                    {result.symbol}
                  </span>
                  {result.exchange && (
                    <span className="text-[10px] text-color-terminal-text-muted font-mono">
                      {result.exchange}
                    </span>
                  )}
                </div>
                {result.name && (
                  <div className="text-[10px] text-color-terminal-text-muted font-mono truncate">
                    {result.name}
                  </div>
                )}
              </button>
            ))}
            {/* TICKET_641_10: Truncation hint */}
            {truncationInfo?.truncated && (
              <div className="px-3 py-1.5 text-[10px] text-color-terminal-text-muted font-mono border-t border-white/10">
                {t('symbolSearch.truncated', {
                  count: searchResults.length,
                  total: truncationInfo.totalCount,
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <span className="text-[10px] text-red-500">{error}</span>
      )}
    </div>
  );
};

// =============================================================================
// Date Auto-Fill Utility
// =============================================================================

/**
 * Parse date string from backend format "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DD"
 * Returns "YYYY-MM-DD" or null if invalid.
 */
export function parseBackendDate(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  const datePart = dateStr.split(' ')[0];
  if (datePart && /^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return datePart;
  }
  return null;
}
