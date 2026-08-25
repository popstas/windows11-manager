/**
 * Карта команд целиком — общая для обоих транспортов.
 *
 * Живёт в commands/, а не в mqtt/: её импортирует и http-сервер, и через
 * mqtt/ он тянул бы за собой клиент брокера, который ему не нужен.
 */
import { windowCommands } from './window-commands.js';
import { claudeCommands, slotFromPayload } from './claude-commands.js';
import { throttlePress } from './press-throttle.js';
import { createDelayedSlotOff } from './delayed-slot-off.js';

const SLOT_COUNT_DEFAULT = 10;

/**
 * Карта команд целиком.
 *
 * Ограничитель стоит на том, что приходит с физической кнопки платы:
 * `claude-focus-slot` и `claude-snapshot-restore`. Палец, снятый неровно, даёт
 * две-три посылки подряд, а каждая — переход фокуса в Windows, то есть
 * настоящая работа. `claude-focus` без ограничителя: там источник — Enter в
 * списке пикера, дребезжать нечему.
 */
function buildCommandMap({ winMan, config, log, notify, haExport, publishDone = () => {}, dock = null }) {
  const windows = windowCommands({ winMan, config, log, notify });
  const claude = claudeCommands({ winMan, log, notify, slots: () => haExport.slots() });

  // Панель с toggle:true рисует локальное включение раньше, чем доедет MQTT.
  // Полсекунды — после локального toggle, до ощущения «залипло».
  const schedulePanelSlotOff = createDelayedSlotOff({
    delayMs: 500,
    publish: (slot) => haExport.slotOff(slot),
  });

  /** После собственного перевода фокуса панель обновляем внеочередно. */
  const withRefresh = (fn) => async (payload) => {
    const result = await fn(payload);
    haExport.refresh();
    return result;
  };

  const map = {
    ...windows,
    // Ответ на просьбу сохранить раскладку. Его ждёт модуль power в
    // windows-mqtt перед перезагрузкой: подтверждение брокера говорит лишь о
    // доставке до него, а не о том, что раскладка записана на диск.
    async store(payload) {
      const result = await windows.store(payload);
      publishDone('store');
      return result;
    },
    'claude-focus': withRefresh(claude['claude-focus']),
    // Ограничитель по той же причине, что у claude-focus-slot: источник —
    // палец на панели openHASP, а каждая раскладка — десяток setBounds()
    // подряд, то есть настоящая работа.
    'claude-place': throttlePress(claude['claude-place'], {
      onDrop: (payload) => log(`claude-place ${payload} — отброшено, не чаще раза в секунду`, 'warn'),
    }),
    'claude-focus-slot': throttlePress(
      withRefresh(async (payload) => {
        await claude['claude-focus-slot'](payload);
        // Тело разбираем тем же разбором, что и сам обработчик: сырое
        // `{"slot":3}` давало Number(...) === NaN, слот не находился, и
        // плитка на панели оставалась гореть.
        schedulePanelSlotOff(slotFromPayload(payload));
      }),
      { onDrop: (payload) => log(`claude-focus-slot ${payload} — отброшено, не чаще раза в секунду`, 'warn') },
    ),
    // Нажатие на кнопку доски StreamDock. Ограничитель — по той же причине,
    // что у claude-focus-slot: источник тот же, живой палец на физической
    // кнопке. Слот резолвится по снимку доски, а не по снимку панели: у них
    // разные сроки годности, и кнопка обязана значить то, что на ней
    // нарисовано.
    'claude-dock-press': throttlePress(
      withRefresh(async (payload) => {
        const raw = slotFromPayload(payload);
        const slot = Number(raw);
        const found = dock?.resolve(slot) ?? null;
        // Два разных события, оба отвечают наружу одним и тем же
        // `{ empty: true }` (форма ответа — интерфейс задачи 4, менять её в
        // обход плана нельзя), но в логе им расходиться нужно: `null` — номер
        // вне диапазона доски, то есть опечатка в настройке кнопки, а не
        // нажатие на пустую. По http такое отсекается 404-м раньше роутера, а
        // по MQTT — нет, и молчать об этом нельзя. `raw`, а не `slot`, — чтобы
        // при пустом или нечисловом теле в логе было видно, что пришло, а не
        // NaN/0.
        if (!found) {
          log(`streamdock: слот ${JSON.stringify(raw)} вне диапазона доски`, 'warn');
          return { empty: true };
        }
        if (found.empty) {
          log(`streamdock: слот ${slot} пуст`, 'warn');
          return { empty: true };
        }
        await claude['claude-focus']({ id: found.id });
        return { id: found.id };
      }),
      { onDrop: (payload) => log(`claude-dock-press ${payload} — отброшено, не чаще раза в секунду`, 'warn') },
    ),
    'claude-session-unread': withRefresh(claude['claude-session-unread']),
    'claude-session-open': withRefresh(claude['claude-session-open']),
    'claude-snapshot-restore': throttlePress(claude['claude-snapshot-restore'], {
      onDrop: (payload) => log(`claude-snapshot-restore ${payload} — отброшено, не чаще раза в секунду`, 'warn'),
    }),
    async 'claude-wt-restore'(payload) {
      const { restoreClaudeSessions } = await import('../claude-wt/restore.js');
      const body = typeof payload === 'string' ? JSON.parse(payload || '{}') : (payload ?? {});
      return restoreClaudeSessions({ force: Boolean(body.force), sessionIds: body.sessionIds });
    },
  };

  // Нажатие на переключатель сессии в интерфейсе Home Assistant. Гасим до
  // перехода, а не после: focusWindowById() ходит в Windows и может
  // задуматься, а переключатель к этому моменту уже должен стоять правильно.
  const slotCount = config?.homeassistant?.slots ?? SLOT_COUNT_DEFAULT;
  for (let n = 1; n <= slotCount; n += 1) {
    map[`claude-slot-command:${n}`] = async () => {
      haExport.slotOff(n);
      await claude['claude-focus-slot']({ slot: n });
      haExport.refresh();
    };
  }

  return map;
}

export { buildCommandMap, SLOT_COUNT_DEFAULT };
