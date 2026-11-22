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

describe('saveState: отказ записи состояния не роняет тик', () => {
  const eperm = () => Object.assign(new Error("EPERM: operation not permitted, rename 'claude-wt.json.tmp' -> 'claude-wt.json'"), { code: 'EPERM' });

  it('rename держат дольше повтора — false без исключения, одна строка на серию, строка о восстановлении', async () => {
    const mod = await import('./index.js');
    const statePath = path.join(dir, 'state.json');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw eperm(); });
    const state = { version: 1, slots: {}, lastLayout: [], updated: 1 };
    expect(mod.saveState(statePath, state)).toBe(false);
    expect(mod.saveState(statePath, state)).toBe(false);
    expect(mod.saveState(statePath, state)).toBe(false);
    expect(err.mock.calls.filter(c => String(c[0]).includes('state write failed'))).toHaveLength(1);
    rename.mockRestore();
    expect(mod.saveState(statePath, state)).toBe(true);
    expect(JSON.parse(fs.readFileSync(statePath, 'utf8')).updated).toBe(1);
    expect(log).toHaveBeenCalledWith('[claude-wt] state write recovered');
    err.mockRestore();
    log.mockRestore();
  });

  it('EPERM дважды, потом удача — файл записан с первого вызова', async () => {
    const mod = await import('./index.js');
    const statePath = path.join(dir, 'state.json');
    const real = fs.renameSync;
    let fails = 2;
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation((a, b) => {
      if (fails-- > 0) throw eperm();
      return real(a, b);
    });
    expect(mod.saveState(statePath, { version: 1, slots: {}, lastLayout: [], updated: 7 })).toBe(true);
    expect(JSON.parse(fs.readFileSync(statePath, 'utf8')).updated).toBe(7);
    rename.mockRestore();
  });

  // Текстовый — тик в юнит-тесте не поднять (см. выше). Голый writeState в тике
  // снова ронял бы его целиком вместе с публикацией файла окон.
  it('тик и markSession пишут состояние через saveState', () => {
    const src = fs.readFileSync(new URL('./index.js', import.meta.url), 'utf8');
    const calls = src.match(/^\s+(?:if \(.*)?writeState\(cfg\.statePath/gm) ?? [];
    expect(calls).toEqual([]);
    expect(src.match(/saveState\(cfg\.statePath/g)).toHaveLength(2);
  });
});
