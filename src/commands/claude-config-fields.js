/**
 * Какие поля YAML-конфига показывает и правит вкладка Claude в окне настроек.
 *
 * Список один на обе стороны просьбы: `claude-wt config get` отдаёт ровно эти
 * ключи, `set` ровно эти же принимает и всё остальное отвергает. Форма (HTML)
 * знает их по тем же именам — на её стороне список повторён разметкой, и
 * разъехаться списки не могут молча: неизвестный ключ на записи — отказ с
 * именем ключа, а не тихо проигнорированное поле.
 *
 * Сюда попали только скаляры. Структуры под `claudeWt` (`projects`,
 * `terminals`, `terminalExecutables`, `launch`, `launchNew`, `restore`,
 * `snapshots`) формой не выражаются без отдельного редактора и остаются в
 * YAML; `tileZones` — список пар, у него своё поле и свой патчер
 * (`tile-zones-commands.js`).
 *
 * Умолчания продублированы здесь не как источник правды, а как подпись поля:
 * работают они в `CLAUDE_WT_DEFAULTS` (`src/claude-wt/daemon-helpers.js`) и в
 * `createHaExport` (`src/claude-wt/ha/export.js`), а форма показывает их
 * плейсхолдером пустого поля. Тест сверяет обе стороны, чтобы подпись не
 * начала врать после правки умолчания.
 */

/** Порядок сортировки слотов панели — тот же список, что у `normalizeSort`. */
const SESSIONS_SORT_MODES = ['cost', 'oldest', 'newest', 'recent', 'name'];

const CLAUDE_CONFIG_FIELDS = [
  // Демон
  { name: 'claudeWt.enabled', section: 'claudeWt', key: 'enabled', type: 'boolean', default: true },
  { name: 'claudeWt.interval', section: 'claudeWt', key: 'interval', type: 'number', default: 1000 },
  { name: 'claudeWt.stableTicks', section: 'claudeWt', key: 'stableTicks', type: 'number', default: 2 },
  { name: 'claudeWt.focusSettleMs', section: 'claudeWt', key: 'focusSettleMs', type: 'number', default: 0 },
  { name: 'claudeWt.desktop', section: 'claudeWt', key: 'desktop', type: 'boolean', default: true },
  { name: 'claudeWt.debug', section: 'claudeWt', key: 'debug', type: 'boolean', default: false },

  // Файлы и терминал
  { name: 'claudeWt.sessionsFile', section: 'claudeWt', key: 'sessionsFile', type: 'string', default: '' },
  { name: 'claudeWt.statePath', section: 'claudeWt', key: 'statePath', type: 'string', default: '' },
  { name: 'claudeWt.windowsFile', section: 'claudeWt', key: 'windowsFile', type: 'string', default: '' },
  { name: 'claudeWt.progressDir', section: 'claudeWt', key: 'progressDir', type: 'string', default: '' },
  { name: 'claudeWt.terminal', section: 'claudeWt', key: 'terminal', type: 'string', default: 'wt' },
  { name: 'claudeWt.profile', section: 'claudeWt', key: 'profile', type: 'string', default: '' },

  // Слоты сессий на панели openHASP. Живут в корневом `homeassistant`, но по
  // смыслу это настройки claude-wt — потому и стоят на этой вкладке.
  { name: 'homeassistant.slots', section: 'homeassistant', key: 'slots', type: 'number', default: 10 },
  { name: 'homeassistant.interval', section: 'homeassistant', key: 'interval', type: 'number', default: 15 },
  { name: 'homeassistant.openOnly', section: 'homeassistant', key: 'openOnly', type: 'boolean', default: true },
  {
    name: 'homeassistant.sessionsSort',
    section: 'homeassistant',
    key: 'sessionsSort',
    type: 'string',
    default: 'recent',
    choices: SESSIONS_SORT_MODES,
  },
];

const FIELDS_BY_NAME = new Map(CLAUDE_CONFIG_FIELDS.map((f) => [f.name, f]));

/**
 * Проверить и привести значение одного поля к тому, что уйдёт в YAML.
 *
 * `null` — «убрать ключ, вернуть умолчание»: пустое поле формы приезжает
 * именно так. Возвращается `undefined`, потому что этим патчер обозначает
 * удаление.
 *
 * Числа приезжают из формы строкой — приводятся здесь, и мусор («12abc»,
 * дробное там, где считаются тики) отвергается с именем поля: молча записанный
 * NaN сломал бы демон на следующем запуске, а причину пришлось бы искать в
 * конфиге глазами.
 */
function coerceFieldValue(name, raw) {
  const field = FIELDS_BY_NAME.get(name);
  if (!field) throw new Error(`неизвестное поле конфига: ${name}`);
  if (raw === null || raw === undefined) return undefined;

  if (field.type === 'boolean') {
    if (typeof raw !== 'boolean') throw new Error(`${name}: ожидается true или false, пришло ${JSON.stringify(raw)}`);
    return raw;
  }

  if (field.type === 'number') {
    const text = String(raw).trim();
    if (!text) return undefined;
    if (!/^-?\d+$/.test(text)) {
      throw new Error(`${name}: ожидается целое число, пришло "${text}"`);
    }
    return Number(text);
  }

  const text = String(raw);
  if (/\r|\n/.test(text)) throw new Error(`${name}: перевод строки в значении не допускается`);
  // Пустая строка — это очищенное поле, то есть просьба вернуть умолчание, а
  // не записать «» в конфиг (см. шапку config-scalar-patch.js).
  if (!text.trim()) return undefined;
  if (field.choices && !field.choices.includes(text.trim())) {
    throw new Error(`${name}: ожидается одно из ${field.choices.join(' | ')}, пришло "${text.trim()}"`);
  }
  return text.trim();
}

export { CLAUDE_CONFIG_FIELDS, FIELDS_BY_NAME, SESSIONS_SORT_MODES, coerceFieldValue };
