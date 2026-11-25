import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { indexSessions, indexBackgroundAgents, indexShellSessions, indexProjectOwners, hasHookStamp, mergeIndexes } from './sessions-helpers.js';
import { progressStamp, activityAt } from './progress.js';

// Кэш — по пути: дампов теперь бывает два (удалённый на V: и местный при
// `features.localSource`), и общий слот на двоих вытеснял бы один другим —
// каждый тик перечитывался бы дамп в двести килобайт по сетевому диску.
const caches = new Map();
const EMPTY = Object.freeze({ index: {}, agents: {}, shells: new Set(), owners: {} });
let lastWarnedAt = 0;
const WARN_INTERVAL_MS = 5 * 60 * 1000;

// Тот же срок годности и по той же причине, что у записей в progress.js: оба
// ключа кэша — mtime файлов на сетевом диске, а долгоживущий процесс минутами
// получает от statSync() прежние отметки, пока свежий видит новые.
//
// Замерено 2026-08-02: сессии `home` и `obsidian-agent-workspace` перезапустились
// под новыми id, свежий процесс разбирал дамп правильно, а демон 15 минут
// продолжал отдавать индекс со старыми — окна привязывались к id, которых в
// дампе давно нет, и в списке эти сессии просто исчезли.
//
// Срок здесь длиннее, чем у состояний (3 с): там файлы по три сотни байт, а
// дамп — под двести килобайт, и перечитывать его каждые три секунды из тика
// демона значит держать на сетевом диске постоянный поток ради файла, который
// меняется несколько раз в день. Пятнадцать секунд задержки не видно: сам дамп
// узнаёт о перезапущенной сессии не быстрее, а заголовок окна ещё должен
// устояться два тика.
const MAX_AGE_MS = 15000;

/**
 * Прочитать дамп, не поверив кэшу SMB на слово.
 *
 * Файл сначала открывается с правом записи и сразу закрывается. Ничего не
 * пишется: смысл в самом открытии — запрос на запись ломает read lease, и
 * редиректор выбрасывает закэшированное содержимое. Следующее чтение приходит
 * с сервера.
 *
 * Без этого дамп читается поколением назад. Он переписывается на pc-virt
 * локально (временный файл + rename), мимо шары, — Samba не ломает клиенту
 * lease, и тот продолжает отдавать старые байты. Замерено 2026-08-03:
 * `V:\.ccfzf.sessions.json` пятнадцать минут читался предыдущим поколением,
 * из-за чего сессия, открытая после прошлого дампа, не появлялась нигде — ни
 * в пикере, ни на плате. Кэш индекса ниже ключуется по mtime, а тот успевал
 * обновиться, так что устаревшие байты закреплялись за новой отметкой.
 *
 * Отличить такое чтение от честного изнутри нельзя: кэш согласован сам с
 * собой — размер из statSync совпадает с числом прочитанных байт, потому что
 * оба оттуда же. Разъезжается только mtime, и то не всегда: замерено и то, и
 * другое. Поэтому не гадаем, а сбрасываем кэш на каждое перечитывание — оно
 * и так случается не чаще раза в MAX_AGE_MS, лишнее открытие на фоне
 * двухсоткилобайтного файла не стоит ничего.
 *
 * Не открылось (шара только на чтение, файл переписывают прямо сейчас) —
 * читаем как есть: устаревший индекс лучше пустого.
 */
