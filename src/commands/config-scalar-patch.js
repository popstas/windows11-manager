/**
 * Точечная правка одного скалярного ключа второго уровня в YAML-конфиге:
 * `claudeWt.interval`, `homeassistant.slots` и прочие поля вкладки Claude.
 *
 * Тот же приём и по той же причине, что у соседнего `tile-zones-patch.js`:
 * конфиг человек ведёт руками, он весь в поясняющих комментариях, и прогон его
 * через сериализатор (`yaml.stringify(obj)` или `String(parseDocument(...))`)
 * переразбирает заодно то, чего никто не просил трогать — флоу-массивы,
 * фолдед-скаляры, положение однострочных комментариев, CRLF. Поэтому меняется
 * ровно диапазон символов нужного значения, а всё остальное — исходные байты.
 *
 * Отдельный модуль, а не обобщение `tile-zones-patch.js`: там значение —
 * блочный список с собственными правилами отступа элементов, здесь — скаляр на
 * одной строке. Общее у них только мелкое (`yaml-patch-helpers.js`), и сводить
 * два разных случая в один патчер значило бы рисковать хорошо покрытым
 * тестами путём зон ради общности, которой в коде нет.
 *
 * `value === undefined` означает «убрать ключ»: пустое поле в окне настроек —
 * это просьба вернуть умолчание, а не записать пустую строку. Разница не
 * косметическая: `mergeClaudeWtConfig` накладывает конфиг поверх умолчаний, и
 * записанный `terminal: ''` затёр бы `wt` пустотой, тогда как отсутствие ключа
 * оставляет умолчание работать.
 */
import { parseDocument, parse, stringify, isMap, isScalar } from 'yaml';
import { detectEol, eolConverter, indentAt } from './yaml-patch-helpers.js';

/**
 * Скаляр в виде куска YAML. Форму (нужны ли кавычки и какие) выбирает сама
 * библиотека — гадать за неё про пути с обратными слэшами, пустые строки и
 * слова вроде `no` дороже, чем спросить.
 *
 * Многострочный результат — отказ: поля вкладки однострочные, а вставка
 * блочного скаляра посреди строки ключа сломала бы файл. На практике сюда
 * попасть можно только значением с переводом строки внутри.
 */
function renderScalar(value) {
  const out = stringify(value, { lineWidth: 0 }).replace(/\r?\n$/, '');
  if (/\r?\n/.test(out)) {
    throw new Error('Значение занимает несколько строк — такие сюда не записываются.');
  }
  return out;
}

/** Конец строки, на которой лежит символ `offset` (позиция самого `\n` или конец текста). */
function lineEndAt(text, offset) {
  const nl = text.indexOf('\n', offset);
  return nl === -1 ? text.length : nl;
}

/** Начало строки, на которой лежит символ `offset`. */
function lineStartAt(text, offset) {
  return text.lastIndexOf('\n', offset - 1) + 1;
}

/**
 * Разобрать `raw` и найти, куда целиться: в существующий ключ, в место его
 * вставки или в отсутствующую секцию. Ошибки разбора и негодная форма секции
 * превращаются здесь же в понятное сообщение, а не остаются техническим
 * текстом библиотеки `yaml`.
 */
function findTarget(raw, section, key) {
  const doc = parseDocument(raw, { merge: true });
  if (doc.errors.length) {
    const e = doc.errors[0];
    const pos = e.linePos?.[0];
    const at = pos ? ` (строка ${pos.line}, колонка ${pos.col})` : '';
    throw new Error(`Конфиг не разбирается${at}: ${e.message}`);
  }

  const node = doc.get(section, true);
  if (node === undefined || node === null) return { kind: 'append-section' };
  if (!isMap(node)) {
    throw new Error(
      `${section} в конфиге — не отображение ключей, а список или отдельное значение; ` +
      `править ${key} в нём нельзя, файл не тронут.`,
    );
  }

  const pair = node.items.find((p) => isScalar(p.key) && p.key.value === key);
  if (pair) return { kind: 'replace', pair, flow: Boolean(node.flow) };

  // Секция записана в одну строку (`claudeWt: { terminal: wt }`) — вставка
  // ключа между фигурными скобками флоу-карты рвёт синтаксис, а перестройка
  // всей карты в блочный стиль — уже не точечная правка. Честный отказ дешевле
  // и безопаснее. Пустая карта (`claudeWt: {}`) — исключение, см. ниже.
  if (node.flow && node.items.length > 0) {
    throw new Error(
      `${section} записан в одну строку (flow-стиль \`{ ... }\`) — автоматическая вставка ${key} ` +
      'сюда могла бы сломать файл; допишите поле вручную, в блочном стиле, и повторите сохранение.',
    );
  }

  if (node.items.length > 0) {
    return { kind: 'insert-key', afterPair: node.items[node.items.length - 1] };
  }

  // `claudeWt: {}` — карта есть, но пустая: вставлять после «последнего
  // элемента» некуда, меняем всё её (пустое) значение целиком.
  const topPair = doc.contents?.items?.find((p) => isScalar(p.key) && p.key.value === section);
  return { kind: 'replace-empty-map', topPair };
}

/**
 * Последняя страховка перед записью: получившийся текст обязан разбираться, и
 * значение по адресу `section.key` в нём обязано быть ровно тем, что просили
 * записать (или отсутствовать, если просили убрать).
 *
 * Это не дублирует ручные проверки выше — оно на случай форм ключа, которые
 * здесь просто не предусмотрены. Несовпадение — в первую очередь баг самого
 * патчера, а не пользовательского файла.
 */
