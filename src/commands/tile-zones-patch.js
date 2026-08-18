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
 */
import { parseDocument, isMap, isScalar } from 'yaml';

/** Перевод строки исходного файла — угадывается по первому найденному \r\n,
 *  чтобы наши собственные новые строки не сбивали CRLF-файл на LF. */
function detectEol(raw) {
  return raw.includes('\r\n') ? '\r\n' : '\n';
}

/** Отступ (число пробелов) строки, на которой лежит символ `offset`. */
function indentAt(text, offset) {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  let i = lineStart;
  while (i < offset && text[i] === ' ') i++;
  return i - lineStart;
}

function renderFlow(zones) {
  if (!zones.length) return '[]';
  return `[${zones.map((z) => `{ monitor: ${z.monitor}, position: ${z.position} }`).join(', ')}]`;
}

/** Строки элементов блочного списка. Первая — без отступа (правка начинается
 *  ровно с первого `-` исходного значения), остальные — с ним. */
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

  if (claudeWt.items.length > 0) {
    return { kind: 'insert-key', afterPair: claudeWt.items[claudeWt.items.length - 1] };
  }

  // `claudeWt: {}` — карта есть, но пустая: вставлять после «последнего
  // элемента» некуда, меняем всё её (пустое) значение целиком.
  const topPair = doc.contents.items.find((p) => isScalar(p.key) && p.key.value === 'claudeWt');
  return { kind: 'replace-empty-map', topPair };
}

/**
 * Собрать новый текст конфига с точечно применёнными `zones`.
 *
 * Кидает по-русски читаемую ошибку и не трогает `raw`, если файл не
 * разбирается или `claudeWt` — не отображение ключей.
 */
function patchTileZonesText(raw, zones) {
  const target = findTileZonesTarget(raw);
  const eol = detectEol(raw);
  const toEol = (s) => (eol === '\n' ? s : s.replace(/\n/g, eol));

  if (target.kind === 'append-section') {
    const block = toEol(`claudeWt:\n${renderNewBlock(zones, 2)}`);
    const needsLeadingEol = raw.length > 0 && !raw.endsWith('\n') && !raw.endsWith('\r\n');
    return raw + (needsLeadingEol ? eol : '') + block;
  }

  if (target.kind === 'insert-key') {
    const { afterPair } = target;
    const pad = indentAt(raw, afterPair.key.range[0]);
    const anchor = afterPair.value.range[2];
    const needsLeadingEol = anchor > 0 && raw[anchor - 1] !== '\n';
    const block = toEol(renderNewBlock(zones, pad));
    return raw.slice(0, anchor) + (needsLeadingEol ? eol : '') + block + raw.slice(anchor);
  }

  if (target.kind === 'replace-empty-map') {
    const { topPair } = target;
    const start = topPair.value.range[0];
    const end = topPair.value.range[1];
    const block = toEol(`${eol}${renderNewBlock(zones, 2)}`);
    return raw.slice(0, start) + block + raw.slice(end);
  }

  // target.kind === 'replace': существующий ключ tileZones, только его
  // значение меняется — ключ, разделитель и всё, что не входит в диапазон
  // значения (включая любой хвостовой комментарий за пределами него),
  // остаются исходными байтами.
  const { pair } = target;
  const valueNode = pair.value;
  const pad = indentAt(raw, pair.key.range[0]);

  if (!valueNode || !valueNode.range) {
    // `tileZones:` без значения на той же строке (плейн-null сразу после
    // двоеточия) — Node всё равно даёт узел нулевой ширины с валидным
    // range, этот путь не должен срабатывать на практике, но на случай
    // экзотики режем до конца строки руками.
    const colon = raw.indexOf(':', pair.key.range[2]);
    let lineEnd = raw.indexOf('\n', colon);
    if (lineEnd === -1) lineEnd = raw.length;
    const replacement = toEol(` ${renderFlow(zones)}`);
    return raw.slice(0, colon + 1) + replacement + raw.slice(lineEnd);
  }

  const sameLine = !raw.slice(pair.key.range[2], valueNode.range[0]).includes('\n');
  const start = valueNode.range[0];
  const end = valueNode.range[1];

  if (sameLine) {
    // Значение зачастую пустое (нулевой ширины, прижато прямо к двоеточию,
    // если в источнике не было пробела) — своим пробелом такой случай не
    // спутать с «пробел уже есть», не полагаясь на удачу.
    const charBefore = raw[start - 1];
    const needsSpace = charBefore !== ' ' && charBefore !== '\t';
    const replacement = `${needsSpace ? ' ' : ''}${zones.length ? renderFlow(zones) : '[]'}`;
    return raw.slice(0, start) + replacement + raw.slice(end);
  }

  const itemPad = ' '.repeat(pad + 2);
  const replacement = toEol(zones.length ? renderBlockItems(zones, itemPad) : '[]\n');
  return raw.slice(0, start) + replacement + raw.slice(end);
}

export { patchTileZonesText };
