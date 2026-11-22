import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let dir;
let windowsFile;

vi.mock('../config.js', () => ({
  getConfig: () => ({
    claudeWt: {
      enabled: true,
      statePath: path.join(dir, 'state.json'),
      windowsFile,
      // Тик в этом тесте не нужен: проверяется остановка, а не слежение.
      interval: 3600000,
    },
  }),
}));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-wt-stop-'));
  windowsFile = path.join(dir, 'windows.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('stopClaudeWt', () => {
  it('убирает опубликованный файл окон: остановленный демон не тикает', async () => {
    const mod = await import('./index.js');
    fs.writeFileSync(windowsFile, JSON.stringify({ host: 'pc', pid: 4242, generated: 1, windows: {} }));

    mod.startClaudeWt({ skipCrashCheck: true });
    mod.stopClaudeWt();

    expect(fs.existsSync(windowsFile)).toBe(false);
  });

  it('не трогает файл, когда останавливать нечего', async () => {
    const mod = await import('./index.js');
    fs.writeFileSync(windowsFile, JSON.stringify({ host: 'pc', pid: 4242, generated: 1, windows: {} }));

    mod.stopClaudeWt();

    expect(fs.existsSync(windowsFile)).toBe(true);
  });
});

describe('спрос на внеочередное чтение индекса', () => {
  // Текстовый, и иначе никак: тик ходит в реестр окон, в сеть и в дамп — в
  // юнит-тесте его не поднять. Правило же молчаливое: вернись сюда прежнее
  // `unresolvedTitles(nextWindows).length > 0`, и одно окно терминала,
  // сессией Claude не являющееся (обычный PowerShell во вкладке), отменило бы
  // срок годности кэша НАВСЕГДА — дамп читался бы с сетевого диска каждую
  // секунду вместо раза в пятнадцать. Демон при этом работает, и увидеть это
  // можно только счётчиком чтений на той машине.
  const src = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8');

  it('поднимается новым заголовком, а не наличием хоть одного', () => {
    expect(src).toMatch(/indexWanted\(nextWindows, unresolvedSeen\)/);
    expect(src).not.toMatch(/wantedIndex = unresolvedTitles\(/);
  });
});

describe('переход на стол вслед за окном', () => {
  // Тоже текстовый, и по той же причине: тик ходит в реестр окон и в
  // VirtualDesktop11.exe. Правило молчаливое с другой стороны — лишний переход
  // ничего не ломает, окно остаётся где было, и в логе стоит честное
  // `switch N`. Видит его только человек: Windows на каждый вызов рисует
  // поверх экрана табличку с именем стола, и 2026-08-27 их пришлось две на
  // одно открытие сессии, стоявшей на том же столе.
  const src = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8');

  it('в moves идёт состоявшийся переезд, а не desktop из правила', () => {
    expect(src).toMatch(/if \(movedDesktop\(placed\)\) moves\.push\(/);
    // Обе дороги переноса: обычное действие step() и desktopOnlyActions.
    expect(src.match(/if \(movedDesktop\(placed\)\) moves\.push\(/g)).toHaveLength(2);
    expect(src).not.toMatch(/^\s*moves\.push\(/m);
  });
});

describe('отметки из службы: просьба демону в файле рядом с состоянием', () => {
  // Служба — другой процесс, демона в ней нет (intervalId === null): правка
  // state-файла отсюда не дожила бы до следующей записи демона, поэтому
  // отметка уходит просьбой в unread-requests.json, а тик демона кладёт её в
  // слот и в файл трекера.
  const bounds = { x: 0, y: 0, width: 10, height: 10 };
  const writeSlots = (slots) => fs.writeFileSync(
    path.join(dir, 'state.json'),
    JSON.stringify({ version: 1, slots, lastLayout: [], updated: 1 }),
  );
  const requests = () => JSON.parse(fs.readFileSync(path.join(dir, 'unread-requests.json'), 'utf8')).requests;

  it('seen: focusedAt «сейчас» и unreadAt снят — тёзкам по заголовку тоже', async () => {
    const mod = await import('./index.js');
    writeSlots({
      aaa: { titles: ['work'], bounds, focusedAt: 5, unreadAt: 50 },
      bbb: { titles: ['work'], bounds, focusedAt: 6 },
      ccc: { titles: ['other'], bounds },
    });
    const before = Math.floor(Date.now() / 1000);
    const res = mod.markSessionSeen('aaa');
    expect(res).toMatchObject({ ok: true, requested: true, unreadAt: 0 });
    expect(res.ids.sort()).toEqual(['aaa', 'bbb']);
    expect(res.focusedAt).toBeGreaterThanOrEqual(before);
    const [req] = requests();
    expect(req).toMatchObject({ focusedAt: res.focusedAt, unreadAt: 0 });
    expect(req.ids.sort()).toEqual(['aaa', 'bbb']);
  });

  it('неизвестная сессия — отказ, просьбы нет', async () => {
    const mod = await import('./index.js');
    writeSlots({ aaa: { titles: ['work'], bounds } });
    expect(mod.markSessionSeen('zzz')).toEqual({ ok: false, reason: 'unknown session zzz' });
    expect(mod.markSessionUnread('zzz')).toEqual({ ok: false, reason: 'unknown session zzz' });
    expect(fs.existsSync(path.join(dir, 'unread-requests.json'))).toBe(false);
  });
});
