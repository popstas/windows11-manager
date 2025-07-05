const { virtualDesktop } = require('./virtual-desktop');
const { getConfig } = require('./config');

function setWallpapers() {
  const config = getConfig();
  if (!config.wallpapers) return;
  for (let desktop in config.wallpapers) {
    const wpPath = config.wallpapers[desktop];
    virtualDesktop.setDesktopWallpaper(desktop, wpPath);
  }
}

module.exports = { setWallpapers };
