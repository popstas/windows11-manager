/**
 * Долгоживущая служба: клиент, карта команд, экспорт в Home Assistant.
 *
 * Процесс отдельный от демона claude-wt намеренно: http-сервер, поднятый
 * внутри демона, вешал событийный цикл через две-три минуты (см. src/lib/index.js).
 */
import { createRouter } from '../commands/router.js';
import { buildCommandMap } from '../commands/build.js';
import { createHaExport } from '../claude-wt/ha/export.js';
import { connectMqtt, readMqttSettings } from './client.js';

function startMqttService({ winMan, config, log, env = process.env }) {
  const settings = readMqttSettings(env);
  if (!settings) {
    log('MQTT: W11M_MQTT_HOST или W11M_MQTT_BASE не заданы — служба не поднята', 'warn');
    return { stop() {} };
  }

  const withBase = { ...config, base: settings.base };
  let client = null;
  const publish = (topic, payload, opts) => client?.publish(topic, String(payload), opts ?? {});
  const notify = (message) => publish(`${settings.base}/notify/notify`, message);
  const publishDone = (command) => publish(`${settings.base}/${command}/done`, '1');

  const haExport = createHaExport({ winMan, publish, log, config: withBase });
  const router = createRouter(buildCommandMap({
    winMan, config: withBase, log, notify, haExport, publishDone,
  }));

  client = connectMqtt({
    settings,
    log,
    onCommand: async (command, payload) => {
      const res = await router.dispatch(command, payload);
      if (!res.ok) log(`MQTT ${command}: ${res.error}`, 'warn');
    },
  });

  client.on('connect', () => haExport.start());

  return {
    stop() {
      haExport.stop();
      client?.end(true);
    },
  };
}

export { startMqttService };
