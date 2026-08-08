import { describe, it, expect, vi, beforeEach } from 'vitest';

// Клиент подменяем целиком: настоящий connectMqtt лезет в брокер, а проверять
// надо ровно то, что решает служба, — топики, завещание и разбор входящих.
const connectMqtt = vi.hoisted(() => vi.fn());
vi.mock('./client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, connectMqtt };
});

const { startMqttService } = await import('./service.js');

const ENV = { W11M_MQTT_HOST: 'mqtt.lan', W11M_MQTT_BASE: 'home/room/pc/windows' };

function setup({ env = ENV, config = {}, ...overrides } = {}) {
  const published = [];
  const logged = [];
  const handlers = {};
  const client = {
    publish: (topic, payload, opts) => published.push({ topic, payload, opts }),
    on: (event, fn) => { handlers[event] = fn; },
    end: vi.fn(),
  };
  let args = null;
  connectMqtt.mockImplementation((a) => { args = a; return client; });

  const winMan = {
    // Экспорт в HA гасим: он ходит в окна, а здесь проверяется не он.
    claudeWtSessions: () => ({ ok: true, sessions: [] }),
    storeWindows: vi.fn(),
    reloadConfigs: vi.fn(() => ({})),
    // Сторожа демона по умолчанию не заводим: у него свой файл с тестами.
    getClaudeWtConfig: () => ({ enabled: false }),
    getStats: vi.fn(() => ({ total: 0, byApp: {} })),
    placeWindowOnOpen: vi.fn().mockResolvedValue(undefined),
    stopPlaceNewWindows: vi.fn(),
    ...overrides.winMan,
  };
  const service = startMqttService({
    winMan,
    config: { homeassistant: { enabled: false }, ...config },
    log: (message, level = 'info') => logged.push(`${level}: ${message}`),
    env,
  });
  return { service, published, logged, handlers, client, winMan, args: () => args };
}

beforeEach(() => connectMqtt.mockReset());

describe('startMqttService', () => {
  it('без хоста или базы служба не поднимается', () => {
    const { logged } = setup({ env: {} });
    expect(connectMqtt).not.toHaveBeenCalled();
    expect(logged[0]).toMatch(/не заданы/);
  });

  it('уведомления уходят на общую базу брокера, а не на нашу', async () => {
    // Подписчик — windows-mqtt/src/modules/notify.js — слушает
    // home/room/pc/notify/notify. Публикация в home/room/pc/windows/notify/notify
    // не доходила ни до кого, и собственное эхо служба тоже отбрасывала:
    // commandFromTopic глушит всё с косой чертой.
    const { published, args } = setup();
    await args().onCommand('claude-focus', '{"id":"нет-такой"}', 'home/room/pc/windows/claude-focus');
    expect(published.map((p) => p.topic)).toContain('home/room/pc/notify/notify');
  });

  it('W11M_MQTT_NOTIFY_TOPIC перебивает топик уведомлений', async () => {
    const { published, args } = setup({ env: { ...ENV, W11M_MQTT_NOTIFY_TOPIC: 'ha/notify' } });
    await args().onCommand('claude-focus', '{"id":"нет-такой"}');
    expect(published.map((p) => p.topic)).toContain('ha/notify');
  });

  it('подтверждение сохранения раскладки идёт в <base>/<command>/done', async () => {
    const { published, args } = setup();
    await args().onCommand('store', '');
    expect(published).toContainEqual(
      expect.objectContaining({ topic: 'home/room/pc/windows/store/done', payload: '1' }));
  });

  it('завещание снимает доступность в Home Assistant', () => {
    const { args } = setup();
    expect(args().will).toEqual({
      topic: 'home/room/pc/windows/claude/availability',
      payload: 'offline',
      retain: true,
      qos: 0,
    });
  });

  it('входящее пишется в лог до разбора', async () => {
    const { logged, args } = setup();
    await args().onCommand('store', '{"a":1}', 'home/room/pc/windows/store');
    expect(logged).toContain('info: < home/room/pc/windows/store: {"a":1}');
  });

  it('провалившийся вызов виден в логе', async () => {
    const { logged, args } = setup();
    await args().onCommand('не-команда', '', 'home/room/pc/windows/не-команда');
    expect(logged).toContain('warn: MQTT не-команда: unknown command: не-команда');
  });

  it('чужие команды модуля power логируются, но не ругаются', async () => {
    // Топики sleep/restart/shutdown лежат под нашей же базой, обработчиков им
    // здесь взяться неоткуда, и warn на каждое засыпание забивал бы лог.
    const { logged, args } = setup();
    for (const command of ['sleep', 'restart', 'restart_restore', 'shutdown']) {
      await args().onCommand(command, '', `home/room/pc/windows/${command}`);
    }
    expect(logged.filter((l) => l.startsWith('warn:'))).toEqual([]);
    expect(logged).toContain('info: < home/room/pc/windows/sleep: ');
  });

  it('статистика окон уходит по подключению и в свой топик', () => {
    // publishStatsTopic на этой машине — state/pc/windows, и под базой окон он
    // не лежит: выводить его из базы нельзя.
    const { published, handlers, service } = setup({
      config: { publishStats: true, publishStatsTopic: 'state/pc/windows' },
    });
    handlers.connect();
    expect(published).toContainEqual(
      expect.objectContaining({ topic: 'state/pc/windows/total', payload: '0' }));
    service.stop();
  });

  it('без publishStats статистика не публикуется', () => {
    const { published, handlers, service } = setup();
    handlers.connect();
    expect(published.filter((p) => p.topic.includes('/total'))).toEqual([]);
    service.stop();
  });

  it('placeWindowOnOpen включает расстановку новых окон', async () => {
    const { winMan, service } = setup({ config: { placeWindowOnOpen: true } });
    await vi.waitFor(() => expect(winMan.placeWindowOnOpen).toHaveBeenCalled());
    service.stop();
    expect(winMan.stopPlaceNewWindows).toHaveBeenCalled();
  });

  it('сторож демона заведён службой и жалуется, когда смотреть не на что', () => {
    // claudeWt.windowsFile — единственный сигнал о живости демона из чужого
    // процесса; без него сторожу не по чему судить, и молчать об этом нельзя.
    const { logged, service } = setup({
      winMan: {
        getClaudeWtConfig: () => ({ enabled: true, windowsFile: '' }),
        claudeWtHealth: () => ({ healthy: true }),
      },
    });
    expect(logged.some((l) => l.startsWith('error:') && l.includes('windowsFile'))).toBe(true);
    service.stop();
  });

  it('stop() снимает доступность и закрывает соединение', () => {
    const { service, published, client, handlers } = setup({
      config: { homeassistant: { enabled: true, interval: 3600 } },
    });
    handlers.connect();
    service.stop();
    expect(published).toContainEqual(expect.objectContaining({
      topic: 'home/room/pc/windows/claude/availability', payload: 'offline',
    }));
    expect(client.end).toHaveBeenCalled();
  });
});
