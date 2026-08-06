/**
 * Quant Lab Plugin Availability Hook
 *
 * TICKET_264: Plugin detection for conditional UI rendering
 * TICKET_570: Simplified - Quant Lab is a bundled plugin, always available
 *
 * Returns constant availability since Quant Lab is bundled with the application.
 */

/**
 * Hook return type
 */
export interface UseQuantLabAvailableReturn {
  /** Whether Quant Lab plugin is installed */
  isAvailable: boolean;
  /** Whether the check is still loading */
  isLoading: boolean;
  /** Error message if check failed */
  error: string | null;
  /** Refresh the availability check (no-op for bundled plugin) */
  refresh: () => void;
}

// No-op function to avoid creating new references on each render
const noop = () => {};

/**
 * Check if Quant Lab plugin is available
 *
 * TICKET_570: Quant Lab is a bundled plugin shipped with the application,
 * so it is always available. No async check needed.
 *
 * @returns Availability state (always available for bundled plugin)
 *
 * @example
 * ```tsx
 * const { isAvailable } = useQuantLabAvailable();
 *
 * return (
 *   <>
 *     <GenerateButton />
 *     {isAvailable && <ExportToQuantLabButton />}
 *   </>
 * );
 * ```
 */
export function useQuantLabAvailable(): UseQuantLabAvailableReturn {
  return {
    isAvailable: true,
    isLoading: false,
    error: null,
    refresh: noop,
  };
}
