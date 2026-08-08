/**
 * Экспорт сессий claude-wt в Home Assistant. Переехал из
 * windows-mqtt/src/modules/windows.js:490-621.
 *
 * Транспорт — MQTT Discovery, а не REST: только так у сущностей появляется
 * устройство, unique_id и жизнь после перезапуска HA. /api/states пишет
 * состояние мимо реестра, поэтому там ни устройства, ни переименования.
 *
 * Свой таймер, а не подача пикера: панель показывает список постоянно.
 * Интервал редкий — claudeWtSessions() сканирует окна через getWindows(), и
 * раз в секунду в фоне ему тут делать нечего.
 */
import { labelSessions, normalizeSort } from './session-groups.js';
import { buildSlots } from './session-slots.js';
import { discoveryMessages, namesFingerprint, stateMessages, topics } from './discovery.js';
import { sessionEntity, buildSessionEntities, buildSummaryEntity } from './entities.js';

// Два тика демона claude-wt (у него интервал 1000 мс). Отметку «просмотрено»
// ставит демон, а не мы в момент перевода фокуса, — значит сразу после
// focusWindowById() состояние на диске ещё прежнее, и экспорт по горячим
// следам опубликовал бы ровно тот статус, от которого человек только что ушёл.
const REFRESH_DELAY_MS = 2000;

function createHaExport({ winMan, publish, log, config }) {
  const ha = config?.homeassistant ?? {};
  const cfg = {
    slots: ha.slots ?? 10,
    interval: (ha.interval ?? 15) * 1000,
    enabled: ha.enabled !== false,
    // Закрытые сессии на панели только мешают: строк там единицы, и каждая,
    // занятая давно закрытой сессией, вытесняет живую.
    openOnly: ha.openOnly !== false,
    sort: normalizeSort(ha.sessionsSort),
  };
  const base = config.base;

  let timerId = null;
  let refreshId = null;
  let announced = null;
  let lastSlots = [];

  function publishAll(messages) {
    for (const m of messages) publish(m.topic, m.payload, { retain: m.retain, qos: 0 });
  }

  function tick() {
    if (!cfg.enabled) return;
    let sessions;
    try {
      const res = winMan.claudeWtSessions();
      if (!res.ok) throw new Error(res.reason);
      sessions = labelSessions(res.sessions);
    } catch (e) {
      log(`claude-wt sessions failed: ${e.message}`, 'error');
      return;
    }
    // Сводка считается по всем сессиям, слоты — только по живым: total в
    // сводке должен оставаться total.
    const slotSessions = cfg.openOnly ? sessions.filter((s) => s.open) : sessions;
    lastSlots = buildSlots(slotSessions, cfg.slots, cfg.sort);

    const fingerprint = namesFingerprint(lastSlots.map((s) => s.title));
    if (fingerprint !== announced) {
      publishAll(discoveryMessages(base, cfg.slots, lastSlots.map((s) => s.title)));
      announced = fingerprint;
    }
    publishAll(stateMessages(base, [
      buildSummaryEntity(sessions),
      ...buildSessionEntities(slotSessions, cfg.slots, cfg.sort),
    ]));
  }

  return {
    /**
     * Зовётся на каждое подключение к брокеру, а не только на первое.
     *
     * Повторный вызов — это переподключение, и слепок имён надо сбросить:
     * конфиги Discovery публикуются retained, но брокер, переживший
     * перезапуск без сохранения retained, теряет их вместе с устройством
     * claude_wt. Раньше `announced` переживал разрыв, start() выходил по уже
     * заведённому таймеру, и устройство не возвращалось в Home Assistant до
     * ближайшей смены состава сессий. Тик тоже внеочередной: ждать до
     * пятнадцати секунд с пустым устройством незачем.
     */
    start() {
      if (!cfg.enabled) return;
      announced = null;
      if (timerId === null) {
        log(`home assistant: publishing ${cfg.slots} session slots every ${cfg.interval / 1000}s`);
        timerId = setInterval(tick, cfg.interval);
        timerId.unref?.();
      }
      tick();
    },

    stop() {
      if (refreshId !== null) {
        clearTimeout(refreshId);
        refreshId = null;
      }
      if (timerId === null) return;
      clearInterval(timerId);
      timerId = null;
      // Сущности станут unavailable, а не застынут с последним состоянием:
      // пока нас нет, никакой номер слота ничего не значит.
      publish(topics(base).availability, 'offline', { retain: true, qos: 0 });
    },

    /** Внеочередной экспорт после того, как мы сами перевели фокус. */
    refresh(delay = REFRESH_DELAY_MS) {
      // Один отложенный экспорт на серию нажатий: пока прошлый не отработал,
      // новый таймер публиковал бы то же самое.
      if (!cfg.enabled || refreshId !== null) return;
      refreshId = setTimeout(() => {
        refreshId = null;
        tick();
      }, delay);
      refreshId.unref?.();
    },

    /**
     * Погасить переключатель слота, не дожидаясь очередного экспорта.
     *
     * Публикуется слот целиком: состояние и атрибуты живут в одном топике, и
     * нагрузка из одного `state` стёрла бы текст, сводку и цифры.
     */
    slotOff(slot) {
      if (!cfg.enabled) return;
      const known = lastSlots.find((s) => s.slot === Number(slot));
      if (!known) return;
      publishAll(stateMessages(base, [{ ...sessionEntity(known), state: 'off' }]));
    },

    slots: () => lastSlots,
  };
}

export { createHaExport, REFRESH_DELAY_MS };
