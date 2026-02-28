import { describe, it, expect } from 'vitest';
import { matchRules, isWindowExcluded } from './windows-helpers.js';

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

  it('handles undefined title or path', () => {
    expect(isWindowExcluded({
      title: undefined,
      path: 'C:\\app.exe',
      excludedTitles,
      excludedPaths,
    })).toBe(false);
  });
});
