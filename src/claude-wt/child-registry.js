/**
 * Реестр детей head на этой машине: sessionId → headId, hwnd окна, стол.
 *
 * Пишет его `session-new` в тот момент, когда окно ребёнка встало на место:
 * `sessionId` и `headId` пришли в просьбе, hwnd найден в хвосте. Читает он же,
 * на следующем ребёнке того же head, — чтобы знать, сколько детей уже стоит в
 * зоне (`k` правила стопки).
 *
 * Почему не `~/.ccfzf/children` на pc-virt, где связь head и ребёнка тоже
 * лежит: тот каталог виден отсюда только по SMB, и брат, открытый секунду
 * назад, там может быть ещё не виден, а демон может ещё не привязать его окно
 * к сессии. Местный файл пишется синхронно и до следующего ребёнка. Цена
 * одна: дети, открытые до появления реестра, в `k` не считаются.
 *
 * Лежит рядом с состоянием claude-wt, как `no-autoplace.json`: тот же каталог
 * и так переписывается, нового требования к установке нет. `statePath` не
 * задан — реестра нет, и каждый ребёнок считается первым.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../config.js';

/** Неделя: дольше сессия-ребёнок не живёт, а hwnd Windows переиспользует. */
const CHILD_TTL_MS = 7 * 24 * 3600 * 1000;

const FILE_NAME = 'claude-wt-children.json';

const isEntry = e => e && typeof e === 'object'
  && typeof e.sessionId === 'string' && e.sessionId
  && typeof e.headId === 'string' && e.headId
  && Number.isInteger(e.windowId) && Number.isFinite(e.at);

const alive = (e, nowMs) => isEntry(e) && nowMs - e.at <= CHILD_TTL_MS;

/** Добавить или заменить запись ребёнка, заодно выбросив протухшие. */
function upsertChild(entries, entry, nowMs) {
  const kept = (Array.isArray(entries) ? entries : [])
    .filter(e => alive(e, nowMs) && e.sessionId !== entry.sessionId);
  return [...kept, { ...entry, at: nowMs }];
}

/** Живые дети этого head. */
function childrenOfHead(entries, headId, nowMs) {
  return (Array.isArray(entries) ? entries : []).filter(e => alive(e, nowMs) && e.headId === headId);
}

function childrenPath() {
  const statePath = getConfig()?.claudeWt?.statePath;
  if (typeof statePath !== 'string' || !statePath.trim()) return '';
  return path.join(path.dirname(statePath), FILE_NAME);
}

/** Весь реестр. Любой отказ — пусто: каждый ребёнок тогда первый, и только. */
function readChildren() {
  const file = childrenPath();
  if (!file) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/**
 * Записать ребёнка. Отказ — строка в журнал: окно уже стоит, а потеря записи
 * стоит одного неверного `k` у следующего брата.
 */
function recordChild(entry, { now = Date.now() } = {}) {
  const file = childrenPath();
  if (!file || !Number.isInteger(entry?.windowId)) return false;
  try {
    const next = upsertChild(readChildren(), entry, now);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next));
    return true;
  } catch (e) {
    console.error(`[claude-wt] cannot record child ${entry.sessionId}: ${e.message}`);
    return false;
  }
}

export { CHILD_TTL_MS, upsertChild, childrenOfHead, childrenPath, readChildren, recordChild };
