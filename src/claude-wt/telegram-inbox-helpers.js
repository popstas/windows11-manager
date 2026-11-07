/**
 * Входящие из Telegram: чистая часть наблюдателя. Без I/O.
 *
 * Цепочка целиком: telegram-resender на pc-virt кладёт файл на каждую
 * пересылку в `files/incoming-telegram/` vault'а, syncthing довозит его сюда,
 * наблюдатель (`src/mqtt/telegram-inbox.js`) видит новый файл и открывает окно
 * терминала с сессией `tg-<имя>` (или по шаблону `sessionName`) — тем же путём, что проектный хоткей, только
 * без поиска уже открытого окна: каждая пересылка — своя сессия и своё окно.
 */

const STATE_VERSION = 1;

// Символы, которые не доживут до удалённого шелла. `;` — разделитель команд
// для Windows Terminal, кавычки ломаются по дороге wt → ssh (см. правило про
// позиционные аргументы в launchNew), `$` и обратная кавычка раскрылись бы на
// той стороне, `\` Windows разбирает в командной строке по-своему.
// Управляющие символы — отдельной проверкой: в регулярке их не любит линтер.
const UNSAFE_NAME = /[;"'`$\\]/;
const hasControlChar = n => [...n].some(ch => ch.charCodeAt(0) < 0x20);

/**
 * Почему файл не открывается — или `null`, если открывается.
 *
 * Смотрится только имя в корне каталога: подкаталоги (`processed/`) сюда не
 * попадают вовсе, их отсекает зовущий по `isFile`.
 */
function inboxSkipReason(name) {
  const n = typeof name === 'string' ? name : '';
  if (!n) return 'empty name';
  // `.syncthing.<имя>.tmp` начинается с точки и отсекается здесь же.
  if (n.startsWith('.')) return 'hidden or syncthing temp file';
  if (n.startsWith('~syncthing~')) return 'syncthing temp file';
  if (n.includes('.sync-conflict-')) return 'syncthing conflict copy';
  if (!/\.md$/i.test(n)) return 'not a .md file';
  if (UNSAFE_NAME.test(n) || hasControlChar(n)) return 'name has characters the launch command cannot carry';
  return null;
}

/**
 * Временный файл syncthing: появляется на каждую доставку и тут же
 * переименовывается в настоящий. Пропускается молча — строка «skip» на каждую
 * пересылку была бы шумом, а не сведением.
 */
function isSyncthingTemp(name) {
  const n = typeof name === 'string' ? name : '';
  return n.startsWith('~syncthing~') || /^\.syncthing\..*\.tmp$/.test(n);
}

const DEFAULT_SESSION_NAME = 'tg-{base}';

// Имя файла от telegram-resender: `2026-11-06_06-04-22_Olgazdez_424254.md`.
// `_` в имени пользователя Telegram разрешён, поэтому id — последний числовой
// кусок, а пользователь — всё между временем и им.
const INBOX_FILE_NAME = /^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})_(.+)_(\d+)\.md$/i;
const PARSED_KEYS = ['date', 'time', 'user', 'id'];

/** `<date>_<time>_<user>_<id>.md` → части имени; другой формат — `null`. */
function parseInboxFileName(name) {
  const m = INBOX_FILE_NAME.exec(String(name ?? ''));
  if (!m) return null;
  const [, date, time, user, id] = m;
  return { base: String(name).replace(/\.md$/i, ''), date, time, user, id };
}

/**
 * Имя сессии по шаблону `claudeWt.telegramInbox.sessionName`.
 *
 * Подстановки: `{base}` (имя без `.md`) у любого файла, `{date}`, `{time}`,
 * `{user}`, `{id}` — у файла формата `<date>_<time>_<user>_<id>.md`.
 * Незнакомая подстановка остаётся как есть. Не вышло — `tg-{base}` и
 * `warning` для журнала: файл всё равно должен открыться.
 */
