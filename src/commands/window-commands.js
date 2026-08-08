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

    async reload() {
      await winMan.reloadConfigs();
    },
  };
}

export { windowCommands, asObject, storeEntry };
