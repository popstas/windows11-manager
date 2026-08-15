/** Pure helper functions for claude-wt snapshots. No external I/O. */

import { planWtLaunch } from './project-helpers.js';

const SNAPSHOTS_VERSION = 1;

const SNAPSHOT_DEFAULTS = {
  enabled: true,
  path: '',
  debounceMs: 60000,
  keep: 20,
};

function emptySnapshots() {
  return { version: SNAPSHOTS_VERSION, snapshots: [] };
}

/**
 * Чем один расклад отличается от другого — составом открытых сессий.
 *
 * Порядок окон на экране меняется от тика к тику (окна приходят в порядке
 * hwnd'ов), поэтому набор сортируется: иначе перестановка выглядела бы сменой
 * состава и плодила снимки на пустом месте.
 */
function compositionKey(sessionIds) {
  return [...new Set(sessionIds ?? [])].sort().join(',');
}

function isBounds(b) {
  return Boolean(b) && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(b[k]));
}

/**
 * Строки снимка: копия того, что известно о сессии сейчас.
 *
 * Именно копия, а не ссылка на слот. Слот — это «где окно сессии сегодня», и
 * он переписывается: после закрытия и переоткрытия там оказывается дефолтная
 * геометрия Windows Terminal. Снимок должен помнить расклад, каким он был.
 */
function buildSnapshotSessions({ sessionIds, slots, monitorOf }) {
  const out = [];
  for (const id of [...new Set(sessionIds ?? [])].sort()) {
    const slot = slots?.[id];
    if (!slot || !isBounds(slot.bounds)) continue;
    out.push({
      id,
      title: slot.titles?.[0] ?? '',
      cwd: slot.cwd ?? '',
      bounds: { ...slot.bounds },
      desktop: slot.desktop ?? null,
      monitor: monitorOf ? (monitorOf(slot.bounds) ?? null) : null,
    });
  }
  return out;
}

/** Новые первыми, лишние отбрасываются с хвоста. */
function pruneSnapshots(snapshots, keep) {
  const limit = Number.isFinite(keep) && keep > 0 ? keep : SNAPSHOT_DEFAULTS.keep;
  return (snapshots ?? []).slice(0, limit);
}

/**
 * Что снапшотер должен сделать на этом тике.
 *
 * Возвращает `'append'` (состав устоялся после изменения — новый снимок),
 * `'update'` (состав тот же, съехали координаты — обновить последний) или
 * `null` (ничего не делать).
 *
 * Пустой состав не снимается вовсе. Закрыл всё на ночь — снимок с нулём
 * сессий не пишется, и `snapshots-restore last` наутро поднимает последний
 * рабочий набор, а не пустоту.
 */
function decideSnapshot({ key, lastKey, pendingKey, pendingSince, now, debounceMs }) {
  if (!key) return null;
  // Состав совпадает с последним снимком: остаются только координаты.
  if (key === lastKey) return pendingKey && pendingKey !== key ? null : 'update';
  // Состав другой — ждём, пока он устоится.
  if (pendingKey !== key) return null;
  const waited = now - (pendingSince ?? now);
  return waited >= debounceMs ? 'append' : null;
}

/**
 * Отследить изменение состава для дебаунса.
 *
 * Таймер перезапускается на каждое новое значение ключа: снимок фиксирует не
 * момент изменения, а устоявшееся состояние. Пока открываются три сессии
 * подряд, промежуточные конфигурации в историю не попадают.
 */
function trackComposition({ key, pendingKey, pendingSince, now }) {
  if (key === pendingKey) return { pendingKey, pendingSince };
  return { pendingKey: key, pendingSince: now };
}

/** Новый снимок в голову списка, старые вытесняются. */
function appendSnapshot(snapshots, { id, sessions, now, keep }) {
  return pruneSnapshots([
    { id, created: now, updated: now, sessions },
    ...(snapshots ?? []),
  ], keep);
}

