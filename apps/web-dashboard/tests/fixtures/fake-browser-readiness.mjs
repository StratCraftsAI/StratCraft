#!/usr/bin/env node
/**
 * TICKET_1373 R4 test fixture: a controllable stand-in for the real browser
 * readiness probe.
 *
 * The lifecycle suite drives fake HTTP servers on ephemeral ports, which serve
 * no application at all, so a real Chromium probe would always and correctly
 * report failure. This fixture lets the suite assert the readiness CONTRACT --
 * that a browser verdict is consulted, that a failure is propagated rather
 * than logged, and that no incumbent process is restarted -- independently of
 * a real browser.
 *
 * Behaviour is selected by FAKE_BROWSER_READINESS_RESULT:
 *   ready (default) -> exit 0, application renders
 *   broken          -> exit 1, module evaluation failed
 *   unavailable     -> exit 2, probe itself could not run
 */
const mode = process.env.FAKE_BROWSER_READINESS_RESULT ?? 'ready';
const url = process.argv[2] ?? '<no-url>';
const log = process.env.FAKE_BROWSER_READINESS_LOG;

if (log) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(log, `${mode} ${url}\n`);
}

if (mode === 'ready') {
  console.log(`[webdash] Guide browser application renders at ${url}`);
  process.exit(0);
}
if (mode === 'unavailable') {
  console.error(`[ERROR] Guide is listening but not browser-renderable at ${url}`);
  console.error('        Reason: BROWSER_PROBE_UNAVAILABLE');
  console.error('        Chromium could not launch (fixture)');
  process.exit(2);
}
console.error(`[ERROR] Guide is listening but not browser-renderable at ${url}`);
console.error('        Reason: BROWSER_PAGE_ERROR');
console.error('        Uncaught error during initial render: Module "crypto" has been externalized for browser compatibility. (fixture)');
process.exit(1);
