/**
 * GenerateContentWrapper Component
 *
 * Wraps input content area and provides overlay/disable during code generation.
 * Shows loading indicator and blocks user interaction.
 *
 * @see TICKET_077_D3 - Generate Content Wrapper
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface GenerateContentWrapperProps {
  /** Is generation in progress */
  isGenerating: boolean;
  /** Loading message to display on overlay */
  loadingMessage?: string;
  /** Children (input area content) */
  children: React.ReactNode;
  /** Additional class name for wrapper */
  className?: string;
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

/**
 * GenerateContentWrapper
 *
 * Wraps content and shows overlay with loading indicator during generation.
 *
 * @example
 * ```tsx
 * <GenerateContentWrapper
 *   isGenerating={state.isGenerating}
 *   loadingMessage="Generating strategy code..."
 * >
 *   <RegimeSelector ... />
 *   <IndicatorSelector ... />
 * </GenerateContentWrapper>
 * ```
 */
export const GenerateContentWrapper: React.FC<GenerateContentWrapperProps> = ({
  isGenerating,
  loadingMessage,
  children,
  className,
}) => {
  const { t } = useTranslation('strategy-builder');
  const message = loadingMessage || t('ui.generateContentWrapper.loadingMessage');
  return (
    <div className={cn('relative', className)}>
      {/* Content area - disabled when generating */}
      <div
        className={cn(
          'transition-all duration-300',
          isGenerating && 'pointer-events-none select-none'
        )}
        style={{
          filter: isGenerating ? 'blur(1px)' : 'none',
          opacity: isGenerating ? 0.4 : 1,
        }}
      >
        {children}
      </div>

      {/* TICKET_916: Overlay -- sticky so it stays visible while scrolling */}
      {isGenerating && (
        <div className="absolute inset-0 z-20 pointer-events-none">
          <div
            className={cn(
              'sticky top-0 z-20 pointer-events-auto',
              'flex flex-col items-center justify-center',
              'bg-color-terminal-bg/60 backdrop-blur-sm',
              'rounded-lg',
              'animate-in fade-in duration-300'
            )}
            style={{ height: '100vh' }}
          >
            <div className="flex flex-col items-center gap-4 p-6">
              <div className="relative">
                <Loader2
                  className="w-10 h-10 text-color-terminal-accent-gold animate-spin"
                />
                <div
                  className="absolute inset-0 w-10 h-10 rounded-full animate-pulse"
                  style={{
                    background: 'radial-gradient(circle, rgba(255,215,0,0.3) 0%, transparent 70%)',
                  }}
                />
              </div>
              <span className="text-sm font-medium text-color-terminal-text-secondary terminal-mono">
                {message}
              </span>
              <div className="flex gap-1">
                <span
                  className="w-1.5 h-1.5 rounded-full bg-color-terminal-accent-gold animate-bounce"
                  style={{ animationDelay: '0ms' }}
                />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-color-terminal-accent-gold animate-bounce"
                  style={{ animationDelay: '150ms' }}
                />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-color-terminal-accent-gold animate-bounce"
                  style={{ animationDelay: '300ms' }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GenerateContentWrapper;
