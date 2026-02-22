import { virtualDesktop } from './virtual-desktop.js';
import { getConfig } from './config.js';

function setWallpapers() {
  const config = getConfig();
  if (!config.wallpapers) return;
  for (let desktop in config.wallpapers) {
    const wpPath = config.wallpapers[desktop];
    virtualDesktop.setDesktopWallpaper(desktop, wpPath);
  }
}

export { setWallpapers };
