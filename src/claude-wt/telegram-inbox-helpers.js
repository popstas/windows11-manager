/**
 * Входящие из Telegram: чистая часть наблюдателя. Без I/O.
 *
 * Цепочка целиком: telegram-resender на pc-virt кладёт файл на каждую
 * пересылку в `files/incoming-telegram/` vault'а, syncthing довозит его сюда,
 * наблюдатель (`src/mqtt/telegram-inbox.js`) видит новый файл и открывает окно
 * терминала с сессией `tg-<имя>` — тем же путём, что проектный хоткей, только
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

/** `2026-11-05-123.md` → `tg-2026-11-05-123`. */
function inboxSessionName(name) {
  return `tg-${String(name).replace(/\.md$/i, '')}`;
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

/** Разбор файла состояния; битый или чужой — пустая память, а не отказ. */
function parseInboxState(text) {
  try {
    const data = JSON.parse(text);
    const processed = {};
    if (data && typeof data.processed === 'object' && data.processed) {
      for (const [name, at] of Object.entries(data.processed)) {
        if (Number.isFinite(at)) processed[name] = at;
      }
    }
    return { processed };
  } catch {
    return { processed: {} };
  }
}

function serializeInboxState({ processed = {} } = {}) {
  return `${JSON.stringify({ version: STATE_VERSION, processed }, null, 2)}\n`;
}

export {
  inboxSkipReason,
  isSyncthingTemp,
  inboxSessionName,
  inboxRemoteFile,
  normalizeInboxConfig,
  inboxStatePathNextTo,
  planInboxTick,
  pruneProcessed,
  parseInboxState,
  serializeInboxState,
  PROCESSED_KEEP_MS,
};
