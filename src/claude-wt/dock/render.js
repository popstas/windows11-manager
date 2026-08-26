/**
 * Картинка слота для физической кнопки StreamDock. Чистая, без I/O.
 *
 * SVG, а не растр: рендер картинки на сервере — это шрифт в зависимостях, а
 * `setImage` у плагина и без того кормится SVG-data-URI (`httpButton` так
 * рисует свои кнопки уже сейчас).
 */
import { basenameOfCwd } from '../project-helpers.js';

// Цвет несёт состояние целиком: кнопку видно с двух метров, а текст на ней —
// нет. Оттенки приглушены нарочно — пять горящих кнопок рядом не должны
// сливаться в одно пятно. Отдельного знака состояния на кнопке нет: цвет уже
// сказал всё, а угол дороже — он ушёл под кольцо контекста.
const BG = {
  active: '#2e7d32',
  question: '#b26a00',
  review: '#c62828',
  idle: '#3a3a3e',
  closed: '#26262a',
  empty: '#141416',
};

const FONT = "'Segoe UI', Roboto, sans-serif";

// Ширина текста на сервере не измеряется ничем, поэтому считается по числу
// знаков: у Segoe UI средняя ширина близка к 0.55em. Та же приблизительность
// уже работает в makeKeySvg плагина.
const CHAR_W = 0.55;

const PAD = 8;
const TEXT_W = 128 - PAD * 2;

// Кегль имени не фиксирован: `smi-parser` при вшитых 15px занимал две трети
// ширины, а кнопка — это две секунды взгляда с расстояния вытянутой руки.
// Кегль подбирается под самое имя, сверху вниз, и берётся первый, при котором
// имя влезает целиком, без многоточия.
const TITLE_MAX = 26;
const TITLE_MIN = 13;
const TITLE_LINES = 2;
const LINE_RATIO = 1.22;

// Полоса под имя: сверху её держит подпись проекта, снизу — кольцо контекста.
const TITLE_TOP = 28;
const TITLE_BOTTOM = 88;
const TITLE_MID = (TITLE_TOP + TITLE_BOTTOM) / 2;

const PROJECT_SIZE = 12;
const PROJECT_CHARS = Math.floor(TEXT_W / (CHAR_W * PROJECT_SIZE));

// Кольцо контекста: заполненная доля вместо числа. Процент цифрами читался
// только вблизи, а долю кольца видно оттуда же, откуда и цвет.
//
// Дуга рисуется <path>-ом с явными координатами, а не stroke-dasharray с
// rotate: рисует картинку чужая программа, и чем меньше она обязана уметь, тем
// вернее кнопка не погаснет. Цвета сплошные, без прозрачности, по тому же
// доводу — и потому же различимы на всех шести фонах.
const RING_CX = 104;
const RING_CY = 104;
const RING_R = 14;
const RING_W = 6;
const RING_TRACK = '#18181a';
const RING_FILL = '#ffffff';

const round2 = (n) => Math.round(n * 100) / 100;

function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Три точки, а не «…» (U+2026): картинку рисует чужая программа, о шрифтах
// которой мы ничего не знаем, и ставка на не-ASCII знак стоит ровно столько же,
// сколько любая другая.
const ELLIPSIS = '...';

function fit(text, maxChars) {
  const s = String(text ?? '').trim();
  if (s.length <= maxChars) return s;
  // Место под сам хвост вычитается: иначе строка вылезла бы за отведённые
  // maxChars ровно на его длину.
  return `${s.slice(0, Math.max(0, maxChars - ELLIPSIS.length))}${ELLIPSIS}`;
}

/** Перенос по словам. Слово длиннее строки не делится по слогам — обрезается. */
function wrap(text, maxChars, maxLines) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  const lines = [''];
  for (const word of words) {
    const last = lines[lines.length - 1];
    const next = last ? `${last} ${word}` : word;
    if (next.length <= maxChars) {
      lines[lines.length - 1] = next;
      continue;
    }
    if (lines.length === maxLines) {
      // Место кончилось, а текст — нет: хвост показывает многоточие, иначе
      // обрезанное имя читается как полное.
      lines[lines.length - 1] = fit(next, maxChars);
      break;
    }
    lines.push(word);
  }
  return lines.map((line) => fit(line, maxChars)).filter(Boolean);
}

