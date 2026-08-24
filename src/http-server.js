/**
 * HTTP-транспорт поверх той же карты команд, что и MQTT.
 *
 * Роутер приходит снаружи, а не строится здесь: раньше слушатель поднимался
 * отдельным процессом и потому строил свой, с заглушкой слотов. Теперь он
 * живёт внутри служебного процесса и обязан разбирать команды тем же роутером,
 * что и MQTT, — иначе `claude-focus-slot` с панели молча не находил бы сессию.
 *
 * `port: 0` — «любой свободный»: так тесты поднимают слушатель, не занимая
 * настоящий порт. Настоящий порт всегда спрашивать у `address()`, а не у
 * аргумента.
 */
import http from 'node:http';

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
  '/claude-wt/place': 'claude-place',
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

function startHttpServer({ router, port = 9722, log }) {
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

  server.listen(port, () => log(`HTTP server listening on port ${server.address().port}`));
  return server;
}

export { startHttpServer, routeToCommand, ROUTES };
