/**
 * MQTT-клиент менеджера.
 *
 * До переезда подписку держал Rust (tauri-app/src-tauri/src/mqtt.rs) и гнал
 * команды в node по WebSocket. Раз node всё равно заводит клиент ради
 * публикации в Home Assistant, второй перескок стал лишним.
 *
 * Настройки приходят окружением, а не аргументами: пароль в argv виден в
 * списке процессов.
 */
import mqtt from 'mqtt';

/** Топик командного переключателя слота: `<base>/claude/slot/<n>/set`. */
const SLOT_COMMAND = /^claude\/slot\/(\d+)\/set$/;

function commandFromTopic(topic, base) {
  const prefix = `${base}/`;
  if (!topic.startsWith(prefix)) return null;
  const rest = topic.slice(prefix.length);
  if (!rest) return null;
  const slot = rest.match(SLOT_COMMAND);
  if (slot) return `claude-slot-command:${slot[1]}`;
  // Всё остальное с косой чертой — наши же публикации (claude/slot/N,
  // claude/summary, stats/...): подписка идёт на `#`, и своё эхо надо
  // отбрасывать, иначе роутер будет ругаться на неизвестные команды.
  return rest.includes('/') ? null : rest;
}

function readMqttSettings(env = process.env) {
  const host = (env.W11M_MQTT_HOST ?? '').trim();
  const base = (env.W11M_MQTT_BASE ?? '').trim().replace(/\/$/, '');
  if (!host || !base) return null;
  return {
    host,
    port: Number(env.W11M_MQTT_PORT) || 1883,
    username: (env.W11M_MQTT_USER ?? '').trim(),
    password: env.W11M_MQTT_PASS ?? '',
    base,
  };
}

/**
 * Подключиться и звать `onCommand(command, payload)` на каждое сообщение.
 *
 * Переподключение оставлено библиотеке: `reconnectPeriod` у mqtt.js встроен, а
 * своя петля поверх него давала бы два таймера на одно соединение.
 */
function connectMqtt({ settings, onCommand, log }) {
  const url = `mqtt://${settings.host}:${settings.port}`;
  const client = mqtt.connect(url, {
    clientId: `w11mgr-${process.pid}`,
    username: settings.username || undefined,
    password: settings.username ? settings.password : undefined,
    keepalive: 30,
    reconnectPeriod: 5000,
  });

  client.on('connect', () => {
    log(`MQTT connected to ${url}`);
    client.subscribe(`${settings.base}/#`, { qos: 0 }, (err) => {
      if (err) log(`MQTT subscribe error: ${err.message}`, 'error');
      else log(`MQTT subscribed to ${settings.base}/#`);
    });
  });

  client.on('reconnect', () => log('MQTT reconnecting'));
  client.on('error', (err) => log(`MQTT error: ${err.message}`, 'error'));

  client.on('message', (topic, payload) => {
    const command = commandFromTopic(topic, settings.base);
    if (!command) return;
    onCommand(command, payload.toString());
  });

  return client;
}

export { commandFromTopic, readMqttSettings, connectMqtt, SLOT_COMMAND };
