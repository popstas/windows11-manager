/**
 * Точечная правка `claudeWt.tileZones` внутри исходного текста YAML-конфига.
 *
 * Первая версия читала файл через `yaml`'s Document API и записывала его
 * назад через `String(doc)` — это гоняет через сериализатор **весь**
 * документ и переразбирает заодно то, чего никто не просил трогать: флоу-
 * массивы (`['-w', '-1']` → `[ '-w', '-1' ]`), фолдед-скаляры (`>-`
 * переразбит по другой границе), однострочные комментарии (сдвигаются на
 * отдельную строку) и переносы строк (CRLF → LF). Ревью на реальном
 * `config.example.yaml` поймало восемь таких мест.
 *
 * Здесь вместо этого — хирургическая правка: `Node.range` из уже
 * распарсенного документа даёт смещения символов исходной строки, и меняется
 * ровно диапазон, отвечающий за значение `tileZones` (или место его
 * вставки), — не одним байтом больше. Всё остальное — тот же самый кусок
 * исходной строки, скопированный как есть.
 *
 * Вторая версия ловила отступ элементов списка как «отступ ключа + 2» — для
 * файла, где список записан на уровне ключа (`tileZones:\n- { ... }`, без
 * дополнительного отступа — распространённый ручной стиль), это разъезжало
 * второй и следующие элементы и портило YAML необратимо. Здесь отступ берётся
 * из самого исходника (позиция первого `-`), а не вычисляется по соглашению.
 * И на этом самодеятельность кончается: перед возвратом результат обязан
 * пройти проверку (см. `verifyPatch`) — файл с любым другим ручным стилем,
 * который здесь не предусмотрен, откажет с понятным сообщением, а не уедет
 * на диск битым.
 */
import { parseDocument, parse, isMap, isScalar } from 'yaml';
import { detectEol, eolConverter, indentAt } from './yaml-patch-helpers.js';

function renderFlow(zones) {
  if (!zones.length) return '[]';
  return `[${zones.map((z) => `{ monitor: ${z.monitor}, position: ${z.position} }`).join(', ')}]`;
}

/** Строки элементов блочного списка. Первая — без отступа (правка начинается
 *  ровно с первого `-` исходного значения), остальные — с переданным
 *  отступом (см. вызывающих: он берётся из фактического отступа этого самого
 *  первого `-` в исходнике, а не из соглашения «отступ ключа + 2»). */
function renderBlockItems(zones, itemPad) {
  return zones
    .map((z, i) => `${i === 0 ? '' : itemPad}- { monitor: ${z.monitor}, position: ${z.position} }\n`)
    .join('');
}

/** Новый блок `tileZones: ...` целиком — для вставки ключа, которого раньше
 *  не было. */
function renderNewBlock(zones, pad) {
  const kpad = ' '.repeat(pad);
  if (!zones.length) return `${kpad}tileZones: []\n`;
  const ipad = ' '.repeat(pad + 2);
  return `${kpad}tileZones:\n${zones.map((z) => `${ipad}- { monitor: ${z.monitor}, position: ${z.position} }\n`).join('')}`;
}

/**
 * Разобрать `raw` и найти узел `claudeWt.tileZones`, если он есть.
 * Ошибки разбора и «claudeWt — не отображение ключей» превращаются здесь же
 * в понятное русское сообщение, а не остаются техническим текстом
 * библиотеки `yaml`.
 */
