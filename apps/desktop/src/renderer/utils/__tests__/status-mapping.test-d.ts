/**
 * TICKET_763 -- compile-time exhaustiveness contract for mapStatus.
 *
 * This file is NOT executed by vitest (which scans *.test.ts). It is
 * validated by `tsc --noEmit` -- the @ts-expect-error directives below FAIL
 * the typecheck if mapStatus stops enforcing the missing-branch contract.
 */

import { mapStatus } from '../status-mapping';

type LoadStatus = 'idle' | 'running' | 'success' | 'error' | 'cancelled';

// Exhaustive mapping -- compiles cleanly.
const ok: 'a' | 'b' = mapStatus<LoadStatus, 'a' | 'b'>('idle', {
  idle: 'a',
  running: 'b',
  success: 'a',
  error: 'b',
  cancelled: 'a',
});
void ok;

// Missing the `error` and `cancelled` branches -- this MUST be a type error.
// If it ever compiles, mapStatus has lost its exhaustiveness guarantee.
// The error is reported on the call expression (not the object literal), so
// the @ts-expect-error directive sits directly above the `mapStatus<...>` call.
// @ts-expect-error -- intentionally missing `error` and `cancelled` branches
const missingBranch: 'a' | 'b' = mapStatus<LoadStatus, 'a' | 'b'>('idle', {
  idle: 'a',
  running: 'b',
  success: 'a',
});
void missingBranch;

// Extra branch with a key not in the union -- also rejected.
// Excess-property check fires on the bogus key inside the object literal.
const extraBranch: 'a' | 'b' = mapStatus<LoadStatus, 'a' | 'b'>('idle', {
  idle: 'a',
  running: 'b',
  success: 'a',
  error: 'b',
  cancelled: 'a',
  // @ts-expect-error -- 'bogus' is not part of LoadStatus
  bogus: 'a',
});
void extraBranch;
