import { describe, it, expect } from 'vitest';
import { slotSvg, textW } from './render.js';

const slot = (over = {}) => ({
  slot: 1,
  title: 'ccfzf picker',
  cwd: '/home/popstas/projects/js/ccfzf-picker',
  status: 'active',
  contextPct: 42,
  ...over,
});

/** Строки имени сессии: подпись проекта стоит на y="20" и в счёт не идёт. */
const titleLines = (svg) => [...svg.matchAll(/<text x="8" y="(\d+)"[^>]*font-size="(\d+)"[^>]*>([^<]*)</g)]
  .filter((m) => m[1] !== '20')
  .map((m) => ({ size: Number(m[2]), text: m[3] }));

describe('slotSvg', () => {
  it('размер вшит в документ: кнопка ровно 128 на 128', () => {
    // Плагин ужимает всё, что больше, канвасом; наш SVG приходит готовым и
    // мимо ресайза — размер обязан стоять в самой картинке.
    const svg = slotSvg(slot());
    expect(svg).toContain('width="128"');
    expect(svg).toContain('height="128"');
    expect(svg).toContain('viewBox="0 0 128 128"');
  });

  it('фон красится состоянием — по цвету на каждое', () => {
    const bg = (status) => slotSvg(slot({ status })).match(/<rect[^>]*fill="(#[0-9a-f]{6})"/)[1];
    expect(bg('active')).toBe('#2e7d32');
    expect(bg('question')).toBe('#b26a00');
    expect(bg('review')).toBe('#c62828');
    expect(bg('idle')).toBe('#3a3a3e');
    expect(bg('closed')).toBe('#26262a');
    expect(bg('empty')).toBe('#141416');
  });

  it('на кнопке всё, ради чего в неё смотрят: проект, имя, кольцо контекста', () => {
    const svg = slotSvg(slot());
    expect(svg).toContain('ccfzf-picker');
    expect(titleLines(svg).map((l) => l.text).join(' ')).toBe('ccfzf picker');
    expect(svg).toContain('<path d="M 104 90 A 14 14');
  });

  it('знака состояния на кнопке нет: состояние несёт цвет фона', () => {
    // Знак съедал угол, который теперь занят кольцом, а сказать сверх цвета ему
    // было нечего: цвет виден с двух метров, знак кегля 16 — нет.
    for (const status of ['active', 'question', 'review', 'idle', 'closed']) {
      const svg = slotSvg(slot({ status, title: 'x' }));
      expect(svg).not.toContain('text-anchor="end"');
      expect(titleLines(svg).map((l) => l.text)).toEqual(['x']);
    }
  });

  it('амперсанд в имени экранируется, а не ломает документ', () => {
    // Имя приходит от человека и от агента. Один сырой `&` — и StreamDock не
    // разберёт картинку вовсе: кнопка погаснет молча.
    const svg = slotSvg(slot({ title: 'a & b <c>' }));
    expect(svg).toContain('&amp;');
    expect(svg).not.toMatch(/[^&]& /);
    expect(svg).toContain('&lt;c&gt;');
  });

  it('ширина знака взята у настоящей Segoe UI, а не усреднена', () => {
    // Полосы таблицы измерены по segoeui.ttf с целевой машины (advance /
    // unitsPerEm). Проверяются края разброса: узкая `i`, широкая `M` и
    // кириллическая `Щ` — плоское среднее переврало бы каждую в полтора раза.
    expect(textW('i', 100)).toBeCloseTo(29);
    expect(textW('M', 100)).toBeCloseTo(102);
    expect(textW('Щ', 100)).toBeCloseTo(102);
    expect(textW('o', 100)).toBeCloseTo(61);
    // Незнакомый знак не обваливает счёт в ноль: у него своя доля.
    expect(textW('\u2603', 100)).toBeGreaterThan(0);
  });

  it('кегль имени подбирается под ширину: короткое имя крупнее длинного', () => {
    // Ради этого правила всё и затевалось: при вшитом кегле `smi-parser`
    // занимал две трети ширины кнопки, а её читают с расстояния руки.
    const size = (title) => titleLines(slotSvg(slot({ title })))[0].size;
    expect(size('smi')).toBeGreaterThan(size('smi-parser'));
    expect(size('smi-parser')).toBeGreaterThan(size('smi-parser-and-more'));
    expect(size('smi-parser')).toBeGreaterThan(15); // прежний вшитый кегль
  });

  it('кегль берётся наибольший из влезающих, а не первый попавшийся', () => {
    // Иначе правило выродилось бы в «чуть крупнее прежнего»: подбор обязан
    // упираться либо в ширину кнопки, либо в потолок кегля.
    for (const title of ['smi-parser', 'picker-latency', 'bundle-sell', 'мышь']) {
      const line = titleLines(slotSvg(slot({ title })))[0];
      expect(line.text).toBe(title);
      expect(textW(title, line.size + 1) > 112 || line.size === 26).toBe(true);
    }
  });

  it('имя влезает целиком, пока хватает кегля, и только потом обрезается', () => {
    // Многоточие — плата за место, а не умолчание: пока имя помещается хоть
    // каким-то читаемым кеглем, оно показывается полностью.
    expect(titleLines(slotSvg(slot({ title: 'picker-latency' })))[0].text).toBe('picker-latency');
  });

  it('длинное имя переносится на две строки и обрезается, а не вылезает за кнопку', () => {
    const lines = titleLines(slotSvg(slot({ title: 'очень длинное имя сессии которое никуда не влезает целиком' })));
    expect(lines.length).toBe(2);
    // 128 минус поля по 8 с каждой стороны: то самое место, за которое строке
    // выходить нельзя.
    for (const line of lines) expect(textW(line.text, line.size)).toBeLessThanOrEqual(112);
    expect(lines[1].text).toContain('...'); // три точки, а не «…»: только ASCII
  });

  it('пустой слот несёт свой номер: видно, что кнопка настроена, а сессии нет', () => {
    const svg = slotSvg({ slot: 4, status: 'empty', title: '', cwd: '', contextPct: 0 });
    expect(svg).toContain('#141416');
    expect(svg).toContain('>4<');
  });

  it('контекст — доля кольца: ноль, половина, полный круг', () => {
    // Дорожка рисуется всегда: пустое место на её месте читалось бы как
    // сломанная кнопка. Перехват статуслайна стоит не у всех.
    const track = '<circle cx="104" cy="104" r="14" fill="none" stroke-width="6" stroke="#18181a"/>';
    const zero = slotSvg(slot({ contextPct: 0 }));
    expect(zero).toContain(track);
    expect(zero).not.toContain('<path');

    // Флаг большой дуги переключается ровно на половине.
    expect(slotSvg(slot({ contextPct: 50 }))).toContain('A 14 14 0 0 1 104 118');
    expect(slotSvg(slot({ contextPct: 60 }))).toMatch(/A 14 14 0 1 1/);

    // Полный круг дугой вырождается в точку, поэтому рисуется кругом.
    const full = slotSvg(slot({ contextPct: 100 }));
    expect(full).not.toContain('<path');
    expect(full).toContain('stroke="#ffffff"/>');
  });
});