function verifyPatch(result, section, key, value) {
  let parsed;
  try {
    parsed = parse(result, { merge: true });
  } catch (e) {
    throw new Error(
      `Внутренняя проверка не прошла: результат правки ${section}.${key} не разбирается как YAML ` +
      `(${e.message}). Запись отменена, файл не тронут.`,
    );
  }
  const got = parsed?.[section]?.[key];
  const same = value === undefined
    ? got === undefined
    : JSON.stringify(got) === JSON.stringify(value);
  if (!same) {
    throw new Error(
      `Внутренняя проверка не прошла: ${section}.${key} в получившемся файле не совпадает с тем, ` +
      'что просили записать. Запись отменена, файл не тронут.',
    );
  }
}

/**
 * Собрать новый текст конфига с точечно применённым `value` по адресу
 * `section.key`. `value === undefined` — убрать ключ.
 *
 * Кидает читаемую ошибку и не трогает `raw`, если файл не разбирается, секция
 * не отображение ключей, секция — flow-карта с полями, или результат правки не
 * прошёл проверку (см. `verifyPatch`).
 */
function patchConfigScalar(raw, section, key, value) {
  const target = findTarget(raw, section, key);
  const eol = detectEol(raw);
  const toEol = eolConverter(eol);

  // Убрать ключ, которого и так нет, — тишина, а не ошибка: так вызывающему не
  // нужно знать, был ли он записан, чтобы очистить поле формы.
  if (value === undefined && target.kind !== 'replace') return raw;

  let result;

  if (target.kind === 'append-section') {
    const block = toEol(`${section}:\n  ${key}: ${renderScalar(value)}\n`);
    const needsLeadingEol = raw.length > 0 && !raw.endsWith('\n');
    result = raw + (needsLeadingEol ? eol : '') + block;
  } else if (target.kind === 'insert-key') {
    const { afterPair } = target;
    const pad = ' '.repeat(indentAt(raw, afterPair.key.range[0]));
    // Конец значения последней пары, а не конец её строки: у блочного значения
    // (списка, вложенной карты) строк несколько, и вставлять надо после всех.
    const anchor = afterPair.value ? afterPair.value.range[2] : lineEndAt(raw, afterPair.key.range[2]) + 1;
    const needsLeadingEol = anchor > 0 && raw[anchor - 1] !== '\n';
    const block = toEol(`${pad}${key}: ${renderScalar(value)}\n`);
    result = raw.slice(0, anchor) + (needsLeadingEol ? eol : '') + block + raw.slice(anchor);
  } else if (target.kind === 'replace-empty-map') {
    const { topPair } = target;
    if (!topPair?.value?.range) {
      throw new Error(`Не удалось найти пустую секцию ${section} в тексте конфига; файл не тронут.`);
    }
    // Хвостовые пробелы перед `{}` тоже заменяются — иначе на строке ключа
    // остаётся висячий пробел перед переносом строки.
    let start = topPair.value.range[0];
    while (start > 0 && (raw[start - 1] === ' ' || raw[start - 1] === '\t')) start--;
    const end = topPair.value.range[1];
    const block = toEol(`${eol}  ${key}: ${renderScalar(value)}\n`);
    result = raw.slice(0, start) + block + raw.slice(end);
  } else if (value === undefined) {
    // Убрать существующий ключ: вырезается вся его строка целиком, вместе с
    // отступом и хвостовым комментарием на ней. Комментарий НАД ключом
    // остаётся — он написан человеком про это поле, и угадывать его границы
    // (где кончается комментарий ключа и начинается комментарий секции)
    // патчер не берётся.
    const { pair, flow } = target;
    if (flow) {
      throw new Error(
        `${section} записан в одну строку (flow-стиль \`{ ... }\`) — убрать ${key} оттуда ` +
        'автоматически нельзя; уберите поле вручную и повторите сохранение.',
      );
    }
    const start = lineStartAt(raw, pair.key.range[0]);
    const valueEnd = pair.value?.range ? pair.value.range[1] : pair.key.range[2];
    const end = Math.min(lineEndAt(raw, valueEnd) + 1, raw.length);
    result = raw.slice(0, start) + raw.slice(end);
  } else {
    // Существующий ключ: меняется только его значение. Ключ, двоеточие и всё,
    // что не входит в диапазон значения (включая хвостовой комментарий за его
    // пределами), остаются исходными байтами.
    const { pair } = target;
    const valueNode = pair.value;
    const rendered = renderScalar(value);

    if (!valueNode || !valueNode.range) {
      // `debug:` без значения на строке. Node обычно всё равно даёт узел
      // нулевой ширины с валидным range, так что путь запасной.
      const colon = raw.indexOf(':', pair.key.range[2] - 1);
      const end = lineEndAt(raw, colon);
      result = raw.slice(0, colon + 1) + ` ${rendered}` + raw.slice(end);
    } else {
      const start = valueNode.range[0];
      const end = valueNode.range[1];
      // Значение зачастую нулевой ширины и прижато прямо к двоеточию — своим
      // пробелом такой случай не спутать с «пробел уже есть».
      const charBefore = raw[start - 1];
      const needsSpace = charBefore !== ' ' && charBefore !== '\t' && charBefore !== '\n';
      result = raw.slice(0, start) + (needsSpace ? ' ' : '') + rendered + raw.slice(end);
    }
  }

  verifyPatch(result, section, key, value);
  return result;
}

// `verifyPatch` и `renderScalar` экспортируются ради собственных тестов на сами
// страховки, а не только на то, что они молчат, когда всё и так верно.
export { patchConfigScalar, verifyPatch, renderScalar };