/**
 * Кегль имени и разбивка на строки разом: перебор сверху вниз, потому что одно
 * зависит от другого — от кегля считается длина строки, от неё выходит число
 * строк, а от него — влезает ли блок в полосу по высоте.
 */
function layoutTitle(text) {
  const whole = String(text ?? '').trim().split(/\s+/).filter(Boolean).join(' ');
  for (let size = TITLE_MAX; size >= TITLE_MIN; size -= 1) {
    const maxChars = Math.floor(TEXT_W / (CHAR_W * size));
    if (maxChars < 1) continue;
    const lines = wrap(whole, maxChars, TITLE_LINES);
    // Обрезанное имя читается как полное — такой кегль не годится, каким бы
    // крупным он ни был.
    if (lines.join(' ') !== whole) continue;
    if (lines.length * size * LINE_RATIO > TITLE_BOTTOM - TITLE_TOP) continue;
    return { size, lines };
  }
  // Целиком не влезло ни при каком кегле: самый мелкий, с многоточием.
  const maxChars = Math.floor(TEXT_W / (CHAR_W * TITLE_MIN));
  return { size: TITLE_MIN, lines: wrap(whole, maxChars, TITLE_LINES) };
}

function ring(pct) {
  const p = Math.min(100, Math.max(0, Number(pct) || 0));
  const geom = `cx="${RING_CX}" cy="${RING_CY}" r="${RING_R}" fill="none" stroke-width="${RING_W}"`;
  // Дорожка рисуется всегда: пустое место на её месте читалось бы как сломанная
  // кнопка, а пустое кольцо — как нетронутое окно.
  const track = `<circle ${geom} stroke="${RING_TRACK}"/>`;
  if (p <= 0) return track;
  // Полный круг дугой не рисуется вовсе: у дуги на 360° начало совпадает с
  // концом, и она вырождается в точку.
  if (p >= 100) return `${track}<circle ${geom} stroke="${RING_FILL}"/>`;
  const angle = (p / 100) * 2 * Math.PI;
  const x = round2(RING_CX + RING_R * Math.sin(angle));
  const y = round2(RING_CY - RING_R * Math.cos(angle));
  const large = p > 50 ? 1 : 0;
  const d = `M ${RING_CX} ${RING_CY - RING_R} A ${RING_R} ${RING_R} 0 ${large} 1 ${x} ${y}`;
  return `${track}<path d="${d}" fill="none" stroke="${RING_FILL}" stroke-width="${RING_W}"/>`;
}

function open(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">`;
}

function slotSvg(slot, { size = 128 } = {}) {
  const status = BG[slot?.status] ? slot.status : 'empty';
  const bg = `<rect width="128" height="128" fill="${BG[status]}"/>`;

  if (status === 'empty') {
    const n = Number(slot?.slot) || '';
    return [
      open(size),
      bg,
      `<text x="64" y="76" text-anchor="middle" font-family="${FONT}" font-size="30" fill="#3a3a3e">${esc(n)}</text>`,
      '</svg>',
    ].join('');
  }

  const project = fit(basenameOfCwd(slot?.cwd), PROJECT_CHARS);
  const title = layoutTitle(slot?.title);
  const lh = Math.round(title.size * LINE_RATIO);
  // Блок строк центрируется в полосе: одна строка садится посередине, две
  // расходятся от неё. Треть кегля — поправка на то, что y у <text> это база
  // буквы, а не её середина.
  const y0 = Math.round(TITLE_MID - ((title.lines.length - 1) * lh) / 2 + title.size * 0.35);
  const pct = Number(slot?.contextPct) || 0;

  return [
    open(size),
    bg,
    `<text x="${PAD}" y="20" font-family="${FONT}" font-size="${PROJECT_SIZE}" fill="#ffffff" fill-opacity="0.75">${esc(project)}</text>`,
    ...title.lines.map((line, i) => (
      `<text x="${PAD}" y="${y0 + i * lh}" font-family="${FONT}" font-size="${title.size}" fill="#ffffff">${esc(line)}</text>`
    )),
    ring(pct),
    '</svg>',
  ].join('');
}

export { slotSvg };
