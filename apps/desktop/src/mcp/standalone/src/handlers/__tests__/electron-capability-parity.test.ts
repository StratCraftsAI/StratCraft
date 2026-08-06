import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import manifestJson from '../../electron-capability-manifest.json';
import {
  extractElectronCapabilitySources,
  type ElectronCapabilitySourceInventory,
} from './support/electron-capability-source';
import {
  validateElectronCapabilityManifest,
  type ElectronCapabilityManifest,
} from './support/electron-capability-parity';
import { renderElectronCapabilityMatrix } from '../../../scripts/lib/electron-capability-docs.mjs';

const desktopRoot = path.resolve(__dirname, '../../../../../..');
const manifest = manifestJson as ElectronCapabilityManifest;
const source = extractElectronCapabilitySources(desktopRoot);

function cloneSource(): ElectronCapabilitySourceInventory {
  return structuredClone(source);
}

function validate(
  candidateManifest: ElectronCapabilityManifest = manifest,
  candidateSource: ElectronCapabilitySourceInventory = source,
): string[] {
  return validateElectronCapabilityManifest(candidateManifest, candidateSource, desktopRoot);
}

describe('TICKET_1302 U0: Electron capability parity', () => {
  it('classifies every current preload method and IPC channel', () => {
    expect(validate()).toEqual([]);
    expect(manifest.capabilities).not.toHaveLength(0);
    expect(source.preloadMethods).not.toHaveLength(0);
    expect(source.ipcRegistrations).not.toHaveLength(0);
  });

  it('keeps the generated TICKET_1235 matrix synchronized with the manifest', () => {
    const matrixPath = path.resolve(
      desktopRoot,
      '../../docs/design/TICKET_1235_CAPABILITY_MATRIX.generated.md',
    );
    expect(fs.readFileSync(matrixPath, 'utf8')).toBe(
      renderElectronCapabilityMatrix(manifest),
    );
  });

  it('maps every covered user capability to registered typed MCP tools', () => {
    const registeredTools = new Set(source.mcpTools);
    const covered = manifest.capabilities.filter(
      ({ classification }) => classification === 'covered-user-capability',
    );
    expect(covered).not.toHaveLength(0);
    for (const capability of covered) {
      expect(capability.mcpTools).not.toHaveLength(0);
      expect(capability.mcpTools.every((tool) => registeredTools.has(tool))).toBe(true);
      expect(capability.mcpTools).not.toContain('run_action');
      expect(capability.mcpTools).not.toContain('run_diagnostic');
    }
  });

  it('keeps reviewed gaps explicit until their typed contracts land', () => {
    const uncovered = manifest.capabilities.filter(
      ({ classification }) => classification === 'uncovered-user-capability',
    );
    for (const capability of uncovered) {
      expect(capability.targetMcpTools).not.toHaveLength(0);
    }
  });

  it('closes the Phase 3 residual inventory without retired stubs', () => {
    expect(
      manifest.capabilities.filter(
        ({ classification }) => classification === 'uncovered-user-capability',
      ),
    ).toEqual([]);
    expect(
      manifest.capabilities.flatMap(({ targetMcpTools = [] }) => targetMcpTools),
    ).toEqual([]);
    expect(manifest.capabilities.some(({ id }) => id === 'ch2')).toBe(false);
    expect(source.preloadMethods.some(({ method }) => method === 'subscribeMarketData')).toBe(false);
    expect(
      source.ipcRegistrations.some(
        ({ channel }) => channel === 'market:subscribe' || channel === 'market:unsubscribe',
      ),
    ).toBe(false);

    const marketReads = manifest.capabilities.find(({ id }) => id === 'ch1');
    expect(marketReads?.ownership).toBe('class-r');
    expect(marketReads?.ownershipNotes).toContain('market-data-api');
  });

  it('keeps duplicate headless rails as envelopes over the typed-tool owner', () => {
    const convergedActions: Array<{ file: string; delegates: RegExp[] }> = [
      {
        file: 'src/headless/actions/quant-lab/start-sweep.ts',
        delegates: [/await startSweep\(body\)/],
      },
      {
        file: 'src/headless/actions/quant-lab/stop-sweep.ts',
        delegates: [/const result = stopSweep\(\)/],
      },
      {
        file: 'src/headless/actions/quant-lab/get-sweep-status.ts',
        delegates: [/const \{ data \} = getSweepStatus\(\)/],
      },
      {
        file: 'src/headless/actions/backtester/run-backtest.ts',
        delegates: [/await handleRunBacktest\(/],
      },
      {
        file: 'src/headless/actions/backtester/get-backtest-status.ts',
        delegates: [/await handleGetBacktestResult\(/, /await handleListBacktestResults\(/],
      },
      {
        file: 'src/headless/actions/strategy-builder/list-strategies.ts',
        delegates: [/await handleListStrategies\(/],
      },
      {
        file: 'src/headless/actions/strategy-builder/generate-strategy.ts',
        delegates: [/await handleGenerateStrategy\(/],
      },
      {
        file: 'src/headless/actions/scoreboard/get-scoreboard.ts',
        delegates: [/await handleGetSignalScoreboard\(/],
      },
    ];

    for (const { file, delegates } of convergedActions) {
      const sourceText = fs.readFileSync(path.join(desktopRoot, file), 'utf8');
      for (const delegate of delegates) {
        expect(sourceText, `${file} lost its authoritative delegate`).toMatch(delegate);
      }
      expect(sourceText, `${file} reintroduced bridge discovery`).not.toContain(
        'discoverServiceApi(',
      );
      expect(sourceText, `${file} reintroduced an independent HTTP rail`).not.toMatch(
        /\b(?:authenticatedFetch|fetch)\(/,
      );
    }
  });

  it('fails when a new IPC channel is not classified', () => {
    const candidateSource = cloneSource();
    candidateSource.ipcRegistrations.push({
      channel: 'fixture:new-user-capability',
      kind: 'handle',
      source: { file: 'src/main/ipc/system.ts', line: 1 },
    });
    expect(validate(manifest, candidateSource)).toContain(
      'IPC channel is missing from the manifest: fixture:new-user-capability',
    );
  });

  it('fails when a new preload method is not classified', () => {
    const candidateSource = cloneSource();
    candidateSource.preloadMethods.push({
      method: 'fixture.newUserCapability',
      channels: [],
      source: { file: 'src/preload/index.ts', line: 1 },
    });
    expect(validate(manifest, candidateSource)).toContain(
      'Preload method is missing from the manifest: fixture.newUserCapability',
    );
  });

  it('fails when a mapped MCP tool is removed', () => {
    const candidateSource = cloneSource();
    candidateSource.mcpTools = candidateSource.mcpTools.filter(
      (tool) => tool !== 'generate_strategy',
    );
    expect(validate(manifest, candidateSource)).toContain(
      'Capability s1 references an unregistered MCP tool: generate_strategy',
    );
  });

  it('fails when an uncovered target lands without manifest ratification', () => {
    const candidateManifest = structuredClone(manifest);
    const providerDefaults = candidateManifest.capabilities.find(
      ({ id }) => id === 'd8',
    )!;
    providerDefaults.classification = 'uncovered-user-capability';
    providerDefaults.mcpTools = [];
    providerDefaults.targetMcpTools = ['set_provider_defaults'];
    const candidateSource = cloneSource();
    expect(validate(candidateManifest, candidateSource)).toContain(
      'Uncovered capability d8 has a now-registered target tool: set_provider_defaults',
    );
  });

  it('rejects duplicate source classifications and capability identifiers', () => {
    const candidateManifest = structuredClone(manifest);
    candidateManifest.capabilities[1].id = candidateManifest.capabilities[0].id;
    candidateManifest.capabilities[1].ipcChannels.push(
      candidateManifest.capabilities[0].ipcChannels[0],
    );
    candidateManifest.capabilities[1].preloadMethods.push(
      candidateManifest.capabilities[0].preloadMethods[0],
    );
    const errors = validate(candidateManifest);
    expect(errors).toContain(`Duplicate capability id: ${candidateManifest.capabilities[0].id}`);
    expect(errors).toContain(
      `IPC channel is classified more than once: ${candidateManifest.capabilities[0].ipcChannels[0]}`,
    );
    expect(errors).toContain(
      `Preload method is classified more than once: ${candidateManifest.capabilities[0].preloadMethods[0]}`,
    );
  });

  it('rejects generic coverage, stale source references, and invalid exclusions', () => {
    const candidateManifest = structuredClone(manifest);
    const covered = candidateManifest.capabilities.find(
      ({ classification }) => classification === 'covered-user-capability',
    )!;
    covered.mcpTools = ['run_action'];
    covered.owningSources = ['src/main/ipc/does-not-exist.ts'];

    const excluded = candidateManifest.capabilities.find(
      ({ classification }) => classification === 'internal-only',
    )!;
    excluded.rationale = '';
    excluded.authTiers = ['T0'];

    const mixed = candidateManifest.capabilities.find(
      ({ ownership }) => ownership === 'mixed',
    )!;
    mixed.ownershipNotes = '';

    const errors = validate(candidateManifest);
    expect(errors).toContain(`Capability ${covered.id} relies on forbidden generic tool: run_action`);
    expect(errors).toContain(
      `Capability ${covered.id} has a missing source reference: src/main/ipc/does-not-exist.ts`,
    );
    expect(errors).toContain(`Excluded capability ${excluded.id} has no reviewed rationale`);
    expect(errors).toContain(`Excluded capability ${excluded.id} must not declare an auth tier`);
    expect(errors).toContain(`Mixed-ownership capability ${mixed.id} has no S/R split rationale`);
  });

  it('rejects unknown contract enums and duplicate target ownership', () => {
    const candidateManifest = structuredClone(manifest);
    const invalid = candidateManifest.capabilities[0];
    invalid.classification = 'unknown' as typeof invalid.classification;
    invalid.ownership = 'unknown' as typeof invalid.ownership;
    invalid.authTiers = ['T9' as 'T0'];

    const first = candidateManifest.capabilities[1];
    const second = candidateManifest.capabilities[2];
    first.classification = 'uncovered-user-capability';
    second.classification = 'uncovered-user-capability';
    first.mcpTools = [];
    second.mcpTools = [];
    first.targetMcpTools = ['fixture_duplicate_target'];
    second.targetMcpTools = ['fixture_duplicate_target'];

    const errors = validate(candidateManifest);
    expect(errors).toContain(`Capability ${invalid.id} has an unknown classification: unknown`);
    expect(errors).toContain(`Capability ${invalid.id} has an unknown ownership class: unknown`);
    expect(errors).toContain(`Capability ${invalid.id} has an unknown auth tier: T9`);
    expect(errors).toContain(
      'Target MCP tool is assigned to more than one capability: fixture_duplicate_target',
    );
  });
});
