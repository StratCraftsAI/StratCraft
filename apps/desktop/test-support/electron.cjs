'use strict';

const noop = () => undefined;
const asyncNoop = async () => undefined;

class BrowserWindow {
  static getAllWindows() {
    return [];
  }

  static fromWebContents() {
    return null;
  }

  constructor() {
    this.webContents = {
      on: noop,
      once: noop,
      send: noop,
      setWindowOpenHandler: noop,
    };
  }

  loadFile() {
    return Promise.resolve();
  }

  loadURL() {
    return Promise.resolve();
  }

  on() {}
  once() {}
  show() {}
}

module.exports = {
  app: {
    getAppPath: () => process.cwd(),
    getLocale: () => 'en-US',
    getPath: () => process.cwd(),
    isPackaged: false,
    on: noop,
    once: noop,
    quit: noop,
    whenReady: asyncNoop,
  },
  BrowserWindow,
  contextBridge: { exposeInMainWorld: noop },
  dialog: {
    showErrorBox: noop,
    showMessageBox: asyncNoop,
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true }),
  },
  ipcMain: { handle: noop, on: noop, removeHandler: noop },
  ipcRenderer: { invoke: asyncNoop, on: noop, once: noop, removeListener: noop, send: noop },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: noop },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  nativeTheme: { shouldUseDarkColors: false },
  Notification: class Notification { show() {} },
  protocol: { handle: noop, registerSchemesAsPrivileged: noop },
  safeStorage: {
    decryptString: (value) => Buffer.from(value).toString('utf8'),
    encryptString: (value) => Buffer.from(value, 'utf8'),
    isEncryptionAvailable: () => false,
  },
  session: { defaultSession: {} },
  shell: { openExternal: asyncNoop, openPath: asyncNoop, showItemInFolder: noop },
};
