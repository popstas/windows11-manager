import WebSocket from 'ws';
import { placeWindowByConfig, placeWindows } from './placement.js';
import { storeWindows, restoreWindows } from './store.js';
import { virtualDesktop } from './virtual-desktop.js';

const port = process.argv[2] || '9721';
const WS_URL = `ws://127.0.0.1:${port}`;

function connect() {
  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log(`WS connected to ${WS_URL}`);
  });

  ws.on('message', async (data) => {
    try {
      const { command, payload } = JSON.parse(data.toString());
      console.log(`WS ${command}: ${payload}`);

      switch (command) {
        case 'place': {
          const rule = JSON.parse(payload);
          await placeWindowByConfig(rule);
          break;
        }
        case 'placeAll':
          await placeWindows();
          break;
        case 'store':
          await storeWindows();
          break;
        case 'restore':
          await restoreWindows();
          break;
        case 'desktop': {
          const { number } = JSON.parse(payload);
          virtualDesktop.GoToDesktopNumber(number - 1);
          break;
        }
        default:
          console.log(`WS unknown command: ${command}`);
      }
    } catch (err) {
      console.error(`WS error handling message:`, err.message);
    }
  });

  ws.on('close', () => {
    console.log('WS disconnected, reconnecting in 3s...');
    setTimeout(connect, 3000);
  });

  ws.on('error', (err) => {
    console.error('WS error:', err.message);
  });
}

connect();
