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

/** Старый конфиг: терминал ещё лежит внутри `launch`, реестр не действует. */
function isLegacyLaunch(cfg = {}) {
  return Boolean(cfg.launch && typeof cfg.launch.command === 'string' && cfg.launch.command.trim());
}

export { TERMINAL_DEFAULTS, normalizeTerminals, resolveTerminal, isLegacyLaunch };
