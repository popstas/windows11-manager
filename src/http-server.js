import http from 'node:http';
import { placeWindowByConfig, placeWindows } from './placement.js';
import { storeWindows, restoreWindows } from './store.js';
import { virtualDesktop } from './virtual-desktop.js';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function startHttpServer(port = 9722) {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    try {
      const body = await readBody(req);
      const url = req.url.replace(/\/$/, '');
      console.log(`HTTP ${req.method} ${url}: ${JSON.stringify(body)}`);

      switch (url) {
        case '/place':
          await placeWindowByConfig(body);
          break;
        case '/placeAll':
          await placeWindows();
          break;
        case '/store':
          await storeWindows();
          break;
        case '/restore':
          await restoreWindows();
          break;
        case '/desktop':
          virtualDesktop.GoToDesktopNumber(body.number - 1);
          break;
        default:
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
          return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      console.error('HTTP error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  server.listen(port, () => {
    console.log(`HTTP server listening on port ${port}`);
  });

  return server;
}

export { startHttpServer };