function readDump(filePath) {
  try {
    fs.closeSync(fs.openSync(filePath, 'r+'));
  } catch (e) {
    warnThrottled(`session dump cache not bustable (${filePath}): ${e.message}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/** The daemon ticks once a second; an unthrottled warning would be its own problem. */
function warnThrottled(message) {
  const now = Date.now();
  if (now - lastWarnedAt < WARN_INTERVAL_MS) return;
  lastWarnedAt = now;
  console.error(`[claude-wt] ${message}`);
}

/**
 * Нужны ли этому дампу отметки хуков со стороны читателя.
 *
 * Не нужны, когда `hasHookStamp` верно для каждой сессии: ранжировать тёзок
 * тогда нечем, кроме самого дампа, и `progressStamp` в ключе кэша — сетевой
 * stat каталога на V: в каждом тике демона — становится платой ни за что.
 * Пустой список сессий ничего не доказывает, поэтому считается «нужны».
 *
 * Калитка нарочно зовёт ту же функцию, что и `stampOf` в sessions-helpers.js,
 * а не повторяет её условие: `indexSessions` проваливается в пробу ровно
 * тогда, когда `hasHookStamp` лжёт «нет своей отметки», и если бы здесь стояло
 * своё, отдельно живущее условие, расхождение с `stampOf` было бы возможным
 * молча — то самое расхождение кэша с его настоящей зависимостью, которое уже
 * стоило пятнадцати минут потерянных окон (см. MAX_AGE_MS выше).
 */
function dumpNeedsHookStamps(dump) {
  const sessions = Array.isArray(dump?.sessions) ? dump.sessions : [];
  return sessions.length === 0 || !sessions.every(hasHookStamp);
}

/**
 * Read the ccfzf dump and index it. The file is re-read only when its mtime
 * changes: the daemon asks for the index once a second, the dump changes a few
 * times a day.
 *
 * Failure handling differs by kind, on purpose:
 * - the path cannot be stat'ed (V: unmounted) — keep serving the last index
 *   read from that same path, and only fall back to `{}` when we have nothing
 *   cached for it. Losing every session because a network drive blinked would
 *   be worse than a slightly stale index.
 * - the file is there but unreadable (truncated or half-written JSON) — cache
 *   an empty index for that mtime, so we neither re-parse it every tick nor
 *   keep serving data the file no longer contains.
 * Either way the tracker degrades to its own title history rather than throwing.
 */
function loadDump(filePath, progressDir = '', nowMs = Date.now(), wanted = false, { quietMissing = false } = {}) {
  if (!filePath) return EMPTY;
  const cache = caches.get(filePath) ?? null;
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (e) {
    // Местного дампа нет — пикер на этой машине не запускали: норма, а не
    // поломка, и жалоба шла бы в журнал каждые пять минут.
    if (!(quietMissing && e.code === 'ENOENT')) warnThrottled(`session dump unreachable (${filePath}): ${e.message}`);
    return cache ?? EMPTY;
  }
  // Индекс зависит не только от дампа: у спорных заголовков победителя выбирают
  // отметки хуков, а они меняются независимо. Каталог состояний меняет mtime
  // на каждую запись хука (временный файл + переименование), так что его
  // отметка — достаточный признак «пора пересобрать». Но только пока дамп сам
  // не несёт activityAt на каждую сессию — тогда пересборка зависит только от
  // дампа, и сетевой stat каталога состояний в ключе кэша ничего не решает.
  // Пока не известно, какой дамп придёт, — спрашиваем. Первое чтение после
  // старта процесса платит один stat, дальше ноль.
  const needStamp = !cache || cache.usesHookStamps !== false;
  const stamp = needStamp ? progressStamp(progressDir) : 0;
  // `wanted` — тику попалось окно, чьего заголовка в индексе нет. Ждать срока
  // годности тогда незачем: сессию за этим окном завели секунды назад, и
  // пятнадцать секунд здесь — это пятнадцать секунд, которые окно простоит
  // непривязанным. Вхолостую спрос не возникает вовсе: окна не меняются часами.
  if (!wanted && cache && cache.mtimeMs === stat.mtimeMs
      && cache.stamp === stamp && nowMs - cache.readAt < MAX_AGE_MS) {
    return cache;
  }
  let next;
  try {
    const dump = readDump(filePath);
    const index = indexSessions(
      dump,
      progressDir ? id => activityAt(progressDir, id) : undefined,
    );
    next = {
      path: filePath, mtimeMs: stat.mtimeMs, stamp, readAt: nowMs,
      index, agents: indexBackgroundAgents(dump), shells: indexShellSessions(dump),
      owners: indexProjectOwners(dump),
      usesHookStamps: dumpNeedsHookStamps(dump),
    };
  } catch (e) {
    warnThrottled(`session dump unreadable (${filePath}): ${e.message}`);
    next = {
      path: filePath, mtimeMs: stat.mtimeMs, stamp, readAt: nowMs, index: {}, agents: {},
      shells: new Set(), owners: {}, usesHookStamps: true,
    };
  }
  caches.set(filePath, next);
  return next;
}

/** Title -> session, for binding a window to the session running in it. */
function loadSessionIndex(filePath, progressDir = '', nowMs = Date.now(), wanted = false) {
  return loadDump(filePath, progressDir, nowMs, wanted).index;
}

/**
 * Родитель -> его фоновые агенты. Из того же дампа и того же кэша: тик демона
 * этого не спрашивает, а view-слой всё равно читает индекс рядом.
 */
function loadBackgroundAgents(filePath, progressDir = '', nowMs = Date.now()) {
  return loadDump(filePath, progressDir, nowMs).agents;
}

/**
 * Сессии с фоновой командой при законченном ходе (`shell` в дампе) — для
 * кнопки окна на панели задач. Из того же дампа и того же кэша, что индекс:
 * отставание то же — дамп плюс MAX_AGE_MS.
 */
function loadShellSessions(filePath, progressDir = '', nowMs = Date.now()) {
  return loadDump(filePath, progressDir, nowMs).shells;
}

/** Drop the cached dumps so the next loadSessionIndex re-reads from disk. */
function invalidateSessionIndex() {
  caches.clear();
}

/**
 * Местный дамп ccfzf этой машины — его пишет агрегатор пикера, запущенный
 * здесь же (`~/.ccfzf.sessions.json`, то же умолчание, что у ccfzf и у
 * macos-windows-manager).
 */
function localDumpPath(home = os.homedir()) {
  return path.join(home, '.ccfzf.sessions.json');
}

/**
 * Источники индекса сессий по конфигу claudeWt: удалённый дамп
 * (`sessionsFile`, машина sshHost) и, при `features.localSource`, местный.
 *
 * Местный читается без `progressDir`: каталог состояний хуков — на V:, местных
 * сессий в нём не бывает, и проба `activityAt` была бы сетевым stat на каждую
 * сборку впустую.
 */
function sessionDumps(cfg, home = os.homedir()) {
  const out = [];
  if (cfg?.sessionsFile) out.push({ path: cfg.sessionsFile, progressDir: cfg.progressDir ?? '', local: false });
  if (cfg?.features?.localSource) out.push({ path: localDumpPath(home), progressDir: '', local: true });
  return out;
}

function loadAll(cfg, nowMs, wanted, home) {
  return sessionDumps(cfg, home).map(src => ({
    ...src,
    dump: loadDump(src.path, src.progressDir, nowMs, wanted, { quietMissing: src.local }),
  }));
}

/**
 * Индекс «заголовок → сессия» из всех источников конфига. Удалённый перебивает
 * местный на совпадении заголовка — правило macos-windows-manager: так трекер
 * вёл себя до второго источника, и окно ssh-сессии привязывается как раньше.
 * Цена — местная тёзка окна не получит.
 */
function loadSessionIndexFor(cfg, nowMs = Date.now(), wanted = false, home = os.homedir()) {
  return mergeField(loadAll(cfg, nowMs, wanted, home), 'index');
}

/** Поле кэша дампа из всех источников: местные, поверх — удалённые. */
function mergeField(all, field) {
  return mergeIndexes(all.filter(a => a.local).map(a => a.dump[field]), all.filter(a => !a.local).map(a => a.dump[field]));
}

/**
 * Индекс заголовков и владельцы (`loadProjectOwnersFor`) за один проход по
 * источникам: каждый проход — `stat` дампа на сетевом диске, а службы иконок
 * и кнопок панели задач спрашивают оба сразу.
 */
function loadSessionIndexAndOwnersFor(cfg, nowMs = Date.now(), home = os.homedir()) {
  const all = loadAll(cfg, nowMs, false, home);
  return { index: mergeField(all, 'index'), owners: mergeField(all, 'owners') };
}

/** Фоновые агенты из всех источников; удалённый перебивает на том же родителе. */
function loadBackgroundAgentsFor(cfg, nowMs = Date.now(), home = os.homedir()) {
  const all = loadAll(cfg, nowMs, false, home);
  return mergeIndexes(all.filter(a => a.local).map(a => a.dump.agents), all.filter(a => !a.local).map(a => a.dump.agents));
}

/** Сессии с фоновой командой из всех источников. */
function loadShellSessionsFor(cfg, nowMs = Date.now(), home = os.homedir()) {
  const out = new Set();
  for (const a of loadAll(cfg, nowMs, false, home)) for (const id of a.dump.shells) out.add(id);
  return out;
}

/**
 * id сессии → каталог проекта-владельца (`projectCwd` дампа) из всех
 * источников; удалённый перебивает на том же id. Из того же кэша, что индекс
 * заголовков, — лишнего чтения дампа нет.
 */
function loadProjectOwnersFor(cfg, nowMs = Date.now(), home = os.homedir()) {
  return mergeField(loadAll(cfg, nowMs, false, home), 'owners');
}

export { indexSessions, indexBackgroundAgents, indexShellSessions, indexProjectOwners, compareSessions } from './sessions-helpers.js';
export { mergeIndexes } from './sessions-helpers.js';
export {
  loadSessionIndex, loadBackgroundAgents, loadShellSessions, invalidateSessionIndex,
  localDumpPath, sessionDumps, loadSessionIndexFor, loadBackgroundAgentsFor, loadShellSessionsFor,
  loadProjectOwnersFor, loadSessionIndexAndOwnersFor,
};
