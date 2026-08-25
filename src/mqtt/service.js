/**
 * Долгоживущая служба: роутер команд, http-транспорт и — когда брокер настроен —
 * mqtt-клиент с экспортом в Home Assistant.
 *
 * Процесс отдельный от демона claude-wt намеренно: http-сервер, поднятый
 * внутри демона, вешал событийный цикл через две-три минуты (см. src/lib/index.js).
 *
 * Поднимается **всегда**, даже без брокера, и это и есть суть правки. Раньше
 * функция выходила первой строкой при пустом W11M_MQTT_HOST, и вместе с mqtt не
 * заводились ни автопостановщик, ни сторож демона — хотя брокер обоим не нужен,
 * о чём тут же и написано ниже.
 */
import { createRouter } from '../commands/router.js';
import { buildCommandMap } from '../commands/build.js';
import { createHaExport } from '../claude-wt/ha/export.js';
import { topics } from '../claude-wt/ha/discovery.js';
import { connectMqtt, readMqttSettings } from './client.js';
import { createStatsPublisher } from './stats.js';
import { startAutoplacer } from './autoplacer.js';
import { startDaemonWatchdog } from './daemon-watchdog.js';
import { startHttpServer } from '../http-server.js';

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

function startService({ winMan, config, log, env = process.env }) {
  const settings = readMqttSettings(env);
  // Единственный объект конфига на всю службу: команда reload перезаписывает
  // его содержимое на месте, поэтому подменять ссылку никому нельзя.
  const withBase = settings ? { ...config, base: settings.base } : { ...config };

  let client = null;
  const publish = (topic, payload, opts) => client?.publish(topic, String(payload), opts ?? {});

  // Без брокера публиковать некуда: HA-экспорт и статистика молчат, а notify
  // уходит в лог — человеку он всё равно приезжает уведомлением через брокер.
  const notify = settings
    ? (message) => publish(settings.notifyTopic, message)
    : (message) => log(`notify: ${message}`);
  const publishDone = settings
    ? (command) => publish(`${settings.base}/${command}/done`, '1')
    : () => {};

  // Заглушка той же формы, что стояла в http-server.js, — и она законна ровно
  // потому, что брокера нет: слоты спрашивает единственная команда
  // claude-focus-slot, а приходит она с панели openHASP, то есть по MQTT.
  const haExport = settings
    ? createHaExport({ winMan, publish, log, config: withBase })
    : { slots: () => [], slotOff: () => {}, refresh: () => {} };

  const router = createRouter(buildCommandMap({
    winMan, config: withBase, log, notify, haExport, publishDone,
  }));

  // Брокер этим троим не нужен, и ждать подключения они не должны: расстановка
  // окон при открытии работает и с лежащим брокером, сторож демона тем более —
  // он про поломку, которая случается сама по себе, — а http-транспорт и есть
  // причина, по которой служба теперь поднимается без брокера вовсе.
  const httpServer = startHttpServer({ router, port: config?.httpPort ?? 9722, log });
  const autoplacer = startAutoplacer({ winMan, config: withBase, log });
  const daemonWatchdog = startDaemonWatchdog({ winMan, log, notify });

  const stats = settings ? createStatsPublisher({ winMan, publish, log, config: withBase }) : null;

  if (!settings) {
    log('MQTT: W11M_MQTT_HOST или W11M_MQTT_BASE не заданы — работаем только по http', 'warn');
  }

  if (settings) {
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
  }

  return {
    stop() {
      haExport.stop?.();
      stats?.stop();
      autoplacer.stop();
      daemonWatchdog.stop();
      client?.end(true);
      httpServer.close();
    },
    httpPort: () => httpServer.address()?.port ?? 0,
    mqttConnected: () => Boolean(client),
    haExport: () => haExport,
  };
}

export { startService, FOREIGN_COMMANDS };
