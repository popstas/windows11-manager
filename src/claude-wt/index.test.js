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
