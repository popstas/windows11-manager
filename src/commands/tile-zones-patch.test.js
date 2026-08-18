import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { patchTileZonesText, verifyPatch } from './tile-zones-patch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_CONFIG = path.resolve(__dirname, '../../config.example.yaml');

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

describe('patchTileZonesText: A — отступ элементов берётся из исходника, а не из соглашения', () => {
  it('элементы на уровне ключа (без доп. отступа) — второй и следующие не разъезжаются', () => {
    // Воспроизведение из ревью: очень частый ручной стиль, элементы списка
    // на том же отступе, что и сам ключ, а не на "отступ ключа + 2".
    const raw = [
      'claudeWt:',
      '  tileZones:',
      '  - { monitor: 9, position: 9 }',
      '  - { monitor: 9, position: 8 }',
      '',
    ].join('\n');
    const out = patchTileZonesText(raw, [{ monitor: 1, position: 6 }, { monitor: 2, position: 3 }]);
    expect(out).toBe([
      'claudeWt:',
      '  tileZones:',
      '  - { monitor: 1, position: 6 }',
      '  - { monitor: 2, position: 3 }',
      '',
    ].join('\n'));
    // Результат обязан оставаться разбираемым YAML с ровно теми зонами.
    expect(parse(out).claudeWt.tileZones).toEqual([
      { monitor: 1, position: 6 },
      { monitor: 2, position: 3 },
    ]);
  });

  it('элементы отступлены глубже соглашения — тоже не разъезжаются', () => {
    const raw = 'claudeWt:\n  tileZones:\n        - { monitor: 9, position: 9 }\n        - { monitor: 9, position: 8 }\n  terminal: wt\n';
    const out = patchTileZonesText(raw, [{ monitor: 1, position: 1 }, { monitor: 2, position: 2 }, { monitor: 3, position: 3 }]);
    expect(out).toBe('claudeWt:\n  tileZones:\n        - { monitor: 1, position: 1 }\n        - { monitor: 2, position: 2 }\n        - { monitor: 3, position: 3 }\n  terminal: wt\n');
    expect(parse(out).claudeWt.tileZones.length).toBe(3);
  });

  it('4-пробельный отступ файла целиком — элементы на уровне ключа тоже держатся', () => {
    const raw = 'claudeWt:\n    tileZones:\n    - { monitor: 9, position: 9 }\n    terminal: wt\n';
    const out = patchTileZonesText(raw, [{ monitor: 1, position: 1 }, { monitor: 2, position: 2 }]);
    expect(parse(out).claudeWt.tileZones).toEqual([{ monitor: 1, position: 1 }, { monitor: 2, position: 2 }]);
  });
});

describe('patchTileZonesText: B — claudeWt как flow-карта', () => {
  it('непустая flow-карта claudeWt: { ... } — честный отказ, файл не тронут смыслово', () => {
    const raw = 'claudeWt: { terminal: wt }\n';
    expect(() => patchTileZonesText(raw, [{ monitor: 1, position: 1 }])).toThrow(/flow-стиль/);
  });

  it('пустая flow-карта claudeWt: {} — работает и не оставляет висячий пробел после двоеточия', () => {
    const raw = 'claudeWt: {}\nother: 1\n';
    const out = patchTileZonesText(raw, [{ monitor: 1, position: 1 }]);
    expect(out).toBe('claudeWt:\n  tileZones:\n    - { monitor: 1, position: 1 }\n\nother: 1\n');
    expect(out).not.toMatch(/claudeWt: +\n/); // не "claudeWt: \n" (висячий пробел перед переносом)
  });
});

describe('verifyPatch: C — страховка перед записью', () => {
  it('пропускает совпавший результат', () => {
    const zones = [{ monitor: 1, position: 6 }];
    expect(() => verifyPatch('claudeWt:\n  tileZones:\n    - { monitor: 1, position: 6 }\n', zones)).not.toThrow();
  });

  it('ловит неразбираемый результат (тот самый прежний баг: элементы на разных колонках)', () => {
    const brokenByOldBug = 'claudeWt:\n  tileZones:\n  - { monitor: 1, position: 6 }\n    - { monitor: 2, position: 3 }\n';
    expect(() => verifyPatch(brokenByOldBug, [{ monitor: 1, position: 6 }, { monitor: 2, position: 3 }]))
      .toThrow(/не разбирается/);
  });

  it('ловит результат, где claudeWt.tileZones не совпадает с тем, что просили', () => {
    const wrong = 'claudeWt:\n  tileZones:\n    - { monitor: 9, position: 9 }\n';
    expect(() => verifyPatch(wrong, [{ monitor: 1, position: 1 }])).toThrow(/не совпадает/);
  });

  it('ловит отсутствие ключа целиком (например, если правка промахнулась мимо claudeWt)', () => {
    expect(() => verifyPatch('debug: true\n', [{ monitor: 1, position: 1 }])).toThrow(/не совпадает/);
  });
});

describe('patchTileZonesText: матрица граничных случаев (ревью)', () => {
  const zones = [{ monitor: 1, position: 6 }, { monitor: 2, position: 3 }];
  const cases = [
    ['ключ в конце файла без перевода строки', 'claudeWt:\n  enabled: true'],
    ['flow-вид tileZones: [{...}]', 'claudeWt:\n  tileZones: [{ monitor: 9, position: 9 }]\n  terminal: wt\n'],
    ['claudeWt отсутствует', 'debug: true\n'],
    ['claudeWt: {}', 'claudeWt: {}\nother: 1\n'],
    ['пустой файл', ''],
    ['BOM в начале файла', '﻿claudeWt:\n  enabled: true\n'],
    ['CRLF', 'claudeWt:\r\n  enabled: true\r\n'],
    ['хвостовой комментарий на строке ключа', 'claudeWt:\n  tileZones: [{ monitor: 9, position: 9 }]  # zones\n  terminal: wt\n'],
    ['хвостовой комментарий у последнего поля (вставка)', 'claudeWt:\n  enabled: true  # comment\n'],
    ['фолдед-скаляр последним полем (вставка)', "claudeWt:\n  enabled: true\n  cmd: >-\n    exec foo\n"],
    ['merge-ключ <<: *b', 'x-anchors:\n  b: &b\n    enabled: true\nclaudeWt:\n  <<: *b\n  terminal: wt\n'],
    ['4-пробельный отступ файла', 'claudeWt:\n    tileZones:\n    - { monitor: 9, position: 9 }\n    terminal: wt\n'],
  ];

  it.each(cases)('%s — остаётся валидным YAML с ровно теми зонами', (_name, raw) => {
    const out = patchTileZonesText(raw, zones);
    expect(parse(out).claudeWt.tileZones).toEqual(zones);
  });
});
