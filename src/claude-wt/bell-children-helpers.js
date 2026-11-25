/**
 * Звонок WezTerm в режиме `no children`: какие окна молчат. Чистые функции.
 *
 * Режим ставит кнопка ccfzf-picker флагами в профиле (`USERPROFILE`, у lua —
 * `wezterm.home_dir`): `.wezterm-bell-off` — молчат все, иначе
 * `.wezterm-bell-children-off` — молчат дети, иначе звенят все. Какое окно
 * дочернее, обработчик `bell` в wezterm.lua сам не знает — ему пишет список
 * служба (src/mqtt/bell-children.js) в файл `.wezterm-bell-children` рядом с
 * флагами:
 *
 *   # wezterm-bell-children <unix-секунды>
 *   <ключ заголовка окна ребёнка>
 *   …
 *
 * Ключ — заголовок окна по правилу `bellTitleKey`, одному на js и lua. Правило
 * своё, не `stripTitleDecoration`: у Lua нет `\p{S}` и Unicode-`\s`, поэтому
 * глифы заданы явной таблицей кодовых точек (`GLYPH_RANGES`, та же таблица
 * `BELL_GLYPHS` в wezterm.lua), а пробелы — ASCII, как `%s` в Lua. Сторож
 * правила — общие фикстуры wezterm/bell-title-cases.json.
 *
 * Время в заголовке — срок годности (у Lua нет mtime): служба лежит, список
 * застыл — через `BELL_CHILDREN_TTL_S` wezterm.lua его не верит и звенят все.
 * Отсюда и сердцебиение записи: файл переписывается при смене списка и не реже
 * раза в `BELL_HEARTBEAT_MS`.
 */
const BELL_FLAG_OFF = '.wezterm-bell-off';
const BELL_FLAG_CHILDREN_OFF = '.wezterm-bell-children-off';
const BELL_CHILDREN_FILE = '.wezterm-bell-children';
const BELL_HEADER = '# wezterm-bell-children';
/** Сколько wezterm.lua верит списку (то же число стоит в lua). */
const BELL_CHILDREN_TTL_S = 300;
const BELL_HEARTBEAT_MS = 60_000;
/**
 * Свежая запись местного реестра детей: ей верится, пока каталог детей не
 * доехал по SMB и демон не привязал окно. Дольше запись не берётся вовсе:
 * hwnd Windows переиспользует, а ребёнка могли снять (`head adopt` убирает
 * файл из каталога) — реестр же живёт неделю. Дальше источник один — каталог.
 */
const REGISTRY_HWND_TTL_MS = 10 * 60_000;

/**
 * Глифы статуса в начале заголовка, [от, до] включительно: средняя точка
 * спиннера Claude Code, стрелки…символы и стрелки (✳ ✻ и рамки), шрифт Брайля
 * (спиннер ⠂ ⠐ — внутри того же диапазона), эмодзи.
 */
const GLYPH_RANGES = [
  [0x00B7, 0x00B7],
  [0x2190, 0x2BFF],
  [0x1F000, 0x1FAFF],
];

// Пробелы — ASCII, ровно `%s` Lua: String.prototype.trim() шире.
const WS = '\t\n\v\f\r ';
const TRIM = /^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g;
// Приставки WezTerm по умолчанию (format-window-title): «[Z] » и «[i/n] ».
const WEZ_ZOOM = /^\[Z\] /;
const WEZ_INDEX = /^\[\d+\/\d+\] /;
// Приставка zellij «<сессия> | »: одно слово без пробелов.
const ZELLIJ = /^[^\t\n\v\f\r |]+ \| /;

const isGlyph = cp => GLYPH_RANGES.some(([a, b]) => cp >= a && cp <= b);

/** Ключ заголовка окна: без приставок WezTerm, zellij и глифа Claude Code. */
function bellTitleKey(title) {
  if (typeof title !== 'string') return '';
  let s = title.replace(TRIM, '').replace(WEZ_ZOOM, '').replace(WEZ_INDEX, '').replace(ZELLIJ, '');
  let i = 0;
  for (const ch of s) {
    if (!isGlyph(ch.codePointAt(0))) break;
    i += ch.length;
  }
  if (i > 0) {
    let j = i;
    while (j < s.length && WS.includes(s[j])) j += 1;
    if (j > i) s = s.slice(j);
  }
  return s.replace(TRIM, '');
}

const isRegistryEntry = e => e && typeof e === 'object'
  && typeof e.sessionId === 'string' && e.sessionId
  && typeof e.headId === 'string' && e.headId
  && Number.isInteger(e.windowId) && Number.isFinite(e.at);

const freshEntry = (e, nowMs) => isRegistryEntry(e) && nowMs - e.at <= REGISTRY_HWND_TTL_MS;

/** Дети этой машины по sessionId: каталог `children` на стороне ssh и свежие записи местного реестра. */
function childSessionIds(childrenDirIds, registry, nowMs) {
  const out = new Set(childrenDirIds ?? []);
  for (const e of Array.isArray(registry) ? registry : []) if (freshEntry(e, nowMs)) out.add(e.sessionId);
  return out;
}

/**
 * Ключи окон дочерних сессий. `windows` — окна терминалов с сырым заголовком
 * [{id, title}] (lua сверяет сырой `pane:get_title()`); `sessions` — привязка
 * окна к сессии [{id, sessionId}]; `children` — sessionId детей; `registry` —
 * местный реестр детей (свежий ребёнок — по hwnd, до привязки).
 *
 * Ключ попадает в список, только если все окна с этим ключом — дети: тёзка-head
 * или окно без привязки иначе замолчали бы вместе с ребёнком.
 */
function bellChildKeys({ windows, sessions, children, registry, now }) {
  const sessionOf = new Map();
  for (const s of sessions ?? []) if (s?.sessionId && !sessionOf.has(s.id)) sessionOf.set(s.id, s.sessionId);
  for (const e of Array.isArray(registry) ? registry : []) {
    if (freshEntry(e, now) && !sessionOf.has(e.windowId)) sessionOf.set(e.windowId, e.sessionId);
  }
  const kids = childSessionIds(children, registry, now);
  const child = new Set();
  const other = new Set();
  for (const w of windows ?? []) {
    const key = bellTitleKey(w?.title);
    if (!key) continue;
    const sid = sessionOf.get(w.id);
    (sid && kids.has(sid) ? child : other).add(key);
  }
  return [...child].filter(k => !other.has(k)).sort();
}

/** Текст файла списка. */
function bellChildrenText(keys, nowSec) {
  return [`${BELL_HEADER} ${nowSec}`, ...keys].join('\n') + '\n';
}

/**
 * Каталог детей head: `~/.ccfzf/children/<sessionId>.json` на стороне ssh, с
 * Windows — рядом с sessionsFile (`V:/.ccfzf.sessions.json` → `V:/.ccfzf/children`),
 * как каталог меток head.
 */
function childrenDirFor(cfg) {
  const file = cfg?.sessionsFile ?? '';
  const slash = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  if (slash < 0) return '';
  return `${file.slice(0, slash)}/.ccfzf/children`;
}

export {
  BELL_FLAG_OFF, BELL_FLAG_CHILDREN_OFF, BELL_CHILDREN_FILE, BELL_HEADER, BELL_CHILDREN_TTL_S, BELL_HEARTBEAT_MS,
  REGISTRY_HWND_TTL_MS, GLYPH_RANGES, bellTitleKey, childSessionIds, bellChildKeys, bellChildrenText, childrenDirFor,
};
