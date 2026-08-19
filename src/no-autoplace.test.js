import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Конфиг подставной: настоящий читает файл установки, которого на машине
// разработки нет, а нужен отсюда ровно один ключ — путь к состоянию claude-wt.
let statePath = '';
vi.mock('./config.js', () => ({ getConfig: () => ({ claudeWt: { statePath } }) }));

const { liveMarks, marksPath, noAutoplaceIds, markNoAutoplace, MARK_TTL_MS } = await import('./no-autoplace.js');

describe('liveMarks', () => {
  it('оставляет непротухшие записи', () => {
    expect(liveMarks({ 42: 2000, 43: 500 }, 1000)).toEqual({ 42: 2000 });
  });

  it('срок ровно сейчас считается истёкшим', () => {
    // Иначе запись с нулевым остатком жила бы ещё тик — а тик здесь и есть вся
    // единица времени.
    expect(liveMarks({ 42: 1000 }, 1000)).toEqual({});
  });

  it('мусор не мешает остальным записям', () => {
    // Файл переживает перезагрузку и пишется двумя процессами: обрезанный на
    // полуслове JSON, нечисловой ключ и строка вместо срока — обычное дело, и
    // ни одно из этого не повод перестать расставлять окна.
    expect(liveMarks({ abc: 2000, 42: 'скоро', 43: 2000 }, 1000)).toEqual({ 43: 2000 });
    expect(liveMarks(null, 1000)).toEqual({});
    expect(liveMarks('[]', 1000)).toEqual({});
  });
});

describe('файл пометок', () => {
  let dir = '';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-autoplace-'));
    statePath = path.join(dir, 'state.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    statePath = '';
  });

  it('помеченное окно читается обратно', () => {
    expect(markNoAutoplace(77)).toBe(true);
    expect(noAutoplaceIds()).toEqual(new Set([77]));
  });

  it('через срок годности пометки нет', () => {
    // Ключ здесь — hwnd, а Windows их переиспользует: вечная запись однажды
    // досталась бы чужому окну, и то перестало бы расставляться без причины.
    const now = 1_000_000;
    markNoAutoplace(77, { now });
    expect(noAutoplaceIds(now + MARK_TTL_MS - 1)).toEqual(new Set([77]));
    expect(noAutoplaceIds(now + MARK_TTL_MS)).toEqual(new Set());
  });

  it('вторая пометка не стирает первую', () => {
    markNoAutoplace(77);
    markNoAutoplace(78);
    expect(noAutoplaceIds()).toEqual(new Set([77, 78]));
  });

  it('лежит рядом с состоянием claude-wt', () => {
    // Тот каталог демон и так переписывает каждый тик — новых требований к
    // установке пометка не добавляет.
    expect(marksPath()).toBe(path.join(dir, 'no-autoplace.json'));
  });

  it('битый файл читается как пустота, а не роняет расстановку', () => {
    fs.writeFileSync(marksPath(), '{не json');
    expect(noAutoplaceIds()).toEqual(new Set());
  });

  it('без настроенного claude-wt пометок нет вовсе', () => {
    // Ни пути, ни файла: обе стороны обязаны вести себя как до этой правки.
    statePath = '';
    expect(marksPath()).toBe('');
    expect(markNoAutoplace(77)).toBe(false);
    expect(noAutoplaceIds()).toEqual(new Set());
  });
});
