/**
 * Оконные команды. Переехали из windows-mqtt/src/modules/windows.js — там они
 * были обработчиками MQTT-подписок и жили в одном файле с claude-wt и
 * экспортом в Home Assistant.
 *
 * Зависимости приходят аргументом, а не импортом: winMan тянет
 * node-window-manager, нативный модуль, которого нет на машине разработчика.
 */

/** Тело команды приходит и объектом, и строкой JSON: брокер несёт байты. */
function asObject(payload) {
  if (payload && typeof payload === 'object') return payload;
  const raw = String(payload ?? '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
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
      await winMan.placeWindowByConfig(asObject(payload));
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
      winMan.openStore(asObject(payload));
    },

    async focus(payload) {
      const rule = asObject(payload);
      const focused = await winMan.focusWindow(rule);
      if (!focused) log(`focus: no window matched ${JSON.stringify(rule)}`, 'warn');
    },

    async desktop(payload) {
      const { number } = asObject(payload);
      await winMan.virtualDesktop.GoToDesktopNumber(Number(number) - 1);
    },

    async reload() {
      await winMan.reloadConfigs();
    },
  };
}

export { windowCommands, asObject, storeEntry };
