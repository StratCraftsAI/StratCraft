/** Minimal logger surface injected by each process (electron-log / console). */
export interface ProviderLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}
