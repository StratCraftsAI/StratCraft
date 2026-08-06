/**
 * Host store stubs for plugin tsc compilation.
 *
 * At runtime, the host injects the real stores via __nexus_modules__.
 * This file provides type-compatible stubs so tsc can resolve '@/stores'.
 */

type AppStoreState = {
  pageTitle: string | null;
  setPageTitle: (title: string | null) => void;
};

/**
 * Stub useAppStore -- real implementation injected by host at runtime.
 */
export function useAppStore<T>(selector: (state: AppStoreState) => T): T {
  return selector({
    pageTitle: null,
    setPageTitle: () => {},
  });
}
