/**
 * Utility functions for Strategy Plugin
 */

/**
 * Merge class names conditionally
 * Simplified version of clsx/tailwind-merge
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}
