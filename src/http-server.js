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
import { DROPPED } from './commands/press-throttle.js';

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

/**
 * Пути доски StreamDock. Отдельно от `ROUTES` и не через `routeToCommand`:
 * там точное совпадение пути с командой, а здесь в пути стоит номер слота, и
 * картинка вообще не команда — у неё тело ответа, а не результат роутера.
 */
const SLOT_IMAGE = /^\/claude-wt\/slot\/(\d+)\.svg$/;
const SLOT_PRESS = /^\/claude-wt\/slot\/(\d+)\/press$/;

function slotNumber(url, re) {
  const clean = String(url ?? '').split('?')[0].replace(/\/+$/, '') || '/';
  const match = re.exec(clean);
  return match ? Number(match[1]) : null;
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

function replyResult(res, log, url, result) {
  if (!result.ok) {
    log(`POST ${url}: ${result.error}`, 'error');
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  // Дребезг платы: `claude-place`/`claude-snapshot-restore`/`claude-dock-press`,
  // отброшенные press-throttle.js, доходят сюда как `ok: true, result: DROPPED`
  // — по MQTT это была просто тишина, а `200 {"ok":true}` был бы подтверждённым
  // успехом несделанного.
  if (result.result === DROPPED) {
    log(`POST ${url}: отброшено ограничителем частоты`, 'warn');
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'throttled' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, ...(result.result ?? {}) }));
}

function startHttpServer({ router, port = 9722, log, dock = null }) {
  const inDockRange = (n) => Boolean(dock) && Number.isInteger(n) && n >= 1 && n <= dock.count;
  const server = http.createServer(async (req, res) => {
    const notFound = () => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    };

    // Картинка кнопки. Единственный GET на всём сервере: роутер команд по нему
    // не открывается — путь, не совпавший с SLOT_IMAGE, падает ниже на прежнюю
    // проверку метода и получает 405, как и раньше.
    if (req.method === 'GET') {
      const slot = slotNumber(req.url, SLOT_IMAGE);
      if (slot !== null) {
        const svg = inDockRange(slot) ? dock.svg(slot) : null;
        if (!svg) {
          notFound();
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          // Плагин перечитывает картинку своим таймером, и закэшированная
          // кнопка застыла бы на прошлом состоянии сессии.
          'Cache-Control': 'no-store',
        });
        res.end(svg);
        return;
      }
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    // Нажатие на кнопку доски. Номер берётся из пути, а тело не читается
    // вовсе: у кнопки плагина его может не быть, а пустой разбор ответил бы
    // 400 на исправное нажатие.
    const pressSlot = slotNumber(req.url, SLOT_PRESS);
    if (pressSlot !== null) {
      if (!inDockRange(pressSlot)) {
        notFound();
        return;
      }
      const result = await router.dispatch('claude-dock-press', { slot: pressSlot });
      replyResult(res, log, req.url, result);
      return;
    }

    const command = routeToCommand(req.url);
    if (!command) {
      notFound();
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
    replyResult(res, log, req.url, result);
  });

  // Без этого подписчика EADDRINUSE (осиротевший процесс прошлой версии,
  // чужая программа на 9722, второй экземпляр) — неперехваченное исключение:
  // src/index.js намеренно не ставит uncaughtException, и служба падает
  // целиком, роняя вместе с http-транспортом mqtt-клиент, HA-экспорт,
  // статистику, автопостановщик и сторож демона. Лог и жизнь дальше — пикер
  // получит отказ соединения (видимый человеку), а служба продолжит работать
  // по MQTT.
  server.on('error', (err) => log(`HTTP server: ${err.message}`, 'error'));
  server.listen(port, () => log(`HTTP server listening on port ${server.address().port}`));
  return server;
}

export { startHttpServer, routeToCommand, ROUTES, SLOT_IMAGE, SLOT_PRESS };