function findTileZonesTarget(raw) {
  const doc = parseDocument(raw, { merge: true });
  if (doc.errors.length) {
    const e = doc.errors[0];
    const pos = e.linePos?.[0];
    const at = pos ? ` (строка ${pos.line}, колонка ${pos.col})` : '';
    throw new Error(`Конфиг не разбирается${at}: ${e.message}`);
  }

  const claudeWt = doc.get('claudeWt', true);
  if (claudeWt === undefined) return { kind: 'append-section' };
  if (!isMap(claudeWt)) {
    throw new Error(
      'claudeWt в конфиге — не отображение ключей, а список или отдельное значение; ' +
      'править tileZones в нём нельзя, файл не тронут.',
    );
  }

  const pair = claudeWt.items.find((p) => isScalar(p.key) && p.key.value === 'tileZones');
  if (pair) return { kind: 'replace', pair };

  // claudeWt записан в одну строку (`claudeWt: { terminal: wt }`) — вставка
  // ключа между фигурными скобками флоу-карты рвёт синтаксис (перевод строки
  // и «- элемент» посреди `{ ... }` не валиден), а корректная перестройка
  // всей карты в блочный стиль — это уже не точечная правка, а пересборка,
  // ровно то, чего эта версия избегает. Честный отказ дешевле и безопаснее.
  // Пустая карта (`claudeWt: {}`) — исключение: там менять целиком нечего
  // кроме самой пустоты, см. ветку ниже.
  if (claudeWt.flow && claudeWt.items.length > 0) {
    throw new Error(
      'claudeWt записан в одну строку (flow-стиль `{ ... }`) — автоматическая вставка tileZones ' +
      'сюда могла бы сломать файл; допишите поле tileZones под claudeWt вручную, в блочном стиле, ' +
      'и повторите сохранение.',
    );
  }

  if (claudeWt.items.length > 0) {
    return { kind: 'insert-key', afterPair: claudeWt.items[claudeWt.items.length - 1] };
  }

  // `claudeWt: {}` (или, в теории, пустой блочный вид) — карта есть, но
  // пустая: вставлять после «последнего элемента» некуда, меняем всё её
  // (пустое) значение целиком.
  const topPair = doc.contents.items.find((p) => isScalar(p.key) && p.key.value === 'claudeWt');
  return { kind: 'replace-empty-map', topPair };
}

/**
 * Последняя страховка перед записью: получившийся текст обязан разбираться,
 * и `claudeWt.tileZones` в нём обязан быть ровно тем, что просили записать.
 *
 * Это не дублирует ручные проверки (отступ элементов, flow-карта и т.п.) —
 * оно на случай форм ключа, которые здесь просто не предусмотрены. Дешевле
 * поймать расхождение одной проверкой результата, чем гоняться за каждым
 * частным стилем по отдельности; несовпадение — это в первую очередь баг
 * самого патчера, а не пользовательского файла.
 */
function verifyPatch(result, zones) {
  let parsed;
  try {
    parsed = parse(result, { merge: true });
  } catch (e) {
    throw new Error(
      `Внутренняя проверка не прошла: результат правки tileZones не разбирается как YAML ` +
      `(${e.message}). Запись отменена, файл не тронут.`,
    );
  }
  const expected = zones.map((z) => ({ monitor: z.monitor, position: z.position }));
  const got = parsed?.claudeWt?.tileZones ?? [];
  const gotNormalized = Array.isArray(got)
    ? got.map((z) => ({ monitor: z?.monitor, position: z?.position }))
    : got;
  if (JSON.stringify(gotNormalized) !== JSON.stringify(expected)) {
    throw new Error(
      'Внутренняя проверка не прошла: claudeWt.tileZones в получившемся файле не совпадает с тем, ' +
      'что просили записать. Запись отменена, файл не тронут.',
    );
  }
}

/**
 * Собрать новый текст конфига с точечно применёнными `zones`.
 *
 * Кидает по-русски читаемую ошибку и не трогает `raw`, если файл не
 * разбирается, `claudeWt` — не отображение ключей, `claudeWt` — flow-карта
 * с полями, или (последняя страховка) результат правки сам не прошёл
 * проверку — см. `verifyPatch`.
 */
