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
    resolve(n) {
      if (!inRange(n)) return null;
      const id = sessionIdForSlot(slots(), n);
      return id ? { id } : { empty: true };
    },
  };
}

export { createDock, DEFAULT_SLOTS, DEFAULT_INTERVAL_SEC };
