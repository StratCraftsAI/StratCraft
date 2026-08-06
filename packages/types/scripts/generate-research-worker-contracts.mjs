import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import path from 'node:path';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  RESEARCH_WORKER_CONTROL_MESSAGE_V1_JSON_SCHEMA,
  RESEARCH_WORKER_DISCOVERY_V1_JSON_SCHEMA,
  RESEARCH_WORKER_PACKAGE_V1_JSON_SCHEMA,
  RESEARCH_DISCOVERY_REQUEST_V1_JSON_SCHEMA,
  RESEARCH_DISCOVERY_RESULT_V1_JSON_SCHEMA,
  RESEARCH_LSTM_TRAINING_REQUEST_V1_JSON_SCHEMA,
  RESEARCH_LSTM_TRAINING_RESULT_V1_JSON_SCHEMA,
} = await import('../src/research-worker-protocol.ts');
const {
  COMMERCIAL_OPERATION_REQUEST_V1_JSON_SCHEMA,
  COMMERCIAL_OPERATION_RESULT_V1_JSON_SCHEMA,
  COMMERCIAL_OPERATION_PROGRESS_V1_JSON_SCHEMA,
  COMMERCIAL_CAPABILITY_PROJECTION_V1_JSON_SCHEMA,
} = await import('../src/commercial-operation.ts');

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputs = new Map([
  [
    'research-worker-control-message-v1.schema.json',
    RESEARCH_WORKER_CONTROL_MESSAGE_V1_JSON_SCHEMA,
  ],
  [
    'research-worker-discovery-v1.schema.json',
    RESEARCH_WORKER_DISCOVERY_V1_JSON_SCHEMA,
  ],
  [
    'research-worker-package-v1.schema.json',
    RESEARCH_WORKER_PACKAGE_V1_JSON_SCHEMA,
  ],
  [
    'research-discovery-request-v1.schema.json',
    RESEARCH_DISCOVERY_REQUEST_V1_JSON_SCHEMA,
  ],
  [
    'research-discovery-result-v1.schema.json',
    RESEARCH_DISCOVERY_RESULT_V1_JSON_SCHEMA,
  ],
  [
    'research-lstm-training-request-v1.schema.json',
    RESEARCH_LSTM_TRAINING_REQUEST_V1_JSON_SCHEMA,
  ],
  [
    'research-lstm-training-result-v1.schema.json',
    RESEARCH_LSTM_TRAINING_RESULT_V1_JSON_SCHEMA,
  ],
  [
    'commercial-operation-request-v1.schema.json',
    COMMERCIAL_OPERATION_REQUEST_V1_JSON_SCHEMA,
  ],
  [
    'commercial-operation-result-v1.schema.json',
    COMMERCIAL_OPERATION_RESULT_V1_JSON_SCHEMA,
  ],
  [
    'commercial-operation-progress-v1.schema.json',
    COMMERCIAL_OPERATION_PROGRESS_V1_JSON_SCHEMA,
  ],
  [
    'commercial-capability-projection-v1.schema.json',
    COMMERCIAL_CAPABILITY_PROJECTION_V1_JSON_SCHEMA,
  ],
]);

for (const [fileName, schema] of outputs) {
  const outputPath = path.join(packageRoot, 'contracts', fileName);
  const output = `${JSON.stringify(schema, null, 2)}\n`;
  if (process.argv.includes('--check')) {
    const current = await readFile(outputPath, 'utf8');
    if (current !== output) {
      process.stderr.write(`Generated research worker contract is stale: ${fileName}\n`);
      process.exitCode = 1;
    }
  } else {
    await writeFile(outputPath, output);
  }
}
