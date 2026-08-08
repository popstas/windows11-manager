import { describe, it, expect } from 'vitest';
import { commandFromTopic, readMqttSettings } from './client.js';

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

describe('readMqttSettings', () => {
  it('собирает настройки из окружения', () => {
    expect(readMqttSettings({
      W11M_MQTT_HOST: 'mqtt.lan', W11M_MQTT_PORT: '1883',
      W11M_MQTT_USER: 'u', W11M_MQTT_PASS: 'p', W11M_MQTT_BASE: BASE,
    })).toEqual({ host: 'mqtt.lan', port: 1883, username: 'u', password: 'p', base: BASE });
  });

  it('порт по умолчанию 1883', () => {
    expect(readMqttSettings({ W11M_MQTT_HOST: 'mqtt.lan', W11M_MQTT_BASE: BASE }).port).toBe(1883);
  });

  it('без хоста или базы — null', () => {
    expect(readMqttSettings({ W11M_MQTT_BASE: BASE })).toBe(null);
    expect(readMqttSettings({ W11M_MQTT_HOST: 'mqtt.lan' })).toBe(null);
  });
});