/**
 * Переписать координаты в последнем снимке.
 *
 * Состав тот же, окно просто подвинули — новой строчки в меню быть не должно,
 * иначе таскание окна мышкой плодило бы снимки.
 */
function updateLastSnapshot(snapshots, { sessions, now }) {
  const list = snapshots ?? [];
  if (!list.length) return list;
  const [head, ...rest] = list;
  return [{ ...head, updated: now, sessions }, ...rest];
}

/**
 * Привести прочитанное с диска к рабочей форме.
 *
 * Файл переживает обновления и правки руками, поэтому доверия к нему нет:
 * чужая версия — начинаем с нуля, снимок без пригодных сессий выбрасывается
 * (восстанавливать из него нечего).
 */
function normalizeSnapshots(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== SNAPSHOTS_VERSION) return emptySnapshots();
  const snapshots = (Array.isArray(raw.snapshots) ? raw.snapshots : [])
    .map(s => ({
      id: typeof s?.id === 'string' ? s.id : '',
      created: Number.isFinite(s?.created) ? s.created : 0,
      updated: Number.isFinite(s?.updated) ? s.updated : 0,
      sessions: (Array.isArray(s?.sessions) ? s.sessions : [])
        .filter(x => typeof x?.id === 'string' && x.id && isBounds(x.bounds))
        .map(x => ({
          id: x.id,
          title: typeof x.title === 'string' ? x.title : '',
          cwd: typeof x.cwd === 'string' ? x.cwd : '',
          bounds: x.bounds,
          desktop: Number.isFinite(x.desktop) ? x.desktop : null,
          monitor: Number.isFinite(x.monitor) ? x.monitor : null,
        })),
    }))
    .filter(s => s.id && s.sessions.length);
  return { version: SNAPSHOTS_VERSION, snapshots };
}

/** Слепок содержимого — чтобы не писать файл, когда ничего не изменилось. */
function snapshotsFingerprint(snapshots) {
  return JSON.stringify((snapshots ?? []).map(s => [s.id, s.sessions]));
}

/**
 * Что поднимать из снимка.
 *
 * Дедупликация по session id против уже открытых — всегда, без флагов. Именно
 * отказ «сначала закройте их» делал прежний restore бесполезным в самом частом
 * случае: закрыл одну сессию из трёх и хочешь вернуть только её.
 *
 * Координаты берутся из снимка, а не из текущих слотов, — в этом весь смысл
 * хранить копию.
 */
function planSnapshotRestore({ snapshot, openSessionIds, sessionIds, launch, resolveProfile }) {
  const open = openSessionIds ?? new Set();
  const wanted = sessionIds?.length ? new Set(sessionIds) : null;
  const resolve = typeof resolveProfile === 'function' ? resolveProfile : () => '';
  return (snapshot?.sessions ?? [])
    .filter(s => !open.has(s.id))
    .filter(s => !wanted || wanted.has(s.id))
    .map(s => {
      const planned = planWtLaunch({
        launch,
        vars: { id: s.id },
        profile: resolve(s.cwd ?? ''),
      });
      return {
        sessionId: s.id,
        title: s.title,
        command: planned.command,
        args: planned.args,
        bounds: s.bounds,
        desktop: s.desktop,
      };
    });
}

/**
 * Снимок по идентификатору. `last` — буквально самый свежий.
 *
 * Никакого поиска «последнего, в котором есть потерянное»: команда, молча
 * уходящая на три снимка назад, оставляет человека гадать, откуда взялось окно.
 */
function findSnapshot(snapshots, id) {
  const list = snapshots ?? [];
  if (!id || id === 'last') return list[0] ?? null;
  return list.find(s => s.id === id) ?? null;
}

export {
  SNAPSHOTS_VERSION,
  SNAPSHOT_DEFAULTS,
  emptySnapshots,
  compositionKey,
  buildSnapshotSessions,
  appendSnapshot,
  updateLastSnapshot,
  normalizeSnapshots,
  pruneSnapshots,
  decideSnapshot,
  trackComposition,
  snapshotsFingerprint,
  planSnapshotRestore,
  findSnapshot,
};
