import { describe, it, expect } from 'vitest';
import { slotSvg } from './render.js';

const slot = (over = {}) => ({
  slot: 1,
  title: 'ccfzf picker',
  cwd: '/home/popstas/projects/js/ccfzf-picker',
  status: 'active',
  contextPct: 42,
  ...over,
});

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

  it('на кнопке всё, ради чего в неё смотрят: проект, имя, процент, знак', () => {
    const svg = slotSvg(slot());
    expect(svg).toContain('ccfzf-picker');
    expect(svg).toContain('ccfzf');
    expect(svg).toContain('42%');
    expect(svg).toContain('&gt;');
  });

  it('амперсанд в имени экранируется, а не ломает документ', () => {
    // Имя приходит от человека и от агента. Один сырой `&` — и StreamDock не
    // разберёт картинку вовсе: кнопка погаснет молча.
    const svg = slotSvg(slot({ title: 'a & b <c>' }));
    expect(svg).toContain('&amp;');
    expect(svg).not.toMatch(/[^&]& /);
    expect(svg).toContain('&lt;c&gt;');
  });

  it('длинное имя переносится на две строки и обрезается, а не вылезает за кнопку', () => {
    const svg = slotSvg(slot({ title: 'очень длинное имя сессии которое никуда не влезает целиком' }));
    const lines = [...svg.matchAll(/font-size="15"[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(lines.length).toBe(2);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(13);
    expect(lines[1]).toContain('…');
  });

  it('пустой слот несёт свой номер: видно, что кнопка настроена, а сессии нет', () => {
    const svg = slotSvg({ slot: 4, status: 'empty', title: '', cwd: '', contextPct: 0 });
    expect(svg).toContain('#141416');
    expect(svg).toContain('>4<');
  });

  it('процента нет — ноль, а не пустое место', () => {
    // Перехват статуслайна стоит не у всех, и пустая строка на месте числа
    // читается как «кнопка сломалась».
    expect(slotSvg(slot({ contextPct: 0 }))).toContain('0%');
  });
});
