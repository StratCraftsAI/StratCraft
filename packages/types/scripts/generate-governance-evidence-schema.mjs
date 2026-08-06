import { createHash } from 'node:crypto';
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
  GOVERNANCE_EVIDENCE_ENVELOPE_V1_JSON_SCHEMA,
  governanceEvidenceEnvelopeV1Schema,
} = await import('../src/agent-attribution.ts');
const { canonicalAgentJson } = await import('../src/agent-runtime.ts');

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(
  packageRoot,
  'contracts',
  'governance-evidence-envelope-v1.schema.json',
);
const output = `${JSON.stringify(GOVERNANCE_EVIDENCE_ENVELOPE_V1_JSON_SCHEMA, null, 2)}\n`;
const goldenPath = path.join(
  packageRoot,
  'contracts',
  'governance-evidence-envelope-v1.golden.json',
);
const existingGolden = JSON.parse(await readFile(goldenPath, 'utf8'));
const envelope = { ...existingGolden.envelope };
for (let iteration = 0; iteration < 4; iteration += 1) {
  envelope.envelopeByteCount = Buffer.byteLength(canonicalAgentJson(envelope));
}
const validatedEnvelope = governanceEvidenceEnvelopeV1Schema.parse(envelope);
const canonical = canonicalAgentJson(validatedEnvelope);
const hash = `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
const goldenOutput = `${JSON.stringify({
  envelope: validatedEnvelope,
  canonical,
  hash,
}, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const [currentSchema, currentGolden] = await Promise.all([
    readFile(outputPath, 'utf8'),
    readFile(goldenPath, 'utf8'),
  ]);
  if (currentSchema !== output || currentGolden !== goldenOutput) {
    process.stderr.write('Generated GovernanceEvidenceEnvelopeV1 JSON Schema is stale.\n');
    process.exitCode = 1;
  }
} else {
  await Promise.all([
    writeFile(outputPath, output),
    writeFile(goldenPath, goldenOutput),
  ]);
}