function patchTileZonesText(raw, zones) {
  const target = findTileZonesTarget(raw);
  const eol = detectEol(raw);
  const toEol = eolConverter(eol);

  let result;

  if (target.kind === 'append-section') {
    const block = toEol(`claudeWt:\n${renderNewBlock(zones, 2)}`);
    const needsLeadingEol = raw.length > 0 && !raw.endsWith('\n') && !raw.endsWith('\r\n');
    result = raw + (needsLeadingEol ? eol : '') + block;
  } else if (target.kind === 'insert-key') {
    const { afterPair } = target;
    const pad = indentAt(raw, afterPair.key.range[0]);
    const anchor = afterPair.value.range[2];
    const needsLeadingEol = anchor > 0 && raw[anchor - 1] !== '\n';
    const block = toEol(renderNewBlock(zones, pad));
    result = raw.slice(0, anchor) + (needsLeadingEol ? eol : '') + block + raw.slice(anchor);
  } else if (target.kind === 'replace-empty-map') {
    const { topPair } = target;
    // Хвостовые пробелы/табы перед `{}` (обычно один, из `claudeWt: {}`)
    // тоже заменяются — иначе на строке ключа остаётся висячий пробел перед
    // переносом строки.
    let start = topPair.value.range[0];
    while (start > 0 && (raw[start - 1] === ' ' || raw[start - 1] === '\t')) start--;
    const end = topPair.value.range[1];
    const block = toEol(`${eol}${renderNewBlock(zones, 2)}`);
    result = raw.slice(0, start) + block + raw.slice(end);
  } else {
    // target.kind === 'replace': существующий ключ tileZones, только его
    // значение меняется — ключ, разделитель и всё, что не входит в диапазон
    // значения (включая любой хвостовой комментарий за пределами него),
    // остаются исходными байтами.
    const { pair } = target;
    const valueNode = pair.value;

    if (!valueNode || !valueNode.range) {
      // `tileZones:` без значения на той же строке (плейн-null сразу после
      // двоеточия) — Node всё равно даёт узел нулевой ширины с валидным
      // range, этот путь не должен срабатывать на практике, но на случай
      // экзотики режем до конца строки руками.
      const colon = raw.indexOf(':', pair.key.range[2]);
      let lineEnd = raw.indexOf('\n', colon);
      if (lineEnd === -1) lineEnd = raw.length;
      const replacement = toEol(` ${renderFlow(zones)}`);
      result = raw.slice(0, colon + 1) + replacement + raw.slice(lineEnd);
    } else {
      const sameLine = !raw.slice(pair.key.range[2], valueNode.range[0]).includes('\n');
      const start = valueNode.range[0];
      const end = valueNode.range[1];

      if (sameLine) {
        // Значение зачастую пустое (нулевой ширины, прижато прямо к
        // двоеточию, если в источнике не было пробела) — своим пробелом
        // такой случай не спутать с «пробел уже есть», не полагаясь на
        // удачу.
        const charBefore = raw[start - 1];
        const needsSpace = charBefore !== ' ' && charBefore !== '\t';
        const replacement = `${needsSpace ? ' ' : ''}${zones.length ? renderFlow(zones) : '[]'}`;
        result = raw.slice(0, start) + replacement + raw.slice(end);
      } else {
        // Отступ последующих элементов — фактический отступ ПЕРВОГО
        // элемента исходника (позиция его собственного `-`), а не «отступ
        // ключа + 2»: список вполне может стоять на уровне самого ключа
        // (`tileZones:\n- { ... }`) или быть отступлен глубже, чем принятое
        // здесь соглашение для новых вставок.
        const itemPad = ' '.repeat(indentAt(raw, start));
        const replacement = toEol(zones.length ? renderBlockItems(zones, itemPad) : '[]\n');
        result = raw.slice(0, start) + replacement + raw.slice(end);
      }
    }
  }

  verifyPatch(result, zones);
  return result;
}

// `verifyPatch` экспортируется отдельно ради собственного теста на саму
// страховку (а не только на то, что она молчит, когда всё и так верно) —
// см. tile-zones-patch.test.js.
export { patchTileZonesText, verifyPatch };
