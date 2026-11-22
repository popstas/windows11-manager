/**
 * Дописать элемент-карту в конец блочного списка YAML-конфига, не трогая
 * остального текста: `claudeWt.projects` получает запись проекта, которого в
 * нём ещё не было (`claude-project-type`).
 *
 * Отдельно от `config-scalar-patch.js`: тот правит один скаляр в карте и
 * вложенных секций не создаёт, а здесь вставка целого элемента списка со
 * своим отступом «- ». Приём тот же — меняется ровно место вставки, остальное
 * остаётся исходными байтами (почему — шапка `config-scalar-patch.js`).
 *
 * Список обязан уже быть блочным и непустым: у пустого (`projects: []`,
 * `projects:`) и flow-списка отступ элементов подсмотреть негде, а
 * перестройка их в блочный вид — уже не точечная правка. Это честный отказ.
 */
import { parseDocument, parse, isSeq } from 'yaml';
import { renderScalar } from './config-scalar-patch.js';
import { detectEol, eolConverter } from './yaml-patch-helpers.js';

/**
 * `path` — путь до списка (`['claudeWt', 'projects']`), `pairs` — ключи
 * элемента по порядку: `[['name', 'a'], ['cwd', '/a']]`. Возвращает новый
 * текст; при любой неожиданности кидает ошибку, и исходный текст не тронут.
 */
function appendSeqItem(raw, path, pairs) {
  const where = path.join('.');
  const doc = parseDocument(raw, { merge: true });
  if (doc.errors.length) {
    const pos = doc.errors[0].linePos?.[0];
    throw new Error(`config does not parse${pos ? ` (line ${pos.line}, column ${pos.col})` : ''}`);
  }
  const seq = doc.getIn(path, true);
  if (seq === undefined || seq === null || (seq && seq.value === null)) {
    throw new Error(`${where} is missing in the config; add it by hand`);
  }
  if (!isSeq(seq)) throw new Error(`${where} is not a list`);
  if (seq.flow && seq.items.length) {
    throw new Error(`${where} is written on one line (flow style); add the entry by hand`);
  }
  if (!seq.items.length) throw new Error(`${where} is empty; add the first entry by hand`);

  const last = seq.items[seq.items.length - 1];
  if (!last?.range) throw new Error(`${where}: cannot locate the last entry`);

  // Отступ — у последнего элемента: строка его начала обязана быть ровно
  // `<пробелы>-<пробелы>` до содержимого. Иначе (элемент со следующей строки
  // после «-», табуляция) угадывать раскладку патчер не берётся.
  const itemStart = last.range[0];
  const lineStart = raw.lastIndexOf('\n', itemStart - 1) + 1;
  const lead = raw.slice(lineStart, itemStart);
  const m = /^( *)-( +)$/.exec(lead);
  if (!m) throw new Error(`${where}: unusual layout of the last entry; add the entry by hand`);
  const keyPad = ' '.repeat(lead.length);

  const eol = detectEol(raw);
  const lines = pairs.map(([key, value], i) => `${i === 0 ? `${m[1]}-${m[2]}` : keyPad}${key}: ${renderScalar(value)}`);
  const block = eolConverter(eol)(`${lines.join('\n')}\n`);
  // Конец последнего элемента — после его перевода строки; комментарии за ним
  // (хвост списка, шапка следующего ключа) остаются ниже нового элемента.
  const anchor = last.range[2];
  const needsLeadingEol = anchor > 0 && raw[anchor - 1] !== '\n';
  const result = raw.slice(0, anchor) + (needsLeadingEol ? eol : '') + block + raw.slice(anchor);

  verifyAppend(raw, result, path, Object.fromEntries(pairs));
  return result;
}

/**
 * Страховка: в результате ровно один новый элемент в конце списка, равный
 * просьбе, и больше ничего не изменилось.
 */
function verifyAppend(raw, result, path, item) {
  let after;
  try {
    after = parse(result, { merge: true });
  } catch (e) {
    throw new Error(`internal check failed: the result does not parse (${e.message}); config left untouched`);
  }
  const expected = parse(raw, { merge: true });
  path.reduce((node, k) => node?.[k], expected).push(item);
  if (JSON.stringify(after) !== JSON.stringify(expected)) {
    throw new Error('internal check failed: the edit would change more than one list entry; config left untouched');
  }
}

export { appendSeqItem };
