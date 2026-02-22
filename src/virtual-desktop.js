import { exec } from 'node:child_process';
import { getConfig } from './config.js';

function vd11Command(args) {
  const vd11Path = getConfig().virtualDesktopPath;
  const cmd = `${vd11Path} ${args}`;
  return new Promise((resolve) => {
    exec(cmd, (error, stdout, stderr) => {
      if (stdout) resolve(stdout);
      if (stderr) {
        console.error(`${cmd} - ${stderr}`);
        resolve(null);
      }
    });
  });
}

const virtualDesktop = {
  PinWindow(id) { return vd11Command(`PinWindowHandle:${id}`); },
  async IsPinnedWindow(id) {
    const res = await vd11Command(`IsWindowHandlePinned:${id}`);
    if (res.match(/is not pinned/)) return false;
    if (res.match(/is pinned/)) return true;
    return null;
  },
  async GetWindowDesktopNumber(id) {
    const res = await vd11Command(`GetDesktopFromWindowHandle:${id}`);
    const m = res.match(/desktop number (\d+)/);
    if (m) return m[1];
  },
  MoveWindowToDesktopNumber(id, num) { return vd11Command(`gd:${num} MoveWindowHandle:${id}`); },
  MoveActiveWindowToDesktopNumber(num) { return vd11Command(`gd:${num} MoveActiveWindow`); },
  GoToDesktopNumber(num) { console.log(`switch ${num}`); return vd11Command(`switch:${num}`); },
  setDesktopWallpaper(desktop, path) { console.log(`setDesktopWallpaper ${desktop}: ${path}`); return vd11Command(`gd:${desktop} wp:${path}`); },
};

export { vd11Command, virtualDesktop };
