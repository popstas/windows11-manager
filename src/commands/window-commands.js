/**
 * Оконные команды. Переехали из windows-mqtt/src/modules/windows.js — там они
 * были обработчиками MQTT-подписок и жили в одном файле с claude-wt и
 * экспортом в Home Assistant.
 *
 * Зависимости приходят аргументом, а не импортом: winMan тянет
 * node-window-manager, нативный модуль, которого нет на машине разработчика.
 */

/**
 * Тело команды приходит и объектом, и строкой JSON: брокер несёт байты.
 *
 * `onError` обязателен по смыслу, хоть и не по сигнатуре: битый JSON давал
 * пустой объект, неотличимый от пустой посылки, и `place` молча ничего не
 * ставил. Логгер сюда передаётся аргументом, а не берётся из модуля: функция
 * чистая и живёт выше замыкания с log.
 */
function asObject(payload, onError = () => {}) {
  if (payload && typeof payload === 'object') return payload;
  const raw = String(payload ?? '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
    onError(`не объект: ${raw}`);
    return {};
  } catch (e) {
    onError(`${e.message}: ${raw}`);
    return {};
  }
}

/** store.custom / store.default пишут список либо в windows, либо в apps. */
function storeEntry(entry) {
  if (!entry) return null;
  if (entry.apps) return { ...entry, windows: entry.apps.map((path) => ({ path })) };
  return entry;
}

function windowCommands({ winMan, config, log }) {
  /** Разбор тела с жалобой в лог: имя команды нужно, чтобы понять, чьё тело. */
  const body = (command) => (payload) =>
    asObject(payload, (reason) => log(`${command}: тело не разобрано — ${reason}`, 'warn'));

  async function restore() {
    await winMan.restoreWindows();
    const stored = storeEntry(config?.store?.custom);
    if (stored) await winMan.openStore(stored);
  }

  return {
    async autoplace() {
      const placed = await winMan.placeWindows();
      log(`Placed windows: ${placed.length}`);
      return { placed: placed.length };
    },

    async place(payload) {
      await winMan.placeWindowByConfig(body('place')(payload));
    },

    async placeAll() {
      const placed = await winMan.placeWindows();
      return { placed: placed.length };
    },

    store() {
      winMan.storeWindows();
    },

    restore,

    clear() {
      winMan.clearWindows();
    },

    open(payload) {
      winMan.openStore(body('open')(payload));
    },

    async focus(payload) {
      const rule = body('focus')(payload);
      const focused = await winMan.focusWindow(rule);
      if (!focused) log(`focus: no window matched ${JSON.stringify(rule)}`, 'warn');
    },

    async desktop(payload) {
      const { number } = body('desktop')(payload);
      await winMan.virtualDesktop.GoToDesktopNumber(Number(number) - 1);
    },

    /**
     * Перечитать конфиг с диска — прямо в тот объект, который держат карта
     * команд и экспорт в Home Assistant.
     *
     * getConfig() отдаёт каждый раз новый объект, поэтому результат
     * reloadConfigs() раньше просто выбрасывался, и в долгоживущих процессах
     * (mqtt, http-server) команда не меняла ничего. Мутация на месте оживляет
     * всё, что читается в момент вызова, — прежде всего store.custom у restore.
     * `base` в объект дописан транспортом и в конфиге на диске его нет.
     */
    async reload() {
      const fresh = await winMan.reloadConfigs();
      if (config && fresh) {
        const { base } = config;
        for (const key of Object.keys(config)) delete config[key];
        Object.assign(config, fresh);
        if (base !== undefined) config.base = base;
      }
      // А это собрано один раз при старте: homeassistant.slots задаёт список
      // обработчиков claude-slot-command:N в карте команд, homeassistant.interval
      // — уже заведённый setInterval экспорта. Молчать об этом нельзя, иначе
      // reload по-прежнему отчитывался бы успехом, ничего не поменяв.
      log('reload: конфиг перечитан; homeassistant.slots и homeassistant.interval '
        + 'применятся только после перезапуска процесса', 'warn');
      return { reloaded: true };
    },
  };
}

export { windowCommands, asObject, storeEntry };
