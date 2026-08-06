/**
 * @StratCraft/config-file -- cross-process-safe JSON config file access
 * (TICKET_1276): advisory lock + atomic tmp/fsync/rename writes for config
 * files shared by the Electron main process and the MCP standalone server.
 */

export { readJsonConfigFile, updateJsonConfigFile } from './json-config-file';
export {
  readJsoncConfigFile,
  updateJsoncConfigValue,
} from './jsonc-config-file';
