import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  RESEARCH_TASK_SPEC_V1_JSON_SCHEMA,
} from '../src/research-task.ts';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(
  packageRoot,
  'contracts',
  'research-task-spec-v1.schema.json',
);
const output = `${JSON.stringify(RESEARCH_TASK_SPEC_V1_JSON_SCHEMA, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const current = await readFile(outputPath, 'utf8');
  if (current !== output) {
    process.stderr.write('Generated ResearchTaskSpec v1 JSON Schema is stale.\n');
    process.exitCode = 1;
  }
} else {
  await writeFile(outputPath, output);
}
