// src/claude-wt/dock/slots.js
/**
 * Снимок слотов физической доски StreamDock.
 *
 * Снимок свой, но строитель — тот же, что у экспорта в Home Assistant
 * (`buildSlots`), и умолчания те же: порядок на доске и на панели обязан
 * совпадать, а разойтись им негде — функция одна.
 *
 * Почему не `haExport.slots()` напрямую: тот наполняется тиком экспорта, а тик
 * заводится только по подключению к брокеру. Доска от брокера не зависит вовсе
 * — слушатель поднимается без mqtt, `focus` локальный, — и, взяв чужой снимок,
 * мы гасили бы кнопки ровно тогда, когда всё нужное для их работы живо.
 */
import { buildSlots, sessionIdForSlot } from '../ha/session-slots.js';
import { labelSessions, normalizeSort } from '../ha/session-groups.js';
import { slotSvg } from './render.js';

const DEFAULT_SLOTS = 5;
const DEFAULT_INTERVAL_SEC = 10;

/**
 * Число из конфига, где ноль — осмысленное значение, а не «не задано».
 *
 * `||` тут ловушка: явный `slots: 0` (доска фактически выключена) или
 * `interval: 0` (снимок каждый раз заново) молча превратились бы в
 * умолчание. `??` берёт значение только когда оно вправду не задано; мусор
 * (`NaN`, отрицательное) откатывается к умолчанию отдельной проверкой, а
 * дробное усекается — наружу не должен уехать бессмысленный `count`.
 */
function nonNegativeInt(value, fallback) {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : fallback;
}

/**
 * Настройки доски. `null` — доски нет: у сервера тогда нет и роутов.
 *
 * `sort` читается и под именем `sessionsSort`: так этот же ключ называется в
 * блоке `homeassistant`, и человек, скопировавший строку оттуда, получил бы
 * молчаливое умолчание вместо своего порядка.
 */
function dockConfig(config) {
  const raw = config?.streamdock;
  if (!raw || raw.enabled === false) return null;
  return {
    slots: nonNegativeInt(raw.slots, DEFAULT_SLOTS),
    intervalMs: nonNegativeInt(raw.interval, DEFAULT_INTERVAL_SEC) * 1000,
    sort: normalizeSort(raw.sort ?? raw.sessionsSort),
    openOnly: raw.openOnly !== false,
  };
}

function createDock({ winMan, config, log, now = Date.now }) {
  const cfg = dockConfig(config);
  if (!cfg) return null;

  let snapshot = [];
  let takenAt = -Infinity;
  // Был ли снимок построен хоть раз. Отдельно от `takenAt`, потому что вопросы
  // разные: `takenAt` — «не пора ли перечитать», `taken` — «есть ли вообще что
  // показывать». Нажатию нужен второй (см. `resolve`).
  let taken = false;

  function slots() {
    const at = now();
    if (at - takenAt < cfg.intervalMs) return snapshot;
    let sessions;
    try {
      const res = winMan.claudeWtSessions();
      if (!res.ok) throw new Error(res.reason);
      sessions = labelSessions(res.sessions);
    } catch (e) {
      // Прежний снимок лучше пустых кнопок: дамп на сетевом диске не читается
      // разово чаще, чем ломается насовсем.
      log(`streamdock: сессии не прочитаны — ${e.message}`, 'error');
      return snapshot;
    }
    const forSlots = cfg.openOnly ? sessions.filter((s) => s.open) : sessions;
    snapshot = buildSlots(forSlots, cfg.slots, cfg.sort);
    takenAt = at;
    taken = true;
    return snapshot;
  }

  const inRange = (n) => Number.isInteger(n) && n >= 1 && n <= cfg.slots;

  return {
    count: cfg.slots,
    slots,
    svg(n) {
      if (!inRange(n)) return null;
      const slot = slots().find((s) => s.slot === n);
      return slotSvg(slot ?? { slot: n, status: 'empty' });
    },
    /**
     * Сессия под кнопкой. Снимок по сроку годности **не** перечитывается —
     * берётся тот, что есть, и строится новый, только если снимка не было ни
     * разу.
     *
     * Кнопку жмут не в момент отрисовки. Картинка на доске нарисована прошлым
     * снимком, а срок годности к моменту нажатия обычно уже истёк, и `slots()`
     * построил бы **новый**: при `sort: recent` (умолчание) порядок слотов
     * пересобирает любая активность — `lastActivity` двигает каждый вызов
     * инструмента. Окно расхождения шириной до ~20 секунд было бы открыто
     * постоянно, а промах выглядел бы как «иногда поднимается соседнее окно»,
     * молча.
     *
     * Свежесть при этом не теряется: доска тянет картинки всех кнопок каждые
     * свои `updateInterval`, то есть снимок обновляет тот, кто рисует. Нажатие
     * резолвится по снимку последней отданной картинки — по тому, что человек
     * видит. Картинок никто не тянет (доска выключена) — снимок стареет, но
     * ровно настолько же стара и картинка на кнопке; согласованность тут и есть
     * цель, а не свежесть. Ограничивать возраст снимка сверху нельзя — это
     * вернуло бы ту же дыру.
     */
    resolve(n) {
      if (!inRange(n)) return null;
      const id = sessionIdForSlot(taken ? snapshot : slots(), n);
      return id ? { id } : { empty: true };
    },
  };
}

// Наружу — только `createDock`. `DEFAULT_SLOTS` не экспортируется нарочно: имя
// занято и в `ha/session-slots.js`, где оно значит другое число (9 против 5), и
// два одноимённых экспорта рано или поздно импортируют не тот.
export { createDock };
