import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import {
  commandFromTopic, readMqttSettings, notifyTopicFor, connectMqtt, parseMqttHost,
} from './client.js';

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
      host: 'mqtt.lan', port: 1883, tls: false, username: 'u', password: 'p', base: BASE,
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

  // Порт и схема — по правилу, общему с пикером и windows-mqtt: порт в адресе >
  // W11M_MQTT_PORT > умолчание схемы.
  const at = (host, port) => readMqttSettings({
    W11M_MQTT_HOST: host, W11M_MQTT_BASE: BASE,
    ...(port === undefined ? {} : { W11M_MQTT_PORT: port }),
  });
  const addr = (s) => s && { host: s.host, port: s.port, tls: s.tls };

  it('голое имя — открытый mqtt, как было до TLS', () => {
    expect(addr(at('broker.example'))).toEqual({ host: 'broker.example', port: 1883, tls: false });
  });

  it('mqtt:// с портом и без', () => {
    expect(addr(at('mqtt://broker.example'))).toEqual({ host: 'broker.example', port: 1883, tls: false });
    expect(addr(at('mqtt://broker.example:1884'))).toEqual({ host: 'broker.example', port: 1884, tls: false });
  });

  it('mqtts:// включает TLS со своим умолчанием 8883', () => {
    expect(addr(at('mqtts://broker.example'))).toEqual({ host: 'broker.example', port: 8883, tls: true });
  });

  it('порт в адресе бьёт W11M_MQTT_PORT', () => {
    // Трей шлёт W11M_MQTT_PORT всегда, и в нём стоит 1883 — TLS-порту не годится.
    expect(addr(at('mqtts://broker.example:8883', '1883'))).toEqual({ host: 'broker.example', port: 8883, tls: true });
  });

  it('W11M_MQTT_PORT бьёт умолчание схемы', () => {
    expect(at('mqtts://broker.example', '18883').port).toBe(18883);
    expect(at('broker.example', '1884').port).toBe(1884);
  });

  it('пустой W11M_MQTT_PORT — не задан', () => {
    expect(at('mqtts://broker.example', '').port).toBe(8883);
  });

  it('регистр схемы и косая черта в конце не важны', () => {
    expect(addr(at(' MQTTS://broker.example:8883/ '))).toEqual({ host: 'broker.example', port: 8883, tls: true });
  });

  it('непонятый адрес — брокер не настроен, с причиной в логе', () => {
    for (const bad of [
      'ws://broker.example',
      'mqtts://u:p@broker.example',
      'mqtts://broker.example/path',
      'mqtts://broker.example?x=1',
      'mqtts://broker.example:99999',
      'mqtts://broker.example:0',
      'mqtts://broker.example:port',
      'mqtts://',
      'broker example',
    ]) {
      const log = vi.fn();
      expect(readMqttSettings({ W11M_MQTT_HOST: bad, W11M_MQTT_BASE: BASE }, log), bad).toBe(null);
      expect(log, bad).toHaveBeenCalledWith(expect.stringContaining('W11M_MQTT_HOST'), 'error');
    }
  });

  it('пароль из адреса в лог не попадает', () => {
    const log = vi.fn();
    readMqttSettings({ W11M_MQTT_HOST: 'mqtts://u:secret@broker.example', W11M_MQTT_BASE: BASE }, log);
    expect(log.mock.calls.flat().join(' ')).not.toContain('secret');
    expect(log.mock.calls.flat().join(' ')).toContain('mqtts://***@broker.example');
  });

  describe('W11M_MQTT_CA', () => {
    function pemFile(text = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n') {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w11m-ca-'));
      const file = path.join(dir, 'ca.pem');
      fs.writeFileSync(file, text);
      return file;
    }

    it('для mqtts читается в буфер', () => {
      const file = pemFile('PEM');
      const s = readMqttSettings({ W11M_MQTT_HOST: 'mqtts://broker.example', W11M_MQTT_BASE: BASE, W11M_MQTT_CA: ` ${file} ` });
      expect(Buffer.isBuffer(s.ca)).toBe(true);
      expect(s.ca.toString()).toBe('PEM');
    });

    it('не задан — ca нет вовсе', () => {
      const s = readMqttSettings({ W11M_MQTT_HOST: 'mqtts://broker.example', W11M_MQTT_BASE: BASE, W11M_MQTT_CA: '  ' });
      expect(s).not.toBe(null);
      expect(s.ca).toBe(undefined);
    });

    it('для открытого mqtt не читается и не мешает', () => {
      const s = readMqttSettings({ W11M_MQTT_HOST: 'broker.example', W11M_MQTT_BASE: BASE, W11M_MQTT_CA: '/nonexistent/ca.pem' });
      expect(s).not.toBe(null);
      expect(s.ca).toBe(undefined);
    });

    it('нечитаемый файл — брокер не настроен, а не корни по умолчанию', () => {
      const log = vi.fn();
      const s = readMqttSettings({ W11M_MQTT_HOST: 'mqtts://broker.example', W11M_MQTT_BASE: BASE, W11M_MQTT_CA: '/nonexistent/ca.pem' }, log);
      expect(s).toBe(null);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('/nonexistent/ca.pem'), 'error');
    });
  });
});

