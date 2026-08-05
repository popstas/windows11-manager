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
        case '/claude-wt/restore': {
          // Imported lazily: claude-wt pulls in the whole tracker, and the HTTP
          // server is also started on machines that do not use it.
          const { restoreClaudeSessions } = await import('./claude-wt/restore.js');
          const result = await restoreClaudeSessions({ force: Boolean(body.force), sessionIds: body.sessionIds });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, ...result }));
          return;
        }
        case '/claude-wt/status': {
          const { claudeWtStatus } = await import('./claude-wt/index.js');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(claudeWtStatus()));
          return;
        }
        case '/claude-wt/focus': {
          const { focusSession } = await import('./claude-wt/focus.js');
          const result = await focusSession(body.id);
          // 200 и на отказе: отказ здесь — не поломка сервера, а «окна нет», и
          // разбирать его будет клиент по полю ok. Коды 4xx заставили бы его
          // читать ответ двумя разными способами.
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
          return;
        }
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
