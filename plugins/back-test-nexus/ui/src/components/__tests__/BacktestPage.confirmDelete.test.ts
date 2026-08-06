/**
 * TICKET_770 -- regression tests for BacktestPage's migration off the
 * inline delete-confirmation dialog onto the shared host ModalProvider.
 *
 * Source-text pinning at the plugin layer (vitest config has no JSDOM
 * for full-render tests). What we pin:
 *
 *   1. The 30-line inline JSX dialog is gone -- the literal English body
 *      text from the old dialog must no longer appear in the .tsx (only
 *      in the locale JSON, which is the right place for it).
 *   2. The local `deleteConfirm` useState + `handleConfirmDelete` +
 *      `handleCancelDelete` are gone (would otherwise be dead code).
 *   3. The Z_INDEX_MODAL import is gone (it was only used by the inline
 *      dialog; leaving it imported is dead code).
 *   4. The local `TrashIcon` SVG component is gone (BacktestHistorySidebar
 *      has its own; BacktestPage's copy was only used by the inline
 *      dialog header).
 *   5. handleDeleteClick is an async function that routes through
 *      globalThis.nexus.window.showConfirm with variant: 'destructive',
 *      and only calls handleDeleteHistory when the user confirms.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pagePath = resolve(__dirname, '..', 'pages', 'BacktestPage.tsx');

function readPage(): string {
  return readFileSync(pagePath, 'utf-8');
}

describe('BacktestPage -- TICKET_770 migration to shared destructive confirm', () => {
  it('inline 30-line delete dialog JSX is gone', () => {
    const src = readPage();
    // Body text was the load-bearing literal of the old dialog.
    expect(src).not.toMatch(/This will permanently delete the backtest result/);
    // No deleteConfirm state, no Cancel/Confirm handlers.
    expect(src).not.toMatch(/deleteConfirm/);
    expect(src).not.toMatch(/handleConfirmDelete/);
    expect(src).not.toMatch(/handleCancelDelete/);
    expect(src).not.toMatch(/setDeleteConfirm/);
  });

  it('Z_INDEX_MODAL import is removed (was only used by the inline dialog)', () => {
    const src = readPage();
    expect(src).not.toMatch(/Z_INDEX_MODAL/);
  });

  it('local TrashIcon SVG is removed (was only used by the inline dialog header)', () => {
    const src = readPage();
    // The component definition is gone. (BacktestHistorySidebar still has
    // its own private TrashIcon -- that is a separate file and unaffected.)
    expect(src).not.toMatch(/const TrashIcon:\s*React\.FC/);
  });

  it('handleDeleteClick is async and routes through nexus.window.showConfirm', () => {
    const src = readPage();
    // The new handler is an `async` arrow function that awaits showConfirm
    // with variant: 'destructive'. We grep on the source rather than try
    // to extract a perfect block -- the signal is unambiguous.
    expect(src).toMatch(/handleDeleteClick\s*=\s*useCallback\s*\(\s*async/);
    expect(src).toMatch(/await\s+globalThis\.nexus\?\.window\?\.showConfirm/);
    expect(src).toMatch(/variant:\s*['"]destructive['"]/);
  });

  it('handleDeleteClick only deletes when the confirm resolves truthy', () => {
    const src = readPage();
    // Pin that handleDeleteHistory is gated behind the confirmation check.
    // Two specific anti-patterns we want to block:
    //   - calling handleDeleteHistory before the await (would delete with
    //     no confirmation)
    //   - calling handleDeleteHistory in a catch (would delete on host
    //     injection failure, which we want fail-closed)
    expect(src).toMatch(/if\s*\(\s*confirmed[^)]*\)\s*\{[^}]*handleDeleteHistory/);
    expect(src).not.toMatch(/catch[^}]*handleDeleteHistory/);
  });
});
