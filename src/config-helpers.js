/** Чистые помощники конфига: разбор, поиск файла, сравнение. Без I/O. */

import path from 'node:path';
import { parse } from 'yaml';

/**
 * Ключ, под которым живут якоря.
 *
 * Якорю в YAML нужен узел, на котором он объявлен, и держать их отдельно
 * лучше, чем объявлять на первом использовании: иначе первое правило
 * становится определением для остальных, и его нельзя удалить или переставить,
 * не сломав соседей молча. Префикс `x-` — соглашение docker-compose для
 * служебных ключей.
 */
const ANCHORS_KEY = 'x-anchors';

/**
 * Разобрать текст конфига.
 *
 * `merge: true` обязателен: без него `yaml` v2 читает `<<` как обычный ключ со
 * строковым именем — правило получает поле `<<` и ни одного унаследованного
 * значения, и происходит это молча.
 *
 * `x-anchors` вырезается не ради чистоты: оставшись, он попал бы в сравнение
 * со старым конфигом (`config-verify`), и проверка эквивалентности сообщала бы
 * о расхождении, которого нет.
 */
function parseConfigText(text, filePath = '') {
  const where = filePath ? ` ${filePath}` : '';
  let parsed;
  try {
    parsed = parse(text, { merge: true });
  } catch (e) {
    const pos = e.linePos?.[0];
    const at = pos ? ` (строка ${pos.line}, колонка ${pos.col})` : '';
    throw new Error(`Конфиг${where} не разбирается${at}: ${e.message}`);
  }
  if (parsed === null || parsed === undefined) return {};
  if (Array.isArray(parsed)) {
    throw new Error(`Конфиг${where} должен быть отображением ключей, а оказался списком`);
  }
  if (typeof parsed !== 'object') {
    throw new Error(`Конфиг${where} должен быть отображением ключей, а оказался значением ${typeof parsed}`);
  }
  const config = { ...parsed };
  delete config[ANCHORS_KEY];
  return config;
}

/**
 * Пять мест, где ищется конфиг, в порядке приоритета. Список тот же, что был у
 * JS-конфига, — меняется только расширение.
 */
function configCandidates({ appDataDir, homedir, cwd, repoDir }) {
  return [
    path.join(appDataDir, 'windows-mqtt', 'windows11-manager.config.yaml'),
    path.join(appDataDir, 'windows11-manager', 'config.yaml'),
    path.join(homedir, '.config', 'windows11-manager.config.yaml'),
    path.join(cwd, 'windows11-manager.config.yaml'),
    path.join(repoDir, 'config.yaml'),
  ];
}

/**
 * Пора ли перечитывать файл.
 *
 * Кэш нужен не из аккуратности: `getConfig()` зовут из тика демона claude-wt
 * раз в секунду, и без кэша это 234 МБ RSS против 49 МБ (замерено на живом
 * конфиге). Сторож — mtime: конфиг правят на живой машине и ждут, что правка
 * подхватится без перезапуска.
 *
 * Неизвестный mtime считается поводом перечитать: `statSync` не ответил, а
 * молчаливая выдача старого конфига хуже лишнего чтения локального файла.
 */
function shouldReload({ cachedPath, cachedMtimeMs, filePath, mtimeMs }) {
  if (!cachedPath || cachedPath !== filePath) return true;
  if (mtimeMs === null || mtimeMs === undefined) return true;
  return cachedMtimeMs !== mtimeMs;
}

/** Отказ, который называет, где искали: иначе «конфиг не найден» нечем чинить. */
function formatMissingConfig(candidates) {
  return ['Конфиг не найден. Просмотрены:', ...candidates.map(c => `  ${c}`)].join('\n');
}

export { ANCHORS_KEY, parseConfigText, configCandidates, shouldReload, formatMissingConfig };
