/**
 * Служебные команды конфига: показать разобранное и доказать эквивалентность.
 *
 * Заведены ради переезда с JS на YAML. Живой конфиг переписывается руками (в
 * нём якоря и комментарии, которых автоматический дамп не восстановит), а
 * `config-verify` доказывает, что рукопись не разошлась с оригиналом, — до
 * выкатки, а не после.
 *
 * Старый JS здесь не читается намеренно: `require` пришлось бы оставить в новой
 * версии ровно затем, ради чего его выпиливают. Снимок делает старая версия на
 * своей машине:
 *   node -e "console.log(JSON.stringify(require('<путь к .js>')))" > old.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import { candidates, loadConfigFile, resolveConfigPath } from '../config.js';
import { describeValue, diffConfigs, formatMissingConfig } from '../config-helpers.js';

/** `.json` — снимок старой версии, всё остальное — конфиг YAML. */
function loadAny(filePath) {
  if (path.extname(filePath).toLowerCase() === '.json') {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  return loadConfigFile(filePath);
}

/**
 * Путь к файлу: названный аргументом либо выбранный менеджером.
 *
 * Отказывать здесь обязательно: пустой путь уходил прямо в readFileSync, и
 * человек, у которого выкатка выглядит сломанной, получал от диагностической
 * команды `ENOENT: open ''` — ни проблемы, ни просмотренных мест.
 */
function requireConfigPath(filePath) {
  if (!filePath) {
    const resolved = resolveConfigPath();
    if (!resolved) throw new Error(formatMissingConfig(candidates()));
    return resolved;
  }
  if (!fs.existsSync(filePath)) throw new Error(`Файл конфига не найден: ${filePath}`);
  return filePath;
}

function dumpConfig(filePath, { json = false } = {}) {
  const file = requireConfigPath(filePath);
  // Главный вопрос после выкатки — который из пяти файлов прочитан, и отвечать
  // на него надо всегда, даже когда путь назван аргументом. Строка уходит в
  // stderr, чтобы stdout оставался разбираемым конфигом.
  console.error(`# ${file}`);
  const config = loadAny(file);
  // lineWidth: 0 — иначе умолчание 80 рвёт по строкам ssh-строку launchNew и
  // длинные пути Windows, а этот дамп зовут черновиком для миграции.
  return json ? JSON.stringify(config, null, 2) : stringify(config, { lineWidth: 0 });
}

function verifyConfigs(aPath, bPath) {
  const diffs = diffConfigs(loadAny(requireConfigPath(aPath)), loadAny(requireConfigPath(bPath)));
  if (!diffs.length) return { ok: true, lines: ['конфиги эквивалентны'] };
  return {
    ok: false,
    lines: [
      ...diffs.map(d => `разошлись: ${d.path}  ${describeValue(d.a)} ≠ ${describeValue(d.b)}`),
      `расхождений: ${diffs.length}`,
    ],
  };
}

export { dumpConfig, verifyConfigs };