function inboxSessionName(file, template = DEFAULT_SESSION_NAME) {
  const base = String(file).replace(/\.md$/i, '');
  const fallback = `tg-${base}`;
  const tpl = template || DEFAULT_SESSION_NAME;
  const parsed = parseInboxFileName(file);
  if (!parsed && PARSED_KEYS.some(k => tpl.includes(`{${k}}`))) {
    return { name: fallback, warning: `name does not match <date>_<time>_<user>_<id>.md, session named ${fallback}` };
  }
  const vars = { base, ...parsed };
  const name = tpl.replace(/\{(base|date|time|user|id)\}/g, (_, k) => vars[k]).trim();
  if (!name || UNSAFE_NAME.test(name) || hasControlChar(name)) {
    return { name: fallback, warning: `sessionName '${tpl}' gives a name the launch command cannot carry, session named ${fallback}` };
  }
  return { name, warning: null };
}

/**
 * Повтор имени — с номером: `a`, `a-2`, `a-3`. Окно ищется по заголовку, а
 * заголовок — имя сессии: два окна с одним именем путают фокус.
 */
function uniqueSessionName(name, used = new Set()) {
  if (!used.has(name)) return name;
  let n = 2;
  while (used.has(`${name}-${n}`)) n += 1;
  return `${name}-${n}`;
}

/** Выданные имена сессий — только у файлов, которые ещё помнятся. */
function keepSessionsOf(sessions = {}, processed = {}) {
  const out = {};
  for (const [file, name] of Object.entries(sessions ?? {})) {
    if (Object.hasOwn(processed, file) && typeof name === 'string') out[file] = name;
  }
  return out;
}

