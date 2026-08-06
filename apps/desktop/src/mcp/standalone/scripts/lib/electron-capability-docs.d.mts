interface ElectronCapability {
  id: string;
  domain: string;
  name: string;
  classification: string;
  ownership: string;
  ownershipNotes?: string;
  authTiers: string[];
  preloadMethods: string[];
  ipcChannels: string[];
  mcpTools: string[];
  targetMcpTools?: string[];
  owningSources: string[];
  rationale?: string;
}

export function renderElectronCapabilityMatrix(manifest: {
  capabilities: ElectronCapability[];
}): string;
