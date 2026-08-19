/**
 * Окна, которые автоматике трогать нельзя.
 *
 * Повод один и пока единственный: пикер попросил открыть сессию на экране под
 * курсором (`cursor` в теле `claude-session-open`), окно там и встало — а
 * следом за него берутся двое, которые про эту просьбу не знают ничего.
 * Автопостановщик (`placeNewWindowIds` в `placement.js`) применяет правило из
 * `config.windows`, подобранное по заголовку или пути; демон `claude-wt watch`
 * при первой же привязке окна к знакомой сессии тащит его в **запомненные**
 * границы (`tracker-helpers.js`). Человек видит это так: окно появилось там,
 * куда он смотрит, и через секунду прыгнуло на соседний монитор, где эта
 * сессия жила вчера.
 *
 * **Файл, а не переменная в памяти, — потому что процессов два.** Просьбу
 * принимает служба MQTT, а демон живёт отдельным процессом (`node src claude-wt
 * watch`), и общей памяти у них нет. Канала между ними тоже нет: демон ничего
 * не слушает, он только пишет свои файлы.
 *
 * Лежит рядом с состоянием claude-wt: тот же каталог демон и так переписывает
 * каждый тик, то есть новых требований к установке пометка не добавляет.
 * `statePath` не задан — пометок нет вовсе, и обе стороны ведут себя как
 * раньше.
 *
 * **Срок годности обязателен.** Ключ здесь — hwnd, а Windows их переиспользует:
 * вечная запись однажды досталась бы чужому окну, и то перестало бы
 * расставляться без всякой причины. Минуты хватает с запасом: пометка нужна до
 * первой привязки демоном, а заголовок терминала устаивается за секунды.
 *
 * Протухшие записи выбрасываются на записи, а не по таймеру: писать сюда
 * приходится ровно тогда, когда открывают окно, и чистить чаще незачем.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from './config.js';

/** Минута — с запасом на то, чтобы демон успел привязать окно к сессии. */
const MARK_TTL_MS = 60_000;

const FILE_NAME = 'no-autoplace.json';

/**
 * Путь к файлу пометок — или пусто, когда claude-wt не настроен.
 *
 * Считается на каждый спрос, а не запоминается: конфиг перечитывается на ходу,
 * и запомненный путь пережил бы правку настроек — та же причина, по какой
 * `getClaudeWtConfig()` зовут на каждое обращение.
 */
function marksPath() {
  const statePath = getConfig()?.claudeWt?.statePath;
  if (typeof statePath !== 'string' || !statePath.trim()) return '';
  return path.join(path.dirname(statePath), FILE_NAME);
}

/**
 * Живые записи из прочитанного объекта.
 *
 * Чистая: весь разбор мусора здесь, а не у читателей. Файл переживает
 * перезагрузку и переписывается двумя процессами — нечисловой ключ, строка
 * вместо срока и обрезанный на полуслове JSON тут обычное дело, и ни один из
 * них не повод перестать расставлять окна.
 */
function liveMarks(raw, now) {
  if (!raw || typeof raw !== 'object') return {};
  const live = {};
  for (const [key, until] of Object.entries(raw)) {
    const id = Number(key);
    if (!Number.isInteger(id)) continue;
    if (!Number.isFinite(until) || until <= now) continue;
    live[id] = until;
  }
  return live;
}

/** Прочитать файл целиком. Любой отказ — пустота: молчащая пометка лучше упавшей расстановки. */
function readMarks(now = Date.now()) {
  const file = marksPath();
  if (!file) return {};
  try {
    return liveMarks(JSON.parse(fs.readFileSync(file, 'utf8')), now);
  } catch {
    return {};
  }
}

/**
 * Множество hwnd, которые автоматике трогать нельзя.
 *
 * Читателей двое, и оба зовут это раз в тик; чтения дешевле, чем канал между
 * процессами, а файл в несколько десятков байт.
 */
function noAutoplaceIds(now = Date.now()) {
  return new Set(Object.keys(readMarks(now)).map(Number));
}

/**
 * Пометить окно: этому автоматика не хозяйка.
 *
 * Отказ записи — строка в журнал и ничего больше: окно уже стоит там, где
 * просили, и всё, чем мы рискуем, — прыжок через секунду. Ронять из-за этого
 * открытие сессии незачем.
 */
function markNoAutoplace(windowId, { now = Date.now(), ttlMs = MARK_TTL_MS } = {}) {
  const file = marksPath();
  if (!file || !Number.isInteger(windowId)) return false;
  try {
    const marks = { ...readMarks(now), [windowId]: now + ttlMs };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(marks));
    return true;
  } catch (e) {
    console.error(`[claude-wt] cannot mark window ${windowId} as placed by hand: ${e.message}`);
    return false;
  }
}

export { MARK_TTL_MS, liveMarks, marksPath, noAutoplaceIds, markNoAutoplace };