describe('parseMqttHost', () => {
  it('голое имя с портом понимает тоже — как пикер', () => {
    expect(parseMqttHost('broker.example:1884')).toEqual({ host: 'broker.example', port: 1884, tls: false });
  });

  it('порт без адреса не выдумывает', () => {
    expect(parseMqttHost('mqtts://broker.example')).toEqual({ host: 'broker.example', port: undefined, tls: true });
  });

  it('пустая строка — null', () => {
    expect(parseMqttHost('   ')).toBe(null);
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

  function connectWith(env) {
    connect.mockReturnValue(fakeClient());
    const log = vi.fn();
    connectMqtt({
      settings: readMqttSettings({ W11M_MQTT_BASE: BASE, ...env }),
      onCommand: () => {},
      log,
    });
    const [url, options] = connect.mock.calls.at(-1);
    return { url, options, log };
  }

  it('голое имя — mqtt:// с портом 1883', () => {
    expect(connectWith({ W11M_MQTT_HOST: 'broker.example' }).url).toBe('mqtt://broker.example:1883');
  });

  it('адрес со схемой не удваивает её', () => {
    // Раньше схема приклеивалась к хосту как есть: `mqtt://mqtt://...:1883`.
    expect(connectWith({ W11M_MQTT_HOST: 'mqtt://broker.example' }).url).toBe('mqtt://broker.example:1883');
  });

  it('mqtts — TLS-адрес с портом 8883, без ca, если он не задан', () => {
    const { url, options } = connectWith({ W11M_MQTT_HOST: 'mqtts://broker.example' });
    expect(url).toBe('mqtts://broker.example:8883');
    // Без ca Node берёт свой набор корней Mozilla — в нём есть ISRG Root X1.
    expect('ca' in options).toBe(false);
  });

  it('ca из файла доезжает до mqtt.connect массивом из одного буфера', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w11m-ca-'));
    const file = path.join(dir, 'ca.pem');
    fs.writeFileSync(file, 'PEM');
    const { options } = connectWith({ W11M_MQTT_HOST: 'mqtts://broker.example', W11M_MQTT_CA: file });
    expect(options.ca).toHaveLength(1);
    expect(options.ca[0].toString()).toBe('PEM');
  });

  it('строка подключения в логе — схема, хост и порт, без пароля', () => {
    const client = fakeClient();
    connect.mockReturnValue(client);
    const log = vi.fn();
    connectMqtt({
      settings: readMqttSettings({
        W11M_MQTT_HOST: 'mqtts://broker.example', W11M_MQTT_BASE: BASE,
        W11M_MQTT_USER: 'u', W11M_MQTT_PASS: 'secret',
      }),
      onCommand: () => {},
      log,
    });
    const onConnect = client.on.mock.calls.find(([event]) => event === 'connect')[1];
    onConnect();
    expect(log).toHaveBeenCalledWith('MQTT connected to mqtts://broker.example:8883');
    expect(log.mock.calls.flat().join(' ')).not.toContain('secret');
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
