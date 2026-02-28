import { describe, it, expect } from 'vitest';
import { getAppFromPath, isWindowMatchRule } from './window-match.js';

describe('getAppFromPath', () => {
  it('extracts exe name from Windows path', () => {
    expect(getAppFromPath('C:\\Program Files\\App\\app.exe')).toBe('app.exe');
  });

  it('returns lowercase', () => {
    expect(getAppFromPath('C:\\Users\\Test\\Chrome.EXE')).toBe('chrome.exe');
  });

  it('handles simple filename without path', () => {
    expect(getAppFromPath('notepad.exe')).toBe('notepad.exe');
  });

  it('handles empty string', () => {
    expect(getAppFromPath('')).toBe('');
  });
});

describe('isWindowMatchRule', () => {
  it('matches by titleMatch', () => {
    const w = { title: 'Visual Studio Code', path: 'C:\\code.exe' };
    expect(isWindowMatchRule(w, { titleMatch: 'Visual Studio' })).toBe(true);
  });

  it('rejects non-matching titleMatch', () => {
    const w = { title: 'Notepad', path: 'C:\\notepad.exe' };
    expect(isWindowMatchRule(w, { titleMatch: 'Chrome' })).toBe(false);
  });

  it('matches by pathMatch', () => {
    const w = { title: 'App', path: 'C:\\Program Files\\chrome.exe' };
    expect(isWindowMatchRule(w, { pathMatch: 'chrome\\.exe' })).toBe(true);
  });

  it('matches by both titleMatch and pathMatch', () => {
    const w = { title: 'Google Chrome', path: 'C:\\chrome.exe' };
    expect(isWindowMatchRule(w, { titleMatch: 'Google', pathMatch: 'chrome' })).toBe(true);
  });

  it('rejects when titleMatch passes but pathMatch fails', () => {
    const w = { title: 'Google Chrome', path: 'C:\\firefox.exe' };
    expect(isWindowMatchRule(w, { titleMatch: 'Google', pathMatch: 'chrome' })).toBe(false);
  });

  it('applies exclude.titleMatch', () => {
    const w = { title: 'Chrome - Settings', path: 'C:\\chrome.exe' };
    const rule = { pathMatch: 'chrome', exclude: { titleMatch: 'Settings' } };
    expect(isWindowMatchRule(w, rule)).toBe(false);
  });

  it('applies exclude.pathMatch', () => {
    const w = { title: 'App', path: 'C:\\chrome_helper.exe' };
    const rule = { pathMatch: 'chrome', exclude: { pathMatch: 'helper' } };
    expect(isWindowMatchRule(w, rule)).toBe(false);
  });

  it('returns false when no titleMatch or pathMatch', () => {
    const w = { title: 'App', path: 'C:\\app.exe' };
    expect(isWindowMatchRule(w, {})).toBe(false);
  });

  it('is case-insensitive', () => {
    const w = { title: 'CHROME', path: 'C:\\app.exe' };
    expect(isWindowMatchRule(w, { titleMatch: 'chrome' })).toBe(true);
  });
});
