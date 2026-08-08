/**
 * Долгоживущая служба: клиент, карта команд, экспорт в Home Assistant.
 *
 * Процесс отдельный от демона claude-wt намеренно: http-сервер, поднятый
 * внутри демона, вешал событийный цикл через две-три минуты (см. src/lib/index.js).
 */
import { createRouter } from '../commands/router.js';
import { buildCommandMap } from '../commands/build.js';
import { createHaExport } from '../claude-wt/ha/export.js';
import { topics } from '../claude-wt/ha/discovery.js';
import { connectMqtt, readMqttSettings } from './client.js';
import { createStatsPublisher } from './stats.js';
import { startAutoplacer } from './autoplacer.js';
import { startDaemonWatchdog } from './daemon-watchdog.js';

/**
 * Команды чужого модуля power из windows-mqtt.
 *
 * Подписка идёт на `<base>/#`, а база у power та же самая, что у окон (см.
 * windows-mqtt/src/helpers.js: opts.base для power наследуется от windows).
 * Обработчиков этим командам здесь взяться неоткуда и не должно: усыпляет и
 * перезагружает машину windows-mqtt. Список явный, а не молчаливый фильтр по
 * маске, — предупреждение «unknown command» на каждое засыпание забивало бы
 * лог, ради читаемости которого и заведено логирование входящих.
 */
const FOREIGN_COMMANDS = new Set(['sleep', 'restart', 'restart_restore', 'shutdown']);

function startMqttService({ winMan, config, log, env = process.env }) {
  const settings = readMqttSettings(env);
  if (!settings) {
    log('MQTT: W11M_MQTT_HOST или W11M_MQTT_BASE не заданы — служба не поднята', 'warn');
    return { stop() {} };
  }

  // Единственный объект конфига на всю службу: команда reload перезаписывает
  // его содержимое на месте, поэтому подменять ссылку никому нельзя.
  const withBase = { ...config, base: settings.base };
  let client = null;
  const publish = (topic, payload, opts) => client?.publish(topic, String(payload), opts ?? {});
  const notify = (message) => publish(settings.notifyTopic, message);
  const publishDone = (command) => publish(`${settings.base}/${command}/done`, '1');

  const haExport = createHaExport({ winMan, publish, log, config: withBase });
  const stats = createStatsPublisher({ winMan, publish, log, config: withBase });
  const router = createRouter(buildCommandMap({
    winMan, config: withBase, log, notify, haExport, publishDone,
  }));

  // Брокер этим двоим не нужен, и ждать подключения они не должны: расстановка
  // окон при открытии работает и с лежащим брокером, а сторож демона тем более —
  // он про поломку, которая случается сама по себе.
  const autoplacer = startAutoplacer({ winMan, config: withBase, log });
  const daemonWatchdog = startDaemonWatchdog({ winMan, log, notify });

  client = connectMqtt({
    settings,
    log,
    // Завещание брокеру: единственный способ снять доступность при падении,
    // kill и перезагрузке — stop() в этих случаях не зовут вовсе, а `online` и
    // все состояния слотов публикуются retained.
    will: {
      topic: topics(settings.base).availability,
      payload: 'offline',
      retain: true,
      qos: 0,
    },
    onCommand: async (command, payload, topic) => {
      // Раньше входящее не логировал никто: Rust-клиент, писавший каждое
      // сообщение в файл трея, удалён, а обработчики windows-mqtt со своим
      // `< topic: message` остались в том проекте. Нажатие на панели, которое
      // ничего не сделало, не оставляло следа нигде.
      log(`< ${topic ?? command}: ${payload}`);
      if (FOREIGN_COMMANDS.has(command)) return;
      const res = await router.dispatch(command, payload);
      if (!res.ok) log(`MQTT ${command}: ${res.error}`, 'warn');
    },
  });

  // Статистика заводится по подключению, а не при старте процесса: первый её
  // замер уходил бы в клиент без соединения. start() у обоих идемпотентен —
  // подключений за жизнь службы много, а таймер должен остаться один.
  client.on('connect', () => {
    haExport.start();
    stats.start();
  });

  return {
    stop() {
      haExport.stop();
      stats.stop();
      autoplacer.stop();
      daemonWatchdog.stop();
      client?.end(true);
    },
  };
}

export { startMqttService, FOREIGN_COMMANDS };
