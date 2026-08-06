/**
 * TICKET_570: useQuantLabAvailable unit tests (strategy-builder-nexus)
 *
 * Verifies that the hook returns constant availability since
 * Quant Lab is a bundled plugin. The hook is a pure function
 * (no React hooks), so it can be tested directly.
 */
import { describe, it, expect } from 'vitest';
import { useQuantLabAvailable } from '../useQuantLabAvailable';

describe('useQuantLabAvailable (strategy-builder-nexus)', () => {
  it('should return isAvailable as true (bundled plugin)', () => {
    const result = useQuantLabAvailable();
    expect(result.isAvailable).toBe(true);
  });

  it('should return isLoading as false (no async check needed)', () => {
    const result = useQuantLabAvailable();
    expect(result.isLoading).toBe(false);
  });

  it('should return no error', () => {
    const result = useQuantLabAvailable();
    expect(result.error).toBeNull();
  });

  it('should return a stable refresh function across calls', () => {
    const result1 = useQuantLabAvailable();
    const result2 = useQuantLabAvailable();
    expect(result1.refresh).toBe(result2.refresh);
  });

  it('refresh should be callable without error', () => {
    const result = useQuantLabAvailable();
    expect(() => result.refresh()).not.toThrow();
  });
});
