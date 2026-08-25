import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Умолчание порта проверяется не само по себе (`?? 9722`), а согласием двух
 * концов: тем, что объявляет файл трекера (`src/claude-wt/index.js`), и тем,
 * на чём слушает служба (`src/mqtt/service.js`) — в том числе когда ключа
 * `httpPort` в конфиге нет вовсе. Разошлись бы они однажды — и пикер тихо
 * откатился бы на MQTT, не увидев ни строки в логе.
 *
 * `startHttpServer` подменён: тесту нужен порт, который выбрала служба, а не
 * настоящий сокет — иначе тест то занял бы боевой порт 9722 на машине
 * разработчика, то столкнулся бы с уже запущенной службой.
 */
const startHttpServer = vi.hoisted(() => vi.fn(({ port }) => ({
  address: () => ({ port: typeof port === 'number' ? port : 0 }),
  close: () => {},
})));
vi.mock('../http-server.js', () => ({ startHttpServer }));

const { startService } = await import('../mqtt/service.js');

function fakeWinMan() {
  return { getWindows: () => [], getConfig: () => ({}) };
}

describe('согласие умолчания httpPort между службой и файлом трекера', () => {
  it('без ключа httpPort в конфиге оба конца сходятся на одном порту', async () => {
    // Конец 1: служба. Конфиг без ключа httpPort вовсе — как в живом
    // конфиге, куда человек его не дописал.
    const service = startService({ winMan: fakeWinMan(), config: {}, log: vi.fn(), env: {} });
    const servicePort = startHttpServer.mock.calls.at(-1)[0].port;
    service.stop();

    // Конец 2: файл трекера. Тот же сценарий — getConfig() без ключа
    // httpPort — готовит index.js::publishWindows.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'http-port-agreement-'));
    const windowsFile = path.join(dir, 'windows.json');
    vi.resetModules();
    vi.doMock('../config.js', () => ({
      getConfig: () => ({
        claudeWt: {
          enabled: true,
          statePath: path.join(dir, 'state.json'),
          windowsFile,
          interval: 3_600_000,
        },
        // httpPort намеренно отсутствует — это и есть найденный на ревью случай.
      }),
    }));
    const { publishWindows, getClaudeWtConfig } = await import('./index.js');
    publishWindows(getClaudeWtConfig(), [], {});
    const written = JSON.parse(fs.readFileSync(windowsFile, 'utf8'));
    fs.rmSync(dir, { recursive: true, force: true });
    vi.doUnmock('../config.js');
    vi.resetModules();

    expect(written.http?.port).toBe(servicePort);
    expect(servicePort).toBe(9722);
  });
});
