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

/**
 * Топик уведомлений — тот, который слушает модуль notify в windows-mqtt.
 *
 * Он строит подписку как `${mqtt.base}/notify` + `/notify`, то есть от общей
 * базы брокера (`home/room/pc`), а не от нашей (`home/room/pc/windows`).
 * Публикация в `${base}/notify/notify` уходила в никуда: подписчика там нет, а
 * собственное эхо commandFromTopic отбрасывает из-за косой черты — молчали обе
 * стороны. Так же это делал и код, который мы заменили:
 * windows-mqtt/src/modules/windows.js публиковал в `globalConfig.mqtt.base`.
 *
 * W11M_MQTT_NOTIFY_TOPIC перебивает вывод целиком: если базы разъедутся, топик
 * должно быть можно задать прямо, не подгоняя под него W11M_MQTT_BASE.
 */
function notifyTopicFor(base, env = process.env) {
  const explicit = (env.W11M_MQTT_NOTIFY_TOPIC ?? '').trim().replace(/\/$/, '');
  if (explicit) return explicit;
  const cut = base.lastIndexOf('/');
  // База без косой черты — она же и корень: отрезать нечего.
  const root = cut > 0 ? base.slice(0, cut) : base;
  return `${root}/notify/notify`;
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
    notifyTopic: notifyTopicFor(base, env),
  };
}

/**
 * Подключиться и звать `onCommand(command, payload, topic)` на каждое сообщение.
 *
 * Переподключение оставлено библиотеке: `reconnectPeriod` у mqtt.js встроен, а
 * своя петля поверх него давала бы два таймера на одно соединение.
 *
 * `will` — завещание брокеру. Через него снимается доступность в Home
 * Assistant: stop() зовут только при чистой остановке, а падение процесса и
 * reboot оставляли бы retained-`online` висеть вечно.
 */
function connectMqtt({ settings, onCommand, log, will }) {
  const url = `mqtt://${settings.host}:${settings.port}`;
  const client = mqtt.connect(url, {
    clientId: `w11mgr-${process.pid}`,
    username: settings.username || undefined,
    password: settings.username ? settings.password : undefined,
    keepalive: 30,
    reconnectPeriod: 5000,
    will,
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
    onCommand(command, payload.toString(), topic);
  });

  return client;
}

export { commandFromTopic, readMqttSettings, notifyTopicFor, connectMqtt, SLOT_COMMAND };
