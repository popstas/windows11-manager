/** Реестр терминалов: имя → чем и как открывать. Без I/O. */

/**
 * Встроенные терминалы Windows.
 *
 * `args` — то, что стоит между исполняемым и хвостом из `launch.args`:
 * у Windows Terminal это «в текущее окно», у WezTerm — подкоманда `start` и
 * `--`, без которого его разбор принял бы `ssh` за свою подкоманду.
 * `profileArgs` есть только у того, у кого профили вообще бывают.
 */
const TERMINAL_DEFAULTS = {
  wt: { command: 'wt.exe', args: ['-w', '-1'], profileArgs: ['-p', '{profile}'] },
  wezterm: { command: 'wezterm-gui.exe', args: ['start', '--'] },
};

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const command = typeof raw.command === 'string' ? raw.command.trim() : '';
  if (!command) return null;
  const entry = { command, args: Array.isArray(raw.args) ? raw.args.map(String) : [] };
  if (Array.isArray(raw.profileArgs)) entry.profileArgs = raw.profileArgs.map(String);
  return entry;
}

/**
 * Слить пользовательский реестр со встроенным.
 *
 * Перекрытие идёт записью целиком, а не поключево: `args` у терминала —
 * связный набор, и слияние по ключам дало бы полузаписи вроде «команда
 * WezTerm с аргументами wt».
 */
function normalizeTerminals(raw) {
  const out = { ...TERMINAL_DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  for (const [name, value] of Object.entries(raw)) {
    const entry = normalizeEntry(value);
    if (entry) out[name] = entry;
  }
  return out;
}

/**
 * Какой терминал открывать.
 *
 * `fallback: true` значит «просили не то, что мы умеем» — про это надо сказать
 * в лог: молчаливый чужой терминал выглядит как проигнорированная настройка.
 * Пустое имя откатом не считается: пикер его не назвал, и дефолт машины — это
 * ответ, а не подмена.
 */
function resolveTerminal(asked, cfg = {}) {
  const terminals = normalizeTerminals(cfg.terminals);
  const wanted = typeof asked === 'string' ? asked.trim() : '';
  if (wanted && terminals[wanted]) return { name: wanted, entry: terminals[wanted], fallback: false };
  const preferred = typeof cfg.terminal === 'string' ? cfg.terminal.trim() : '';
  if (terminals[preferred]) return { name: preferred, entry: terminals[preferred], fallback: Boolean(wanted) };
  const [name, entry] = Object.entries(terminals)[0] ?? [];
  return { name: name ?? '', entry: entry ?? null, fallback: true };
}

/**
 * Старый конфиг: терминал ещё лежит внутри блока запуска, реестр для него не
 * действует.
 *
 * `block` называет, какой блок сейчас собирается («launch» у restore,
 * «launchNew» у project) — судить надо по нему, а не всегда по `launch`:
 * полумигрированный конфиг может держать старую форму в одном блоке и новую
 * в другом, и то, что решил один блок, второго не касается. Без имени блока
 * поведение прежнее — вызовы, ещё не знающие о развилке, не должны сломаться.
 */
function isLegacyLaunch(cfg = {}, block) {
  const target = cfg[block ?? 'launch'];
  return Boolean(target && typeof target.command === 'string' && target.command.trim());
}

/**
 * Разрешить терминал и сразу решить, что сказать об этом в лог — если есть
 * что сказать. Сама не пишет: помощник в I/O не ходит, строку печатает
 * зовущий тем же способом, каким печатает соседние строки.
 *
 * `launchBlock` — тот же блок, что и у `isLegacyLaunch`: старость судится по
 * тому шаблону, который зовущий сейчас собирает.
 */
function chooseTerminal(asked, cfg = {}, launchBlock) {
  const wanted = typeof asked === 'string' ? asked.trim() : '';
  if (isLegacyLaunch(cfg, launchBlock)) {
    const message = wanted
      ? `[claude-wt] claudeWt.${launchBlock}.command is set: config is legacy, terminal choice is ignored`
      : null;
    return { chosen: { name: 'wt', entry: null, fallback: false }, message };
  }
  const chosen = resolveTerminal(asked, cfg);
  const message = chosen.fallback && wanted
    ? `[claude-wt] terminal ${wanted} is not in claudeWt.terminals, using ${chosen.name}`
    : null;
  return { chosen, message };
}

export { TERMINAL_DEFAULTS, normalizeTerminals, resolveTerminal, isLegacyLaunch, chooseTerminal };
