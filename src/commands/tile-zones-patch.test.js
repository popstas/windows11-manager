import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { patchTileZonesText } from './tile-zones-patch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_CONFIG = path.resolve(__dirname, '../../config.example.yaml');

/** Построчный diff двух текстов: индексы строк (1-based), различающихся между `a` и `b`. */
function diffLines(a, b) {
  const linesA = a.split('\n');
  const linesB = b.split('\n');
  const max = Math.max(linesA.length, linesB.length);
  const changed = [];
  for (let i = 0; i < max; i++) {
    if (linesA[i] !== linesB[i]) changed.push(i + 1);
  }
  return changed;
}

describe('patchTileZonesText: реальный config.example.yaml', () => {
  const raw = fs.readFileSync(EXAMPLE_CONFIG, 'utf8');

  it('вставка нового ключа меняет только добавленные строки — ничего чужого не задето', () => {
    const zones = [{ monitor: 1, position: 6 }, { monitor: 1, position: 7 }];
    const out = patchTileZonesText(raw, zones);

    // Все исходные строки на месте, в том же порядке, только со вставкой.
    const rawLines = raw.split('\n');
    const outLines = out.split('\n');
    expect(outLines.length).toBe(rawLines.length + 3); // "tileZones:" + 2 элемента

    // Найти вставленный блок и вырезать его — остальное обязано совпасть
    // байт в байт с исходным файлом.
    const insertAt = outLines.findIndex((l) => l.trim() === 'tileZones:');
    expect(insertAt).toBeGreaterThan(-1);
    const withoutInsert = [...outLines.slice(0, insertAt), ...outLines.slice(insertAt + 3)].join('\n');
    expect(withoutInsert).toBe(raw);

    // Ни одна из восьми точек, которые ловило прежнее ревью (флоу-массив,
    // фолдед-скаляр, monitorsOffset-подобная склейка комментария,
    // хвостовой комментарий `monitors:  # часто слетает`, двойные пробелы
    // перед `#`), не задета — все они всё ещё присутствуют дословно.
    expect(out).toContain("args: ['ssh', '-A', 'popstas@pc-virt.popstas.pro', '-t', 'ccfzf --session {id} --kiosk']");
    expect(out).toContain("terminals:\n    wt: { command: wt.exe, args: ['-w', '-1'], profileArgs: ['-p', '{profile}'] }");
    expect(out).toContain("exec $SHELL -ic 'cd -- \"$1\" && exec claude -n \"$2\"' claude-wt '{cwd}' '{name}'");
    expect(out).toContain('monitors:  # часто слетает');
    expect(out).toContain('scalc.exe  # libre office');
    expect(out).toContain('desktop: true  # return the window to its virtual desktop too');
    expect(out).toContain('debug: false   # log terminal titles that could not be matched to a session');
    expect(out).toContain('# tileZones:\n  #   - { monitor: 1, position: 6 }');

    // Валидный YAML со значением ровно тем, что просили.
    const parsed = parse(out);
    expect(parsed.claudeWt.tileZones).toEqual(zones);
  });

  it('вход с CRLF выходит с CRLF: точечная правка не перегоняет файл на LF', () => {
    const crlf = raw.replace(/\n/g, '\r\n');
    const out = patchTileZonesText(crlf, [{ monitor: 1, position: 6 }]);
    // Нетронутая часть файла (всё до вставки) сохранила \r\n как была.
    const headEnd = out.indexOf('tileZones:');
    expect(out.slice(0, headEnd)).toBe(crlf.slice(0, headEnd));
    // И собственная вставка — тоже в CRLF, не в голом LF.
    const inserted = out.slice(headEnd - 2, headEnd + 60);
    expect(inserted).toContain('\r\n');
    expect(out).not.toMatch(/[^\r]\n/); // ни одного одинокого \n без предшествующего \r
  });
});

describe('patchTileZonesText: синтетические случаи', () => {
  it('заменяет существующий блочный tileZones на месте, не трогая соседей', () => {
    const raw = [
      'claudeWt:',
      '  enabled: true',
      '  tileZones:',
      '    - { monitor: 1, position: 6 }',
      '    - { monitor: 1, position: 7 }',
      '  terminal: wt  # trailing comment',
      '',
    ].join('\n');
    const out = patchTileZonesText(raw, [{ monitor: 2, position: 1 }]);
    expect(out).toBe([
      'claudeWt:',
      '  enabled: true',
      '  tileZones:',
      '    - { monitor: 2, position: 1 }',
      '  terminal: wt  # trailing comment',
      '',
    ].join('\n'));
  });

  it('заменяет существующий однострочный (flow) tileZones на месте', () => {
    const raw = 'claudeWt:\n  tileZones: [{ monitor: 1, position: 6 }]\n  terminal: wt\n';
    const out = patchTileZonesText(raw, [{ monitor: 9, position: 9 }]);
    expect(out).toBe('claudeWt:\n  tileZones: [{ monitor: 9, position: 9 }]\n  terminal: wt\n');
  });

  it('пустой список зон в блочном стиле — валидный YAML, соседей не трогает', () => {
    const raw = 'claudeWt:\n  tileZones:\n    - { monitor: 1, position: 6 }\n  terminal: wt\n';
    const out = patchTileZonesText(raw, []);
    expect(out).toBe('claudeWt:\n  tileZones:\n    []\n  terminal: wt\n');
    expect(parse(out).claudeWt.tileZones).toEqual([]);
  });

  it('ключа tileZones нет — вставляет его после последнего поля claudeWt, с тем же отступом', () => {
    const raw = 'claudeWt:\n  enabled: true\n  terminal: wt\nother: 1\n';
    const out = patchTileZonesText(raw, [{ monitor: 1, position: 6 }]);
    expect(out).toBe('claudeWt:\n  enabled: true\n  terminal: wt\n  tileZones:\n    - { monitor: 1, position: 6 }\nother: 1\n');
  });

  it('ключа claudeWt нет вовсе — добавляет новую секцию в конец файла', () => {
    const raw = 'debug: true\n';
    const out = patchTileZonesText(raw, [{ monitor: 1, position: 6 }]);
    expect(out).toBe('debug: true\nclaudeWt:\n  tileZones:\n    - { monitor: 1, position: 6 }\n');
    expect(parse(out)).toEqual({ debug: true, claudeWt: { tileZones: [{ monitor: 1, position: 6 }] } });
  });

  it('claudeWt: {} (пустая flow-карта) — правка не ломает YAML', () => {
    const raw = 'claudeWt: {}\nother: 1\n';
    const out = patchTileZonesText(raw, [{ monitor: 1, position: 1 }]);
    expect(parse(out)).toEqual({ claudeWt: { tileZones: [{ monitor: 1, position: 1 }] }, other: 1 });
  });

  it('claudeWt — список: понятная русская ошибка, файл не тронут', () => {
    const raw = 'claudeWt:\n  - a\n  - b\n';
    expect(() => patchTileZonesText(raw, [])).toThrow(/не отображение ключей/);
  });

  it('claudeWt — скаляр: та же понятная ошибка', () => {
    const raw = 'claudeWt: true\n';
    expect(() => patchTileZonesText(raw, [])).toThrow(/не отображение ключей/);
  });

  it('битый YAML: ошибка разбора по-русски, с местом', () => {
    const raw = 'mqtt: {host: a: b}\n';
    expect(() => patchTileZonesText(raw, [])).toThrow(/не разбирается/);
  });
});
