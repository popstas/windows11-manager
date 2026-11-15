/**
 * Чтение и запись скалярных полей вкладки Claude в живом YAML-конфиге.
 *
 * Окно настроек трея правит `tauri-plugin-store`, а эти поля живут в YAML
 * node-части — трей YAML не разбирает вовсе. Поэтому и чтение, и запись идут
 * через node-команду `claude-wt config`, которую Rust зовёт тем же способом,
 * что и соседнюю `claude-wt tile-zones`.
 *
 * Читается **фактический файл**, а не слитая с умолчаниями конфигурация:
 * `getConfig()` умолчаний не подмешивает (см. `src/config.js`), поэтому
 * незаданный ключ приезжает в форму как `null` и показывается плейсхолдером.
 * Иначе первое же сохранение материализовало бы в конфиг десяток умолчаний,
 * которых человек туда не писал, — и молча зафиксировало бы их, перестав
 * следовать за правкой умолчания в коде.
 *
 * Запись применяет **только пришедшие ключи**, по одному, поверх
 * накапливающегося текста, и каждая правка сама себя проверяет
 * (`patchConfigScalar` → `verifyPatch`). Файл читается один раз и пишется один
 * раз: промежуточные состояния на диск не попадают.
 */
import fs from 'node:fs';
import { parse } from 'yaml';
import path from 'node:path';
import { getConfig, resolveConfigPath } from '../config.js';
import { CLAUDE_CONFIG_FIELDS, coerceFieldValue } from './claude-config-fields.js';
import { patchConfigScalar } from './config-scalar-patch.js';
import { writeFileAtomic } from './write-file-atomic.js';
import { fileURLToPath } from 'node:url';
import { mergeClaudeWtConfig } from '../claude-wt/daemon-helpers.js';
import { normalizeTerminals } from '../claude-wt/terminal-helpers.js';
import { profileForTerminal } from '../claude-wt/project-helpers.js';
import { BUILTIN_HEAD_ICON } from '../claude-wt/window-icons-helpers.js';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]+$/, '');

/**
 * Текущие значения полей вкладки: `{ 'claudeWt.interval': 1000, ... }`.
 * Незаданное — `null`, а не умолчание (см. шапку).
 */
function readClaudeConfig() {
  const config = getConfig();
  const out = {};
  for (const field of CLAUDE_CONFIG_FIELDS) {
    const value = [...field.section.split('.'), field.key].reduce((node, k) => node?.[k], config);
    out[field.name] = value === undefined ? null : value;
  }
  return { ...out, ...formExtras(config) };
}

/**
 * Что форме нужно сверх полей. Ключи с `_` — не поля: записью они не
 * принимаются, форма только читает.
 *
 * `_projects` — проекты из конфига как есть, по порядку (индекс — адрес
 * записи в YAML) со своей иконкой и иконкой профиля для плейсхолдера.
 * `_terminalChoices` — имена реестра терминалов: встроенные и свои.
 */
function formExtras(config) {
  const rawProjects = Array.isArray(config?.claudeWt?.projects) ? config.claudeWt.projects : [];
  const cfg = mergeClaudeWtConfig(config?.claudeWt);
  const projects = rawProjects.map((p, index) => {
    const cwd = typeof p?.cwd === 'string' ? p.cwd : '';
    const profile = profileForTerminal(cwd, 'wt', cfg);
    return {
      index,
      name: typeof p?.name === 'string' ? p.name : '',
      cwd,
      profile,
      icon: typeof p?.icon === 'string' ? p.icon : '',
      profileIcon: (profile && cfg.windowIcons.profiles[profile]) || '',
    };
  });
  return {
    _projects: projects,
    _terminalChoices: Object.keys(normalizeTerminals(config?.claudeWt?.terminals)),
    _defaultHeadIcon: BUILTIN_HEAD_ICON,
    _repoRoot: REPO_ROOT,
  };
}

/**
 * Иконки проектов: `{ "<cwd>": "<путь>" | null }` → правка `icon` у записи
 * проекта с этим cwd. Запись ищется в уже накопленном тексте, по индексу в
 * списке: тот же адрес, по которому патчер правит ключ.
 */
function patchProjectIcons(text, icons) {
  if (!icons || typeof icons !== 'object' || Array.isArray(icons)) {
    throw new Error('projectIcons: ожидается объект {"<cwd>": "<путь>" | null}');
  }
  let out = text;
  for (const [cwd, raw] of Object.entries(icons)) {
    const value = raw === null || raw === undefined || !String(raw).trim() ? undefined : String(raw).trim();
    if (value !== undefined && /\r|\n/.test(value)) throw new Error(`projectIcons: перевод строки в пути для ${cwd}`);
    const projects = parse(out, { merge: true })?.claudeWt?.projects;
    const index = Array.isArray(projects) ? projects.findIndex((p) => p?.cwd === cwd) : -1;
    if (index < 0) throw new Error(`projectIcons: проекта с cwd ${cwd} в claudeWt.projects нет; файл не тронут`);
    out = patchConfigScalar(out, `claudeWt.projects.${index}`, 'icon', value);
  }
  return out;
}

/**
 * Записать пришедшие поля в YAML-конфиг, не трогая остального его содержимого —
 * байт в байт за пределами самих правящихся значений.
 *
 * `patch` — объект `{ 'claudeWt.interval': 1000, 'claudeWt.profile': null }`;
 * `null` значит «убрать ключ, вернуть умолчание». Возвращает список изменённых
 * имён — его печатает CLI, чтобы в журнале трея было видно, что именно ушло в
 * конфиг.
 */
function writeClaudeConfig(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('ожидается объект вида {"claudeWt.interval": 1000}');
  }

  const names = Object.keys(patch);
  if (!names.length) return [];

  // Разбор и проверка ВСЕХ полей до первой правки текста: половина
  // сохранённых полей и отказ на середине — худший исход, чем отказ целиком.
  const changes = names.filter((name) => name !== 'projectIcons').map((name) => {
    const field = CLAUDE_CONFIG_FIELDS.find((f) => f.name === name);
    if (!field) throw new Error(`неизвестное поле конфига: ${name}`);
    return { field, value: coerceFieldValue(name, patch[name]) };
  });

  const filePath = resolveConfigPath();
  if (!filePath) throw new Error('конфиг не найден ни в одном из мест поиска');

  let text = fs.readFileSync(filePath, 'utf8');
  for (const { field, value } of changes) {
    text = patchConfigScalar(text, field.section, field.key, value, { createSection: Boolean(field.createSection) });
  }
  if ('projectIcons' in patch) text = patchProjectIcons(text, patch.projectIcons);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileAtomic(filePath, text);

  return names;
}

export { readClaudeConfig, writeClaudeConfig, patchProjectIcons };
