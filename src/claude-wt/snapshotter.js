import { getMons } from '../monitors.js';
import { monitorNumberForBounds } from './view-helpers.js';
import {
  snapshotsPath,
  readSnapshots,
  writeSnapshots,
  compositionKey,
  buildSnapshotSessions,
  decideSnapshot,
  trackComposition,
  appendSnapshot,
  updateLastSnapshot,
  snapshotsFingerprint,
} from './snapshots.js';

// Дебаунс живёт в памяти демона: N минут стабильности означают «это была не
// случайная конфигурация», а убитый посреди ожидания демон и так ничего не
// гарантирует. Снимки при этом на диске, их переживать нечему.
let pendingKey = '';
let pendingSince = 0;
let lastWritten = '';
let cache = null;
let cachePath = '';

function resetSnapshotter() {
  pendingKey = '';
  pendingSince = 0;
  lastWritten = '';
  cache = null;
  cachePath = '';
}

/** Человекочитаемый id: время создания в местной зоне, без двоеточий. */
function snapshotId(nowMs) {
  const d = new Date(nowMs);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T`
    + `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/**
 * Снять расклад, если он того заслуживает.
 *
 * Вызывается из тика демона. Дорогого тут ничего нет: пока состав не менялся и
 * координаты те же, всё сводится к склейке строки из id сессий.
 *
 * `getMons()` дёргается только в момент записи — снимки редкие, а номер
 * монитора нужно посчитать именно тогда, потому что в снимке он должен
 * остаться таким, каким был.
 */
function snapshotTick({ cfg, slots, openSessionIds, nowMs }) {
  if (!cfg?.snapshots?.enabled) return null;
  const filePath = snapshotsPath(cfg);
  if (!filePath) return null;

  // Файл читается один раз за жизнь процесса: дальше он только пишется отсюда
  // же, и перечитывать его каждый тик значило бы платить вводом-выводом за
  // собственные байты.
  if (cachePath !== filePath || !cache) {
    cache = readSnapshots(filePath);
    cachePath = filePath;
    lastWritten = snapshotsFingerprint(cache.snapshots);
  }

  const key = compositionKey(openSessionIds);
  const decision = decideSnapshot({
    key,
    lastKey: compositionKey((cache.snapshots[0]?.sessions ?? []).map(s => s.id)),
    pendingKey,
    pendingSince,
    now: nowMs,
    debounceMs: cfg.snapshots.debounceMs,
  });
  ({ pendingKey, pendingSince } = trackComposition({ key, pendingKey, pendingSince, now: nowMs }));
  if (!decision) return null;

  const mons = getMons();
  const sessions = buildSnapshotSessions({
    sessionIds: openSessionIds,
    slots,
    monitorOf: bounds => monitorNumberForBounds(mons, bounds),
  });
  // Слот без пригодных координат отсеивается, и от состава может не остаться
  // ничего — писать пустой снимок незачем.
  if (!sessions.length) return null;

  const nowSec = Math.floor(nowMs / 1000);
  const next = decision === 'append'
    ? appendSnapshot(cache.snapshots, {
      id: snapshotId(nowMs), sessions, now: nowSec, keep: cfg.snapshots.keep,
    })
    : updateLastSnapshot(cache.snapshots, { sessions, now: nowSec });

  const fingerprint = snapshotsFingerprint(next);
  if (fingerprint === lastWritten) return null;
  cache = { ...cache, snapshots: next };
  writeSnapshots(filePath, cache);
  lastWritten = fingerprint;
  return decision;
}

/** Снимки для CLI и меню: с диска, чтобы работало и без запущенного демона. */
function listSnapshots(cfg) {
  const filePath = snapshotsPath(cfg);
  if (!filePath) return [];
  return readSnapshots(filePath).snapshots;
}

/**
 * Снимки, которые процесс уже знает, — без ввода-вывода.
 *
 * Для файла оконного трекера: он пишется из тика, а `listSnapshots` читает
 * файл снимков с диска. Кэш здесь тот же, что заполняет и переписывает
 * snapshotTick, так что свежее него в этом процессе всё равно ничего нет.
 *
 * Холодный кэш (демон только поднялся) — пустой список, а не чтение файла:
 * первый же тик его заполнит, а до тех пор поле в файле трекера просто
 * пустое. Читатель на той стороне пустой список переживает.
 */
function currentSnapshots() {
  return cache?.snapshots ?? [];
}

export { snapshotTick, resetSnapshotter, listSnapshots, snapshotId, currentSnapshots };
