import { ipcMain } from 'electron';
import {
  extensionCapabilityRequestSchema,
  extensionInvocationSchema,
} from '@StratCraft/types';
import { EXTENSION_BRIDGE_CHANNELS } from '../../shared/constants/channels';
import { getExtensionBridgeRegistry } from '../services/extension-bridge-registry';
import { sendToRenderer } from '../window';

export function registerExtensionBridgeHandlers(): void {
  const registry = getExtensionBridgeRegistry();
  ipcMain.handle(EXTENSION_BRIDGE_CHANNELS.CAPABILITY, (_event, input) =>
    registry.getCapability(extensionCapabilityRequestSchema.parse(input)));
  ipcMain.handle(EXTENSION_BRIDGE_CHANNELS.INVOKE, (_event, input) =>
    registry.invoke(extensionInvocationSchema.parse(input)));
  registry.subscribe((event) => sendToRenderer(EXTENSION_BRIDGE_CHANNELS.EVENT, event));
}
