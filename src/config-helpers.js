/** Чистые помощники конфига: разбор, поиск файла, сравнение. Без I/O. */

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

export { ANCHORS_KEY, parseConfigText };
