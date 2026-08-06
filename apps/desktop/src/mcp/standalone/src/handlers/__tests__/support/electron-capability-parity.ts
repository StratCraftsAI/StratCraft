import fs from 'node:fs';
import path from 'node:path';
import type {
  ElectronCapabilitySourceInventory,
} from './electron-capability-source';

export type CapabilityClassification =
  | 'covered-user-capability'
  | 'uncovered-user-capability'
  | 'internal-only'
  | 'deprecated-duplicate'
  | 'lower-layer-of-covered-capability';

export interface ElectronCapability {
  id: string;
  name: string;
  domain: string;
  classification: CapabilityClassification;
  ownership: 'class-s' | 'class-r' | 'mixed' | 'not-applicable';
  authTiers: Array<'T0' | 'T1' | 'T2'>;
  owningSources: string[];
  preloadMethods: string[];
  ipcChannels: string[];
  mcpTools: string[];
  targetMcpTools?: string[];
  ownershipNotes?: string;
  rationale?: string;
}

export interface ElectronCapabilityManifest {
  schemaVersion: number;
  generatedFrom: {
    preload: string;
    ipc: string;
    mcpRegistry: string;
  };
  capabilities: ElectronCapability[];
}

const USER_CLASSIFICATIONS = new Set<CapabilityClassification>([
  'covered-user-capability',
  'uncovered-user-capability',
]);
const ALL_CLASSIFICATIONS = new Set<CapabilityClassification>([
  ...USER_CLASSIFICATIONS,
  'internal-only',
  'deprecated-duplicate',
  'lower-layer-of-covered-capability',
]);
const OWNERSHIP_CLASSES = new Set(['class-s', 'class-r', 'mixed', 'not-applicable']);
const AUTH_TIERS = new Set(['T0', 'T1', 'T2']);
const GENERIC_ESCAPE_HATCHES = new Set(['run_action', 'run_diagnostic']);

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      repeated.add(value);
    }
    seen.add(value);
  }
  return [...repeated].sort();
}

function compareSets(
  label: string,
  expected: Iterable<string>,
  actual: Iterable<string>,
  errors: string[],
): void {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  for (const missing of [...expectedSet].filter((value) => !actualSet.has(value)).sort()) {
    errors.push(`${label} is missing from the manifest: ${missing}`);
  }
  for (const stale of [...actualSet].filter((value) => !expectedSet.has(value)).sort()) {
    errors.push(`${label} is stale in the manifest: ${stale}`);
  }
}

