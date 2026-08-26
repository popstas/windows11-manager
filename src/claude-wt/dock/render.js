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
// сливаться в одно пятно.
const BG = {
  active: '#2e7d32',
  question: '#b26a00',
  review: '#c62828',
  idle: '#3a3a3e',
  closed: '#26262a',
  empty: '#141416',
};

// Только ASCII. Тот же довод, что у знаков на панели openHASP: во встроенных
// шрифтах нет ни ▶, ни ·, а рисует картинку чужая программа, о шрифтах которой
// мы ничего не знаем.
const GLYPH = {
  active: '>',
  question: '?',
  review: '!',
  idle: '-',
  closed: 'x',
  empty: '',
};

const FONT = "'Segoe UI', Roboto, sans-serif";

// Ширина текста на сервере не измеряется ничем, поэтому считается по числу
// знаков: у Segoe UI средняя ширина близка к 0.55em, и кегль 15 на 112 px
// полезной ширины — это тринадцать знаков в строке. Та же приблизительность
// уже работает в makeKeySvg плагина.
const TITLE_CHARS = 13;
const TITLE_LINES = 2;
const PROJECT_CHARS = 17;

function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Три точки, а не «…» (U+2026): тот же довод, что у GLYPH. Картинку рисует
// чужая программа, о шрифтах которой мы ничего не знаем, и одна ставка на
// не-ASCII знак стоит ровно столько же, сколько другая.
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
  const title = wrap(slot?.title, TITLE_CHARS, TITLE_LINES);
  const pct = Number(slot?.contextPct) || 0;

  return [
    open(size),
    bg,
    `<text x="8" y="20" font-family="${FONT}" font-size="11" fill="#ffffff" fill-opacity="0.75">${esc(project)}</text>`,
    ...title.map((line, i) => (
      `<text x="8" y="${48 + i * 19}" font-family="${FONT}" font-size="15" fill="#ffffff">${esc(line)}</text>`
    )),
    `<text x="8" y="118" font-family="${FONT}" font-size="12" fill="#ffffff" fill-opacity="0.75">${pct}%</text>`,
    `<text x="120" y="118" text-anchor="end" font-family="${FONT}" font-size="16" fill="#ffffff">${esc(GLYPH[status])}</text>`,
    '</svg>',
  ].join('');
}

export { slotSvg };
