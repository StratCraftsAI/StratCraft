import { join } from 'path';

const PACKAGED_DESKTOP_ICON_FILENAME = 'icon.png';
const DEVELOPMENT_DESKTOP_ICON_RELATIVE_PATH =
  'build/icon-1024x1024.png';

export interface DesktopWindowIconPathOptions {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  resourcesPath: string;
  appPath: string;
}

/**
 * Resolve the native window icon. macOS owns its Dock icon through the
 * application bundle, while Windows and Linux need an explicit BrowserWindow
 * icon during development and Linux window-manager integration.
 */
export function getDesktopWindowIconPath({
  isPackaged,
  platform,
  resourcesPath,
  appPath,
}: DesktopWindowIconPathOptions): string | undefined {
  if (platform === 'darwin') {
    return undefined;
  }

  return isPackaged
    ? join(resourcesPath, PACKAGED_DESKTOP_ICON_FILENAME)
    : join(appPath, DEVELOPMENT_DESKTOP_ICON_RELATIVE_PATH);
}
