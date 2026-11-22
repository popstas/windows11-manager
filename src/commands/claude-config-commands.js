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
import { profileForTerminal, normalizeProjectType, basenameOfCwd } from '../claude-wt/project-helpers.js';
import { UNSAFE, hasControlChar } from '../claude-wt/session-new-helpers.js';
import { appendSeqItem } from './config-list-append.js';
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
 * записи в YAML) со своей иконкой, иконкой профиля для плейсхолдера и типом
 * (только показ: тип ставит `claude-project-type`, а не форма).
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
      type: normalizeProjectType(p?.type),
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
 * Типы, которые записать нельзя: `untyped` — подпись секции пикера для
 * проектов без типа, `none` — пункт меню «снять тип» (`type: null`).
 */
const RESERVED_TYPES = ['untyped', 'none'];

const stripTrailingSlash = (v) => v.replace(/\/+$/, '');

/**
 * Разбор просьбы `claude-project-type`: `{ cwd, type }`, тело объектом или
 * JSON-строкой (MQTT). `type: null` или пустое — снять тип.
 *
 * `claudeWt.projects` — ещё и белый список `session-new` без авторизации, а
 * неизвестный cwd эта команда в него дописывает (решение Стаса, вариант C,
 * 22.11). Поэтому cwd проверяется теми же правилами, что у `session-new`:
 * абсолютный путь удалённой стороны (`/…`, не `path.isAbsolute` — код живёт на
 * Windows), без `UNSAFE` и управляющих символов, без `.`/`..` сегментов.
 */
function parseProjectTypeRequest(payload) {
  let body = payload;
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    try {
      body = JSON.parse(String(body));
    } catch {
      return { error: 'bad payload: expected JSON {cwd, type}' };
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'bad payload: expected {cwd, type}' };

  if (typeof body.cwd !== 'string') return { error: 'cwd is required' };
  const cwd = stripTrailingSlash(body.cwd.trim());
  if (!cwd.startsWith('/')) return { error: 'cwd must be an absolute path' };
  if (UNSAFE.test(cwd) || hasControlChar(cwd)) return { error: 'cwd contains unsafe characters' };
  if (cwd.split('/').some((seg) => seg === '.' || seg === '..')) return { error: 'cwd must not contain . or .. segments' };

  if (body.type !== null && body.type !== undefined && typeof body.type !== 'string') {
    return { error: 'type must be a string or null' };
  }
  const type = normalizeProjectType(body.type) || null;
  if (type !== null) {
    if (RESERVED_TYPES.includes(type)) return { error: `type ${type} is reserved` };
    if (UNSAFE.test(type) || hasControlChar(type)) return { error: 'type contains unsafe characters' };
  }
  return { cwd, type };
}

/**
 * Поставить или снять тип проекта `cwd` в тексте конфига. Чистая: возвращает
 * `{ text, added }`, кидает ошибку с причиной — текст тогда не тронут.
 *
 * Запись с этим cwd есть — правится одно поле `type` (`patchConfigScalar`, как
 * у иконок). Нет — дописывается элемент `{ name: <basename>, cwd, type }` в
 * конец списка. Снятие типа у неизвестного cwd — тишина: дописывать пустую
 * запись незачем.
 *
 * Последняя страховка — сверка разобранного до и после: изменилось ровно это
 * поле или добавился ровно этот элемент. `patchConfigScalar` проверяет только
 * свой адрес; вырезая строку `- type: …`, он унёс бы и дефис элемента.
 */
function patchProjectType(raw, cwd, type) {
  const before = parse(raw, { merge: true });
  const projects = before?.claudeWt?.projects;
  if (!Array.isArray(projects)) throw new Error('claudeWt.projects is missing in the config; add it by hand');
  const index = projects.findIndex((p) => p && typeof p === 'object' && typeof p.cwd === 'string'
    && stripTrailingSlash(p.cwd.trim()) === cwd);

  const expected = structuredClone(before);
  let text;
  let added = false;
  if (index >= 0) {
    const entry = projects[index];
    if (type === null ? !('type' in entry) : entry.type === type) return { text: raw, added: false };
    text = patchConfigScalar(raw, `claudeWt.projects.${index}`, 'type', type ?? undefined);
    if (type === null) delete expected.claudeWt.projects[index].type;
    else expected.claudeWt.projects[index].type = type;
  } else {
    if (type === null) return { text: raw, added: false };
    const name = basenameOfCwd(cwd);
    if (!name) throw new Error('cwd has no directory name');
    text = appendSeqItem(raw, ['claudeWt', 'projects'], [['name', name], ['cwd', cwd], ['type', type]]);
    expected.claudeWt.projects.push({ name, cwd, type });
    added = true;
  }
  if (JSON.stringify(parse(text, { merge: true })) !== JSON.stringify(expected)) {
    throw new Error('internal check failed: the edit would change more than the project type; config left untouched');
  }
  return { text, added };
}

/**
 * Команда `claude-project-type`: `{ ok: true, added, changed }` либо
 * `{ ok: false, reason }`. Никогда не кидает — отказ любого рода (кривое тело,
 * нет секции, flow-запись, сбой записи) приходит причиной, а файл остаётся
 * побайтно прежним. Неизменённый текст не пишется: mtime не двигается, и
 * демон не перечитывает конфиг зря.
 */
function setProjectType(payload, { filePath = resolveConfigPath() } = {}) {
  const req = parseProjectTypeRequest(payload);
  if (req.error) return { ok: false, reason: req.error };
  if (!filePath) return { ok: false, reason: 'config not found' };
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const { text, added } = patchProjectType(raw, req.cwd, req.type);
    const changed = text !== raw;
    if (changed) writeFileAtomic(filePath, text);
    return { ok: true, cwd: req.cwd, type: req.type, added, changed };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
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

export {
  readClaudeConfig, writeClaudeConfig, patchProjectIcons,
  parseProjectTypeRequest, patchProjectType, setProjectType,
};
