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
import { loadConfigFile, resolveConfigPath } from '../config.js';
import { describeValue, diffConfigs } from '../config-helpers.js';

/** `.json` — снимок старой версии, всё остальное — конфиг YAML. */
function loadAny(filePath) {
  if (path.extname(filePath).toLowerCase() === '.json') {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  return loadConfigFile(filePath);
}

function dumpConfig(filePath, { json = false } = {}) {
  const config = loadAny(filePath || resolveConfigPath());
  return json ? JSON.stringify(config, null, 2) : stringify(config);
}

function verifyConfigs(aPath, bPath) {
  const diffs = diffConfigs(loadAny(aPath), loadAny(bPath));
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
