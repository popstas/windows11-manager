import { describe, it, expect } from 'vitest';
import { matchRules, isWindowExcluded, isMinimized } from './windows-helpers.js';

describe('matchRules', () => {
  const rules = [
    { pathMatch: 'chrome', titleMatch: 'Google' },
    { pathMatch: 'chrome', titleMatch: 'Settings', single: true },
    { pathMatch: 'firefox' },
  ];

  it('returns multiple matches when no single rule', () => {
    const multiRules = [
      { pathMatch: 'chrome' },
      { pathMatch: 'chrome', titleMatch: 'Google' },
    ];
    const w = { title: 'Google Chrome', path: 'C:\\chrome.exe' };
    const result = matchRules(w, multiRules);
    expect(result).toHaveLength(2);
  });

  it('returns single rule when matched rule has single: true', () => {
    const w = { title: 'Chrome Settings', path: 'C:\\chrome.exe' };
    const result = matchRules(w, rules);
    expect(result).toHaveLength(1);
    expect(result[0].single).toBe(true);
    expect(result[0].titleMatch).toBe('Settings');
  });

  it('returns no matches when window matches no rules', () => {
    const w = { title: 'Notepad', path: 'C:\\notepad.exe' };
    const result = matchRules(w, rules);
    expect(result).toEqual([]);
  });

  it('returns empty array for empty rules', () => {
    const w = { title: 'Chrome', path: 'C:\\chrome.exe' };
    const result = matchRules(w, []);
    expect(result).toEqual([]);
  });
});

describe('isWindowExcluded', () => {
  const excludedTitles = ['Default IME', 'Program Manager'];
  const excludedPaths = ['TextInputHost.exe', 'LogiOverlay.exe'];

  it('returns true when title matches excludedTitles', () => {
    expect(isWindowExcluded({
      title: 'Default IME',
      path: 'C:\\app.exe',
      excludedTitles,
      excludedPaths,
    })).toBe(true);
    expect(isWindowExcluded({
      title: 'Program Manager - something',
      path: 'C:\\app.exe',
      excludedTitles,
      excludedPaths,
    })).toBe(true);
  });

  it('returns true when path matches excludedPaths', () => {
    expect(isWindowExcluded({
      title: 'Some Window',
      path: 'C:\\Program Files\\TextInputHost.exe',
      excludedTitles,
      excludedPaths,
    })).toBe(true);
    expect(isWindowExcluded({
      title: 'Logi',
      path: 'C:\\LogiOverlay.exe',
      excludedTitles,
      excludedPaths,
    })).toBe(true);
  });

  it('returns false when no exclusion', () => {
    expect(isWindowExcluded({
      title: 'Chrome',
      path: 'C:\\chrome.exe',
      excludedTitles,
      excludedPaths,
    })).toBe(false);
  });

  it('handles empty excluded arrays', () => {
    expect(isWindowExcluded({
      title: 'Anything',
      path: 'C:\\any.exe',
      excludedTitles: [],
      excludedPaths: [],
    })).toBe(false);
  });

  it('handles undefined title', () => {
    expect(isWindowExcluded({
      title: undefined,
      path: 'C:\\app.exe',
      excludedTitles,
      excludedPaths,
    })).toBe(false);
  });

  it('handles undefined path', () => {
    expect(isWindowExcluded({
      title: 'Some Window',
      path: undefined,
      excludedTitles,
      excludedPaths,
    })).toBe(false);
  });
});

describe('isMinimized', () => {
  // Windows паркует свёрнутое окно на x = -32000, и это единственный признак,
  // по которому его видно снаружи: размеры остаются прежними.
  it('припаркованное окно свёрнуто', () => {
    expect(isMinimized({ x: -32000, y: -32000, width: 1200, height: 800 })).toBe(true);
  });

  it('обычное окно не свёрнуто', () => {
    expect(isMinimized({ x: 0, y: 0, width: 1200, height: 800 })).toBe(false);
  });

  // Измерено на popstas-pc 19.08.2026: Windows 11 паркует свёрнутое окно на
  // -20480, а не на -32000, как считалось. Из-за этой разницы focusWindowById()
  // со своим прежним порогом -30000 не звал restore() вовсе — окно выходило на
  // передний план свёрнутым, и нажатие на сессию выглядело как «ничего не
  // происходит».
  it('парковка Windows 11 на -20480 — тоже свёрнутое', () => {
    expect(isMinimized({ x: -20480, y: -20480, width: 127, height: 21 })).toBe(true);
  });

  // Второй монитор слева от главного даёт честные отрицательные координаты, и
  // окно на нём свёрнутым считать нельзя.
  it('окно на левом мониторе не свёрнуто', () => {
    expect(isMinimized({ x: -1920, y: 0, width: 1200, height: 800 })).toBe(false);
  });

  it('без границ решать не о чем', () => {
    expect(isMinimized(null)).toBe(false);
    expect(isMinimized({})).toBe(false);
  });
});
