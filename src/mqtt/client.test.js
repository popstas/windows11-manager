import { describe, it, expect, vi } from 'vitest';
import { commandFromTopic, readMqttSettings, notifyTopicFor, connectMqtt } from './client.js';

const connect = vi.hoisted(() => vi.fn());
vi.mock('mqtt', () => ({ default: { connect } }));

const BASE = 'home/room/pc/windows';

describe('commandFromTopic', () => {
  it('снимает префикс', () => {
    expect(commandFromTopic(`${BASE}/store`, BASE)).toBe('store');
    expect(commandFromTopic(`${BASE}/claude-focus`, BASE)).toBe('claude-focus');
  });

  it('узнаёт командный топик переключателя слота', () => {
    expect(commandFromTopic(`${BASE}/claude/slot/3/set`, BASE)).toBe('claude-slot-command:3');
  });

  it('не путает состояние слота с командой', () => {
    expect(commandFromTopic(`${BASE}/claude/slot/3`, BASE)).toBe(null);
  });

  it('отбрасывает чужой префикс', () => {
    expect(commandFromTopic('home/room/pc/audio/next', BASE)).toBe(null);
    expect(commandFromTopic(BASE, BASE)).toBe(null);
  });
});

describe('notifyTopicFor', () => {
  it('срезает последний сегмент базы: подписчик слушает от общей базы брокера', () => {
    // windows-mqtt/src/modules/notify.js подписан на `${config.base}/notify`,
    // где base = `${mqtt.base}/notify` — то есть home/room/pc/notify/notify.
    // Наша база на сегмент длиннее, и публикация в неё уходила в никуда.
    expect(notifyTopicFor(BASE, {})).toBe('home/room/pc/notify/notify');
  });

  it('база без косой черты — она же и корень', () => {
    expect(notifyTopicFor('windows', {})).toBe('windows/notify/notify');
  });

  it('W11M_MQTT_NOTIFY_TOPIC перебивает вывод', () => {
    expect(notifyTopicFor(BASE, { W11M_MQTT_NOTIFY_TOPIC: 'other/notify/notify' }))
      .toBe('other/notify/notify');
    expect(notifyTopicFor(BASE, { W11M_MQTT_NOTIFY_TOPIC: '  other/notify/  ' }))
      .toBe('other/notify');
  });

  it('пустая переменная не считается заданной', () => {
    expect(notifyTopicFor(BASE, { W11M_MQTT_NOTIFY_TOPIC: '   ' }))
      .toBe('home/room/pc/notify/notify');
  });
});

describe('readMqttSettings', () => {
  it('собирает настройки из окружения', () => {
    expect(readMqttSettings({
      W11M_MQTT_HOST: 'mqtt.lan', W11M_MQTT_PORT: '1883',
      W11M_MQTT_USER: 'u', W11M_MQTT_PASS: 'p', W11M_MQTT_BASE: BASE,
    })).toEqual({
      host: 'mqtt.lan', port: 1883, username: 'u', password: 'p', base: BASE,
      notifyTopic: 'home/room/pc/notify/notify',
    });
  });

  it('порт по умолчанию 1883', () => {
    expect(readMqttSettings({ W11M_MQTT_HOST: 'mqtt.lan', W11M_MQTT_BASE: BASE }).port).toBe(1883);
  });

  it('без хоста или базы — null', () => {
    expect(readMqttSettings({ W11M_MQTT_BASE: BASE })).toBe(null);
    expect(readMqttSettings({ W11M_MQTT_HOST: 'mqtt.lan' })).toBe(null);
  });
});

describe('connectMqtt', () => {
  function fakeClient() {
    return { on: vi.fn(), subscribe: vi.fn(), publish: vi.fn(), end: vi.fn() };
  }

  it('завещание доезжает до mqtt.connect как есть', () => {
    // Без него availability застревал в retained-online: stop() при падении и
    // при kill не зовут вовсе.
    connect.mockReturnValue(fakeClient());
    const will = { topic: `${BASE}/claude/availability`, payload: 'offline', retain: true, qos: 0 };
    connectMqtt({
      settings: readMqttSettings({ W11M_MQTT_HOST: 'mqtt.lan', W11M_MQTT_BASE: BASE }),
      onCommand: () => {},
      log: () => {},
      will,
    });
    expect(connect.mock.calls.at(-1)[1].will).toEqual(will);
  });

  it('в onCommand приходит и топик — ради строки лога `< topic: payload`', () => {
    const client = fakeClient();
    connect.mockReturnValue(client);
    const seen = [];
    connectMqtt({
      settings: readMqttSettings({ W11M_MQTT_HOST: 'mqtt.lan', W11M_MQTT_BASE: BASE }),
      onCommand: (...args) => seen.push(args),
      log: () => {},
    });
    const onMessage = client.on.mock.calls.find(([event]) => event === 'message')[1];
    onMessage(`${BASE}/claude/slot/3/set`, Buffer.from('ON'));
    expect(seen).toEqual([['claude-slot-command:3', 'ON', `${BASE}/claude/slot/3/set`]]);
  });
});
