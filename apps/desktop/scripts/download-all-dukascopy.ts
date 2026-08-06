#!/usr/bin/env tsx
/**
 * Download all Dukascopy symbols sequentially via the headless service layer.
 *
 * Usage:
 *   npx tsx --tsconfig apps/desktop/tsconfig.json apps/desktop/scripts/download-all-dukascopy.ts [options]
 *
 * Options:
 *   --interval  1h        Timeframe to download (default: 1h)
 *   --asset-type forex    Filter by asset type: forex, crypto, stock, etf, index
 *                         Comma-separated for multiple: forex,crypto
 *   --limit 10            Download only the first N symbols (for testing)
 *   --start-from USDJPY   Resume from a specific symbol (skips earlier ones)
 *
 * Examples:
 *   npx tsx --tsconfig apps/desktop/tsconfig.json apps/desktop/scripts/download-all-dukascopy.ts
 *   npx tsx --tsconfig apps/desktop/tsconfig.json apps/desktop/scripts/download-all-dukascopy.ts --interval 5m --asset-type forex
 *   npx tsx --tsconfig apps/desktop/tsconfig.json apps/desktop/scripts/download-all-dukascopy.ts --interval 1h --limit 5
 *   npx tsx --tsconfig apps/desktop/tsconfig.json apps/desktop/scripts/download-all-dukascopy.ts --interval 1h --start-from USDJPY
 */

import downloadAllDukascopyAction from '../src/headless/actions/data-manager/download-all-dukascopy';

process.on('uncaughtException', (err) => {
  console.error('[download-all-dukascopy] Uncaught exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[download-all-dukascopy] Unhandled rejection:', reason);
  process.exit(1);
});

function parseArgs(argv: string[]): Record<string, unknown> {
  const raw = argv.slice(2);
  const args: Record<string, unknown> = {};
  let i = 0;
  while (i < raw.length) {
    const tok = raw[i];
    if (tok.startsWith('--') && i + 1 < raw.length) {
      const key = tok.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const val = raw[i + 1];
      const num = Number(val);
      args[key] = isNaN(num) ? val : num;
      i += 2;
    } else {
      i++;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  console.log('[download-all-dukascopy] Starting...');
  console.log('[download-all-dukascopy] Args:', JSON.stringify(args));

  const result = await downloadAllDukascopyAction.run(args);

  const icon = result.ok ? 'OK' : 'FAIL';
  console.log(`\n[${icon}] ${result.summary}`);

  if (!result.ok) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[download-all-dukascopy] Fatal:', err);
  process.exit(1);
});
