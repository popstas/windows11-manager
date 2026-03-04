import { describe, it, expect } from 'vitest';
import { isSystemApp, getUniqueApps, filterUserApps } from './stats-helpers.js';

describe('isSystemApp', () => {
  it('returns true for Windows system paths', () => {
    expect(isSystemApp('C:\\Windows\\System32\\cmd.exe')).toBe(true);
    expect(isSystemApp('C:\\Windows\\explorer.exe')).toBe(true);
    expect(isSystemApp('C:\\Windows\\SystemApps\\Microsoft.Windows.Search_cw5n1h2txyewy\\SearchHost.exe')).toBe(true);
  });

  it('returns true for known system exes regardless of path', () => {
    expect(isSystemApp('C:\\SomeDir\\RuntimeBroker.exe')).toBe(true);
    expect(isSystemApp('D:\\dwm.exe')).toBe(true);
    expect(isSystemApp('C:\\ctfmon.exe')).toBe(true);
  });

  it('returns false for user app paths', () => {
    expect(isSystemApp('C:\\Program Files\\Mozilla Firefox\\firefox.exe')).toBe(false);
    expect(isSystemApp('C:\\Users\\Test\\AppData\\Local\\slack\\slack.exe')).toBe(false);
  });

  it('returns false for empty or null', () => {
    expect(isSystemApp('')).toBe(false);
    expect(isSystemApp(null)).toBe(false);
    expect(isSystemApp(undefined)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isSystemApp('c:\\windows\\system32\\Notepad.exe')).toBe(true);
    expect(isSystemApp('C:\\WINDOWS\\SYSTEM32\\CMD.EXE')).toBe(true);
  });
});

describe('getUniqueApps', () => {
  it('deduplicates windows by basename and counts', () => {
    const windows = [
      { path: 'C:\\Program Files\\chrome.exe' },
      { path: 'C:\\Program Files\\chrome.exe' },
      { path: 'C:\\Program Files\\firefox.exe' },
    ];
    const result = getUniqueApps(windows);
    expect(result).toEqual([
      { name: 'chrome.exe', path: 'C:\\Program Files\\chrome.exe', count: 2 },
      { name: 'firefox.exe', path: 'C:\\Program Files\\firefox.exe', count: 1 },
    ]);
  });

  it('sorts by name', () => {
    const windows = [
      { path: 'C:\\z-app.exe' },
      { path: 'C:\\a-app.exe' },
    ];
    const result = getUniqueApps(windows);
    expect(result[0].name).toBe('a-app.exe');
    expect(result[1].name).toBe('z-app.exe');
  });

  it('handles empty array', () => {
    expect(getUniqueApps([])).toEqual([]);
  });

  it('skips windows with no path', () => {
    const windows = [{ path: '' }, { path: 'C:\\app.exe' }];
    expect(getUniqueApps(windows)).toHaveLength(1);
  });
});

describe('filterUserApps', () => {
  it('filters out system apps', () => {
    const apps = [
      { name: 'chrome.exe', path: 'C:\\Program Files\\chrome.exe', count: 2 },
      { name: 'dwm.exe', path: 'C:\\Windows\\System32\\dwm.exe', count: 1 },
      { name: 'runtimebroker.exe', path: 'C:\\Windows\\System32\\RuntimeBroker.exe', count: 1 },
    ];
    const result = filterUserApps(apps);
    expect(result).toEqual([
      { name: 'chrome.exe', path: 'C:\\Program Files\\chrome.exe', count: 2 },
    ]);
  });

  it('returns empty array when all are system apps', () => {
    const apps = [
      { name: 'explorer.exe', path: 'C:\\Windows\\explorer.exe', count: 1 },
    ];
    expect(filterUserApps(apps)).toEqual([]);
  });
});
