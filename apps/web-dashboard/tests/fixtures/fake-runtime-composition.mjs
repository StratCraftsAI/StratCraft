#!/usr/bin/env node
const fingerprint = process.env.FAKE_COMPOSITION_FINGERPRINT ?? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const value = {
  schemaVersion: 1,
  fingerprint,
  tools: ['fixture_tool'],
  commercialPackage: {
    packageId: 'com.stratcraft.quant-lab',
    packageVersion: 'fixture',
    manifestSha256: 'b'.repeat(64),
    hostModuleSha256: 'c'.repeat(64),
    commercialOperationSha256: 'd'.repeat(64),
    operationContractVersion: '1.0.0',
  },
};
if (process.argv[2] === 'fingerprint') process.stdout.write(`${fingerprint}\n`);
else if (process.argv[2] === 'tools') process.stdout.write('fixture_tool\n');
else process.stdout.write(`${JSON.stringify(value)}\n`);
