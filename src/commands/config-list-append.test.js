import { describe, it, expect } from 'vitest';
import { appendSeqItem } from './config-list-append.js';

const PATH = ['claudeWt', 'projects'];
const ITEM = [['name', 'новый'], ['cwd', '/p/новый'], ['type', 'home']];

describe('appendSeqItem', () => {
  it('дописывает элемент за последним, комментарии и кириллица на месте', () => {
    const raw = [
      '# конфиг менеджера',
      'claudeWt:',
      '  projects:',
      '    # проекты с хоткеями',
      '    - name: home  # домашний',
      '      cwd: /p/home',
      '      hotkey: Ctrl+F11',
      '    # хвостовой комментарий списка',
      '  interval: 1000 # мс',
      '',
    ].join('\n');
    const out = appendSeqItem(raw, PATH, ITEM);
    expect(out).toBe(raw.replace(
      '      hotkey: Ctrl+F11\n',
      '      hotkey: Ctrl+F11\n    - name: новый\n      cwd: /p/новый\n      type: home\n',
    ));
  });

  it('список на отступе родительского ключа', () => {
    const raw = 'claudeWt:\n  projects:\n  - name: a\n    cwd: /a\n  interval: 1\n';
    expect(appendSeqItem(raw, PATH, [['name', 'b'], ['cwd', '/b']]))
      .toBe('claudeWt:\n  projects:\n  - name: a\n    cwd: /a\n  - name: b\n    cwd: /b\n  interval: 1\n');
  });

  it('файл без перевода строки в конце', () => {
    const raw = 'claudeWt:\n  projects:\n    - name: a\n      cwd: /a';
    expect(appendSeqItem(raw, PATH, [['name', 'b'], ['cwd', '/b']]))
      .toBe('claudeWt:\n  projects:\n    - name: a\n      cwd: /a\n    - name: b\n      cwd: /b\n');
  });

  it('CRLF остаётся CRLF', () => {
    const raw = 'claudeWt:\r\n  projects:\r\n    - name: a\r\n      cwd: /a\r\n  interval: 1\r\n';
    expect(appendSeqItem(raw, PATH, [['name', 'b'], ['cwd', '/b']]))
      .toBe('claudeWt:\r\n  projects:\r\n    - name: a\r\n      cwd: /a\r\n    - name: b\r\n      cwd: /b\r\n  interval: 1\r\n');
  });

  it('значение, похожее на число, остаётся строкой', () => {
    const raw = 'claudeWt:\n  projects:\n    - name: a\n      cwd: /a\n';
    const out = appendSeqItem(raw, PATH, [['name', '123'], ['cwd', '/p/123']]);
    expect(out).toBe(`${raw}    - name: "123"\n      cwd: /p/123\n`);
  });

  it('списка нет, он пустой, flow или не список — отказ', () => {
    expect(() => appendSeqItem('claudeWt:\n  interval: 1\n', PATH, ITEM)).toThrow(/claudeWt\.projects/);
    expect(() => appendSeqItem('claudeWt:\n  projects: []\n', PATH, ITEM)).toThrow(/empty/);
    expect(() => appendSeqItem('claudeWt:\n  projects:\n', PATH, ITEM)).toThrow(/claudeWt\.projects/);
    expect(() => appendSeqItem('claudeWt:\n  projects: [{ name: a, cwd: /a }]\n', PATH, ITEM)).toThrow(/one line/);
    expect(() => appendSeqItem('claudeWt:\n  projects:\n    a: 1\n', PATH, ITEM)).toThrow(/not a list/);
  });

  it('конфиг не разбирается — отказ', () => {
    expect(() => appendSeqItem('claudeWt:\n  projects:\n    - [\n', PATH, ITEM)).toThrow(/does not parse/);
  });
});
