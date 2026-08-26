import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { startHttpServer, routeToCommand } from './http-server.js';
import { DROPPED } from './commands/press-throttle.js';

describe('routeToCommand', () => {
  it('переводит путь в команду', () => {
    expect(routeToCommand('/place')).toBe('place');
    expect(routeToCommand('/placeAll')).toBe('placeAll');
    expect(routeToCommand('/store')).toBe('store');
    expect(routeToCommand('/desktop')).toBe('desktop');
  });

  it('терпит хвостовую косую черту', () => {
    expect(routeToCommand('/store/')).toBe('store');
  });

  it('знает вложенный путь claude-wt', () => {
    expect(routeToCommand('/claude-wt/restore')).toBe('claude-wt-restore');
    expect(routeToCommand('/claude-wt/session-open')).toBe('claude-session-open');
  });

  // Без этого маршрута пятая просьба пикера (раскладка) получала бы 404, и
  // человек видел бы «менеджер не отвечает» — неотличимо от лежащей службы.
  it('раскладка claude-wt ведёт в claude-place, а не в place окон', () => {
    expect(routeToCommand('/claude-wt/place')).toBe('claude-place');
  });

  it('чужой путь — null', () => {
    expect(routeToCommand('/nope')).toBe(null);
    expect(routeToCommand('/')).toBe(null);
  });
});

describe('startHttpServer', () => {
  // EADDRINUSE раньше уходил в неперехваченное исключение и ронял весь
  // служебный процесс — mqtt-клиент, HA-экспорт, статистику, автопостановщик
  // и сторож демона заодно с http-транспортом. Красит эту находку правка
  // src/http-server.js: подписка на 'error' у server.
  it('занятый порт не роняет процесс — пишет строку в лог и не бросает', async () => {
    const blocker = net.createServer();
    await new Promise((resolve) => blocker.listen(0, resolve));
    const port = blocker.address().port;

    const logged = [];
    let onError;
    const errored = new Promise((resolve) => { onError = resolve; });
    const log = (msg, level) => {
      logged.push({ msg, level });
      if (level === 'error') onError();
    };

    expect(() => startHttpServer({ router: { dispatch: async () => ({ ok: true }) }, port, log }))
      .not.toThrow();
    await errored;

    expect(logged.some((l) => l.level === 'error')).toBe(true);
    blocker.close();
  });

  // Дребезг платы (claude-place/claude-snapshot-restore, throttlePress) даёт
  // роутеру result: DROPPED. По MQTT это была просто тишина; по http `200
  // {"ok":true}` был бы подтверждённым успехом несделанного действия.
  it('отброшенное ограничителем нажатие отвечает 429, а не 200', async () => {
    const router = { dispatch: async () => ({ ok: true, result: DROPPED }) };
    const server = startHttpServer({ router, port: 0, log: () => {} });
    await new Promise((resolve) => server.once('listening', resolve));
    const port = server.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/claude-wt/place`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(429);

    server.close();
  });

  const fakeDock = { count: 5, svg: (n) => (n <= 5 ? `<svg data-slot="${n}"></svg>` : null) };

  async function listen(opts) {
    const server = startHttpServer({ port: 0, log: () => {}, ...opts });
    await new Promise((resolve) => server.once('listening', resolve));
    return { server, port: server.address().port };
  }

  it('картинка слота отдаётся по GET как SVG и не кэшируется', async () => {
    // Плагин перечитывает картинку своим таймером; закэшированная кнопка
    // застыла бы на состоянии получасовой давности.
    const { server, port } = await listen({ router: { dispatch: async () => ({ ok: true }) }, dock: fakeDock });

    const res = await fetch(`http://127.0.0.1:${port}/claude-wt/slot/3.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toContain('data-slot="3"');

    server.close();
  });

  it('номер вне диапазона — 404, а не пустая картинка', async () => {
    // Это опечатка в настройке кнопки, и она должна быть видна.
    const { server, port } = await listen({ router: { dispatch: async () => ({ ok: true }) }, dock: fakeDock });
    expect((await fetch(`http://127.0.0.1:${port}/claude-wt/slot/9.svg`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/claude-wt/slot/9/press`, { method: 'POST' })).status).toBe(404);
    server.close();
  });

  it('нажатие доезжает до команды с номером слота из пути', async () => {
    const seen = [];
    const router = { dispatch: async (command, body) => { seen.push([command, body]); return { ok: true, result: { id: 'x' } }; } };
    const { server, port } = await listen({ router, dock: fakeDock });

    const res = await fetch(`http://127.0.0.1:${port}/claude-wt/slot/2/press`, { method: 'POST' });

    expect(res.status).toBe(200);
    expect(seen).toEqual([['claude-dock-press', { slot: 2 }]]);
    server.close();
  });

  it('без доски обоих путей нет вовсе', async () => {
    const { server, port } = await listen({ router: { dispatch: async () => ({ ok: true }) } });
    expect((await fetch(`http://127.0.0.1:${port}/claude-wt/slot/1.svg`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/claude-wt/slot/1/press`, { method: 'POST' })).status).toBe(404);
    server.close();
  });

  it('командные пути по GET по-прежнему 405', async () => {
    // Ветка GET заведена ради картинок; открыть по ней роутер команд значило бы
    // отдать перезагрузку и раскладку окон любому, кто откроет ссылку.
    const { server, port } = await listen({ router: { dispatch: async () => ({ ok: true }) }, dock: fakeDock });
    expect((await fetch(`http://127.0.0.1:${port}/claude-wt/focus`)).status).toBe(405);
    server.close();
  });
});
