import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderElectronCapabilityMatrix } from './lib/electron-capability-docs.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const standaloneRoot = path.resolve(scriptDir, '..');
const repositoryRoot = path.resolve(standaloneRoot, '../../../../..');
const manifestPath = path.join(standaloneRoot, 'src/electron-capability-manifest.json');
const outputPath = path.join(
  repositoryRoot,
  'docs/design/TICKET_1235_CAPABILITY_MATRIX.generated.md',
);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const expected = renderElectronCapabilityMatrix(manifest);

if (process.argv.includes('--check')) {
  const actual = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
  if (actual !== expected) {
    process.stderr.write(
      'Generated capability matrix is stale. Run npm run generate:capability-matrix.\n',
    );
    process.exitCode = 1;
  }
} else {
  fs.writeFileSync(outputPath, expected, 'utf8');
  process.stdout.write(`Wrote ${outputPath}\n`);
}
