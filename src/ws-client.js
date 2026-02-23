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
    const raw = data.toString();
    console.log(`WS raw message: ${raw}`);
    try {
      const parsed = JSON.parse(raw);
      const { command, payload } = parsed;
      console.log(`WS command=${command}, payload type=${typeof payload}`);

      switch (command) {
        case 'place': {
          const rule = typeof payload === 'string' ? JSON.parse(payload) : payload;
          console.log(`WS place rule: ${JSON.stringify(rule)}`);
          await placeWindowByConfig(rule);
          console.log(`WS place completed`);
          break;
        }
        case 'placeAll':
          await placeWindows();
          console.log(`WS placeAll completed`);
          break;
        case 'store':
          await storeWindows();
          console.log(`WS store completed`);
          break;
        case 'restore':
          await restoreWindows();
          console.log(`WS restore completed`);
          break;
        case 'desktop': {
          const desktopPayload = typeof payload === 'string' ? JSON.parse(payload) : payload;
          virtualDesktop.GoToDesktopNumber(desktopPayload.number - 1);
          console.log(`WS desktop switch to ${desktopPayload.number}`);
          break;
        }
        default:
          console.log(`WS unknown command: ${command}`);
      }
    } catch (err) {
      console.error(`WS error handling message: ${err.message}\n  raw: ${raw}\n  stack: ${err.stack}`);
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
