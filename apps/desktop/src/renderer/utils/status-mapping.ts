/**
 * status-mapping
 *
 * TICKET_763 Layer 2: exhaustive status -> visual-state mapping.
 *
 * Generic on the status union so each flow can declare its own literal type
 * (Signal Discovery uses `'completed'`; executor uses `'success'`, etc.).
 * TypeScript enforces exhaustiveness via `Record<TStatus, T>` -- omitting a
 * branch is a compile error, not a runtime UX bug.
 */

export function mapStatus<TStatus extends string, T>(
  status: TStatus,
  branches: Record<TStatus, T>,
): T {
  return branches[status];
}