/** Путь файла относительно `cwd` той стороны: `files/incoming-telegram/<имя>.md`. */
function inboxRemoteFile(fileDir, name) {
  const dir = String(fileDir ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return dir ? `${dir}/${name}` : String(name);
}

const positive = (v, fallback) => (Number.isFinite(v) && v >= 0 ? v : fallback);

/**
 * Блок `claudeWt.telegramInbox` после умолчаний — с проверкой, хватает ли его
 * для запуска. `problem` — строка для журнала, `null` — можно работать.
 */
function normalizeInboxConfig(raw = {}, { statePath = '' } = {}) {
  const str = v => (typeof v === 'string' ? v.trim() : '');
  const cfg = {
    enabled: raw.enabled === true,
    dir: str(raw.dir),
    cwd: str(raw.cwd),
    script: str(raw.script),
    fileDir: str(raw.fileDir),
    terminal: str(raw.terminal),
    sessionName: str(raw.sessionName) || DEFAULT_SESSION_NAME,
    statePath: str(raw.statePath) || inboxStatePathNextTo(statePath),
    pollMs: Math.max(250, positive(raw.pollMs, 3000)),
    settleMs: positive(raw.settleMs, 2000),
    gapMs: positive(raw.gapMs, 3000),
  };
  let problem = null;
  if (!cfg.dir) problem = 'claudeWt.telegramInbox.dir is not set';
  else if (!cfg.cwd) problem = 'claudeWt.telegramInbox.cwd is not set';
  else if (!cfg.script) problem = 'claudeWt.telegramInbox.script is not set';
  else if (!cfg.statePath) problem = 'neither claudeWt.telegramInbox.statePath nor claudeWt.statePath is set';
  return { cfg, problem };
}

/** Файл состояния рядом с `claudeWt.statePath` — как у `no-autoplace.js`. */
function inboxStatePathNextTo(statePath) {
  const p = typeof statePath === 'string' ? statePath.trim() : '';
  if (!p) return '';
  const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return cut < 0 ? 'telegram-inbox.json' : `${p.slice(0, cut + 1)}telegram-inbox.json`;
}

/**
 * Один проход по каталогу.
 *
 * `entries` — файлы корня: `{ name, isFile, size, mtimeMs }`. Файл годен к
 * открытию, когда его размер и mtime не менялись `settleMs` — аналог
 * awaitWriteFinish: syncthing пишет во временный файл и переименовывает, но
 * полагаться на это нечего, а цена ожидания — пара секунд.
 *
 * `processed` — имя → когда открыт; `busy` — имена, уже стоящие в очереди;
 * `reported` — кому уже написали «пропущен», чтобы строка не повторялась на
 * каждом проходе. Ответ — новые `seen` и `reported`, исходные не трогаются.
 */
function planInboxTick({ entries = [], now, seen = new Map(), processed = {}, busy = new Set(), reported = new Set(), settleMs = 2000 }) {
  const nextSeen = new Map();
  const nextReported = new Set();
  const ready = [];
  const skipped = [];
  const present = new Set();
  for (const e of entries) {
    if (!e || !e.isFile || isSyncthingTemp(e.name)) continue;
    present.add(e.name);
    const reason = inboxSkipReason(e.name)
      ?? (Object.hasOwn(processed, e.name) ? 'already opened' : null);
    if (reason) {
      nextReported.add(e.name);
      if (!reported.has(e.name)) skipped.push({ name: e.name, reason });
      continue;
    }
    if (busy.has(e.name)) continue;
    const prev = seen.get(e.name);
    const same = prev && prev.size === e.size && prev.mtimeMs === e.mtimeMs;
    const since = same ? prev.since : now;
    nextSeen.set(e.name, { size: e.size, mtimeMs: e.mtimeMs, since });
    if (same && now - since >= settleMs) ready.push(e.name);
  }
  // `nextReported` собран только из лежащих сейчас файлов: пропавший забывает
  // и отметку «уже сказали» — появись он снова, скажем снова.
  ready.sort();
  return { ready, skipped, seen: nextSeen, reported: nextReported, present };
}

// Отметка об открытом файле живёт после его исчезновения ещё сутки: каталог,
// прочитанный пустым по ошибке, не должен стереть память и открыть всё заново.
const PROCESSED_KEEP_MS = 24 * 60 * 60 * 1000;

/** Забыть открытые файлы, которых давно нет в каталоге: скрипт унёс их в processed/. */
function pruneProcessed(processed = {}, present = new Set(), now, keepMs = PROCESSED_KEEP_MS) {
  const out = {};
  for (const [name, at] of Object.entries(processed)) {
    if (present.has(name) || !(now - at > keepMs)) out[name] = at;
  }
  return out;
}

/**
 * Разбор файла состояния; битый или чужой — пустая память, а не отказ.
 * `sessions` (файл → выданное имя сессии) появился позже `processed`: у
 * старого файла его нет, и это не повод забыть открытые.
 */
function parseInboxState(text) {
  try {
    const data = JSON.parse(text);
    const processed = {};
    if (data && typeof data.processed === 'object' && data.processed) {
      for (const [name, at] of Object.entries(data.processed)) {
        if (Number.isFinite(at)) processed[name] = at;
      }
    }
    const raw = data && typeof data.sessions === 'object' && data.sessions ? data.sessions : {};
    return { processed, sessions: keepSessionsOf(raw, processed) };
  } catch {
    return { processed: {}, sessions: {} };
  }
}

function serializeInboxState({ processed = {}, sessions = {} } = {}) {
  return `${JSON.stringify({ version: STATE_VERSION, processed, sessions }, null, 2)}\n`;
}

export {
  inboxSkipReason,
  isSyncthingTemp,
  inboxSessionName,
  parseInboxFileName,
  uniqueSessionName,
  keepSessionsOf,
  inboxRemoteFile,
  normalizeInboxConfig,
  inboxStatePathNextTo,
  planInboxTick,
  pruneProcessed,
  parseInboxState,
  serializeInboxState,
  PROCESSED_KEEP_MS,
};
