import {
  EXTENSION_BRIDGE_CONTRACT_VERSION,
  type ExtensionCapabilityRequest,
  type ExtensionEvent,
  type ExtensionInvocation,
  type ExtensionJsonValue,
} from '@StratCraft/types';

export interface ExtensionBridgeAdapter {
  readonly getCapability: (command: string) => unknown | Promise<unknown>;
  readonly invoke: (invocation: ExtensionInvocation) => unknown | Promise<unknown>;
  readonly subscribe: (
    listener: (event: string, payload: ExtensionJsonValue) => void,
  ) => () => void;
}

function packageAbsent(extensionId: string): Record<string, ExtensionJsonValue> {
  return {
    state: 'absent',
    code: 'EXTENSION_PACKAGE_ABSENT',
    message: `Extension package ${extensionId} is not active.`,
    remediation: 'Install or reactivate the signed extension package.',
  };
}

/** Generic process-local router. It contains no extension command inventory. */
export class ExtensionBridgeRegistry {
  private readonly adapters = new Map<string, ExtensionBridgeAdapter>();
  private readonly adapterSubscriptions = new Map<string, () => void>();
  private readonly listeners = new Set<(event: ExtensionEvent) => void>();

  register(extensionId: string, adapter: ExtensionBridgeAdapter): () => void {
    if (this.adapters.has(extensionId)) {
      throw new Error(`Extension bridge adapter is already registered: ${extensionId}`);
    }
    this.adapters.set(extensionId, adapter);
    const unsubscribe = adapter.subscribe((event, payload) => {
      const envelope: ExtensionEvent = {
        contractVersion: EXTENSION_BRIDGE_CONTRACT_VERSION,
        extensionId,
        event,
        payload,
      };
      for (const listener of this.listeners) listener(envelope);
    });
    this.adapterSubscriptions.set(extensionId, unsubscribe);
    return () => {
      if (this.adapters.get(extensionId) !== adapter) return;
      this.adapterSubscriptions.get(extensionId)?.();
      this.adapterSubscriptions.delete(extensionId);
      this.adapters.delete(extensionId);
    };
  }

  async getCapability(request: ExtensionCapabilityRequest): Promise<unknown> {
    const adapter = this.adapters.get(request.extensionId);
    return adapter
      ? adapter.getCapability(request.command)
      : packageAbsent(request.extensionId);
  }

  async invoke(invocation: ExtensionInvocation): Promise<unknown> {
    const adapter = this.adapters.get(invocation.extensionId);
    return adapter
      ? adapter.invoke(invocation)
      : packageAbsent(invocation.extensionId);
  }

  subscribe(listener: (event: ExtensionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reset(): void {
    for (const unsubscribe of this.adapterSubscriptions.values()) unsubscribe();
    this.adapterSubscriptions.clear();
    this.adapters.clear();
    this.listeners.clear();
  }
}

const extensionBridgeRegistry = new ExtensionBridgeRegistry();

export function getExtensionBridgeRegistry(): ExtensionBridgeRegistry {
  return extensionBridgeRegistry;
}
