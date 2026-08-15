/**
 * HTTP-транспорт поверх той же карты команд, что и MQTT.
 *
 * Раньше здесь был свой switch, второй такой же жил в ws-client.js, и при пяти
 * командах они уже разъезжались. Теперь путь переводится в имя команды, а
 * дальше работает роутер.
 *
 * Сервер поднимается отдельной командой (`node src/index.js http-server`), а не
 * внутри процесса демона: там он вешал событийный цикл через две-три минуты.
 */
import http from 'node:http';
import * as winMan from './lib/index.js';
import { createRouter } from './commands/router.js';
import { buildCommandMap } from './commands/build.js';

const ROUTES = {
  '/place': 'place',
  '/placeAll': 'placeAll',
  '/store': 'store',
  '/restore': 'restore',
  '/clear': 'clear',
  '/open': 'open',
  '/focus': 'focus',
  '/desktop': 'desktop',
  '/reload': 'reload',
  '/autoplace': 'autoplace',
  '/claude-wt/restore': 'claude-wt-restore',
  '/claude-wt/focus': 'claude-focus',
  '/claude-wt/session-open': 'claude-session-open',
  '/claude-wt/session-unread': 'claude-session-unread',
  '/claude-wt/snapshot-restore': 'claude-snapshot-restore',
};

function routeToCommand(url) {
  const clean = String(url ?? '').replace(/\/+$/, '') || '/';
  return ROUTES[clean] ?? null;
}

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
  const log = (message, level = 'info') => {
    if (level === 'error') console.error(`[http] ${message}`);
    else console.log(`[http] ${message}`);
  };
  const config = winMan.getConfig();
  // Экспорт в HA живёт в mqtt-процессе; здесь нужна только его форма, чтобы
  // команды claude-wt получили slots()/slotOff()/refresh() и не проверяли их
  // на существование в каждом вызове.
  const haExport = { slots: () => [], slotOff: () => {}, refresh: () => {} };
  const router = createRouter(buildCommandMap({
    winMan, config, log, notify: (m) => log(m), haExport,
  }));

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    const command = routeToCommand(req.url);
    if (!command) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      // Ответ 400 видит только тот, кто послал запрос; на машине, где сервер
      // работает, о битом теле не оставалось никакого следа.
      log(`POST ${req.url}: тело не разобрано — ${err.message}`, 'error');
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
    log(`POST ${req.url}: ${JSON.stringify(body)}`);
    const result = await router.dispatch(command, body);
    if (!result.ok) {
      log(`POST ${req.url}: ${result.error}`, 'error');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: result.error }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...(result.result ?? {}) }));
  });

  server.listen(port, () => log(`HTTP server listening on port ${port}`));
  return server;
}

export { startHttpServer, routeToCommand, ROUTES };
