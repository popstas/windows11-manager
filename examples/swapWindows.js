// not work
import { windowManager } from "node-window-manager";

function start() {
  windowManager.getActiveWindow();

  const windowIds = [];
  const windows = [];

  const id = setInterval(() => {
    const w = windowManager.getActiveWindow();
    if (!w.getTitle()) return;

    if (windowIds.includes(w.id)) return;

    windowIds.push(w.id);
    windows.push(w);

    // console.log('w: ', w);
    // console.log('w.isWindow(): ', w.isWindow());
    // console.log('w.getBounds(): ', w.getBounds());
    // console.log('w.getTitle(): ', w.getTitle());

    if (windowIds.length > 1) {
      clearInterval(id);
      swapWindows(windows);
    }
  }, 100);
}

function swapWindows(windows) {
  const [w1, w2] = windows;

  const b1 = w1.getBounds();
  const b2 = w2.getBounds();

  w1.setBounds(b2);
  w2.setBounds(b1);
}

start();