export function validateElectronCapabilityManifest(
  manifest: ElectronCapabilityManifest,
  source: ElectronCapabilitySourceInventory,
  desktopRoot: string,
): string[] {
  const errors: string[] = [];
  if (manifest.schemaVersion !== 1) {
    errors.push(`Unsupported capability manifest schema version: ${manifest.schemaVersion}`);
  }

  for (const duplicateId of duplicates(manifest.capabilities.map(({ id }) => id))) {
    errors.push(`Duplicate capability id: ${duplicateId}`);
  }

  const allManifestChannels = manifest.capabilities.flatMap(({ ipcChannels }) => ipcChannels);
  const allManifestMethods = manifest.capabilities.flatMap(({ preloadMethods }) => preloadMethods);
  const allTargetTools = manifest.capabilities.flatMap(({ targetMcpTools = [] }) => targetMcpTools);
  for (const channel of duplicates(allManifestChannels)) {
    errors.push(`IPC channel is classified more than once: ${channel}`);
  }
  for (const method of duplicates(allManifestMethods)) {
    errors.push(`Preload method is classified more than once: ${method}`);
  }
  for (const tool of duplicates(allTargetTools)) {
    errors.push(`Target MCP tool is assigned to more than one capability: ${tool}`);
  }

  compareSets(
    'IPC channel',
    source.ipcRegistrations.map(({ channel }) => channel),
    allManifestChannels,
    errors,
  );
  compareSets(
    'Preload method',
    source.preloadMethods.map(({ method }) => method),
    allManifestMethods,
    errors,
  );

  const registeredTools = new Set(source.mcpTools);
  const sourceMethods = new Map(source.preloadMethods.map((method) => [method.method, method]));
  for (const capability of manifest.capabilities) {
    if (!/^[a-z][a-z0-9-]*$/.test(capability.id)) {
      errors.push(`Capability id is not stable kebab-case: ${capability.id}`);
    }
    if (!ALL_CLASSIFICATIONS.has(capability.classification)) {
      errors.push(`Capability ${capability.id} has an unknown classification: ${capability.classification}`);
    }
    if (!OWNERSHIP_CLASSES.has(capability.ownership)) {
      errors.push(`Capability ${capability.id} has an unknown ownership class: ${capability.ownership}`);
    }
    for (const tier of capability.authTiers) {
      if (!AUTH_TIERS.has(tier)) {
        errors.push(`Capability ${capability.id} has an unknown auth tier: ${tier}`);
      }
    }
    if (capability.name.trim() === '' || capability.domain.trim() === '') {
      errors.push(`Capability ${capability.id} must name its capability and domain`);
    }

    const userCapability = USER_CLASSIFICATIONS.has(capability.classification);
    if (userCapability && capability.authTiers.length === 0) {
      errors.push(`User capability ${capability.id} has no ratified auth tier`);
    }
    if (!userCapability && capability.authTiers.length > 0) {
      errors.push(`Excluded capability ${capability.id} must not declare an auth tier`);
    }
    if (
      (capability.classification === 'internal-only'
        || capability.classification === 'deprecated-duplicate'
        || capability.classification === 'lower-layer-of-covered-capability')
      && !capability.rationale?.trim()
    ) {
      errors.push(`Excluded capability ${capability.id} has no reviewed rationale`);
    }
    if (capability.ownership === 'mixed' && !capability.ownershipNotes?.trim()) {
      errors.push(`Mixed-ownership capability ${capability.id} has no S/R split rationale`);
    }

    if (capability.classification === 'covered-user-capability') {
      if (capability.mcpTools.length === 0) {
        errors.push(`Covered capability ${capability.id} has no typed MCP tool`);
      }
      if ((capability.targetMcpTools?.length ?? 0) > 0) {
        errors.push(`Covered capability ${capability.id} still declares target MCP tools`);
      }
    }
    if (capability.classification === 'uncovered-user-capability') {
      if ((capability.targetMcpTools?.length ?? 0) === 0) {
        errors.push(`Uncovered capability ${capability.id} has no explicit target MCP contract`);
      }
      for (const target of capability.targetMcpTools ?? []) {
        if (registeredTools.has(target)) {
          errors.push(`Uncovered capability ${capability.id} has a now-registered target tool: ${target}`);
        }
      }
    }

    for (const tool of capability.mcpTools) {
      if (GENERIC_ESCAPE_HATCHES.has(tool)) {
        errors.push(`Capability ${capability.id} relies on forbidden generic tool: ${tool}`);
      } else if (!registeredTools.has(tool)) {
        errors.push(`Capability ${capability.id} references an unregistered MCP tool: ${tool}`);
      }
    }

    const actualOwningSources = new Set(
      source.ipcRegistrations
        .filter(({ channel }) => capability.ipcChannels.includes(channel))
        .map(({ source: location }) => location.file),
    );
    compareSets(
      `Owning source for capability ${capability.id}`,
      actualOwningSources,
      capability.owningSources,
      errors,
    );
    for (const sourceReference of capability.owningSources) {
      if (!fs.existsSync(path.join(desktopRoot, sourceReference))) {
        errors.push(`Capability ${capability.id} has a missing source reference: ${sourceReference}`);
      }
    }

    const capabilityChannels = new Set(capability.ipcChannels);
    for (const methodName of capability.preloadMethods) {
      const method = sourceMethods.get(methodName);
      if (!method) {
        continue;
      }
      for (const channel of method.channels) {
        if (
          source.ipcRegistrations.some((registration) => registration.channel === channel)
          && !capabilityChannels.has(channel)
        ) {
          errors.push(
            `Preload method ${methodName} references ${channel}, which belongs to another capability`,
          );
        }
      }
    }
  }

  return errors;
}
