import { describe, it, expect } from 'vitest';
import {
  filterWindowsToRestore,
  filterPathsToRestore,
  matchStoredWindows,
  resolveMatchListPure,
} from './store-helpers.js';

describe('filterWindowsToRestore', () => {
  it('filters out already-open windows by path', () => {
    const storedWins = [
      { path: 'C:\\chrome.exe', title: 'Chrome' },
      { path: 'C:\\code.exe', title: 'VS Code' },
    ];
    const currentWins = [
      { path: 'C:\\chrome.exe', title: 'Chrome' },
    ];
    const result = filterWindowsToRestore(storedWins, currentWins);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('C:\\code.exe');
  });

  it('returns new windows to open', () => {
    const storedWins = [
      { path: 'C:\\notepad.exe', title: 'Notepad' },
    ];
    const currentWins = [];
    const result = filterWindowsToRestore(storedWins, currentWins);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('C:\\notepad.exe');
    expect(result[0].args).toEqual([]);
  });

  it('parses args from .exe paths', () => {
    const storedWins = [
      { path: 'C:\\app.exe --flag arg1', title: 'App' },
    ];
    const currentWins = [];
    const result = filterWindowsToRestore(storedWins, currentWins);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('C:\\app.exe');
    expect(result[0].args).toEqual(['--flag', 'arg1']);
  });

  it('returns empty when all already open', () => {
    const storedWins = [
      { path: 'C:\\chrome.exe', title: 'Chrome' },
    ];
    const currentWins = [
      { path: 'C:\\chrome.exe', title: 'Chrome' },
    ];
    const result = filterWindowsToRestore(storedWins, currentWins);
    expect(result).toEqual([]);
  });
});

describe('filterPathsToRestore', () => {
  it('filters out already-open paths by title', () => {
    const storedPaths = ['C:\\Projects', 'D:\\Downloads'];
    const currentWins = [
      { title: 'C:\\Projects', path: 'explorer.exe' },
    ];
    const result = filterPathsToRestore(storedPaths, currentWins);
    expect(result).toEqual(['D:\\Downloads']);
  });

  it('returns new paths when none open', () => {
    const storedPaths = ['C:\\Projects', 'D:\\Downloads'];
    const currentWins = [];
    const result = filterPathsToRestore(storedPaths, currentWins);
    expect(result).toEqual(['C:\\Projects', 'D:\\Downloads']);
  });

  it('returns empty for empty storedPaths', () => {
    expect(filterPathsToRestore([], [{ title: 'x', path: 'y' }])).toEqual([]);
  });
});

describe('matchStoredWindows', () => {
  it('matches by regex', () => {
    const wins = [
      { path: 'C:\\Program Files\\chrome.exe', title: 'Chrome' },
      { path: 'C:\\firefox.exe', title: 'Firefox' },
    ];
    const matchList = { 0: 'chrome.exe', 1: 'code.exe' };
    const result = matchStoredWindows(wins, matchList);
    expect(result).toHaveLength(1);
    expect(result[0].path).toContain('chrome.exe');
  });

  it('is case-insensitive', () => {
    const wins = [
      { path: 'C:\\CHROME.EXE', title: 'Chrome' },
    ];
    const matchList = { 0: 'chrome.exe' };
    const result = matchStoredWindows(wins, matchList);
    expect(result).toHaveLength(1);
  });

  it('escapes dots in pattern', () => {
    const wins = [
      { path: 'C:\\my.app.exe', title: 'App' },
    ];
    const matchList = { 0: 'my.app.exe' };
    const result = matchStoredWindows(wins, matchList);
    expect(result).toHaveLength(1);
  });

  it('returns empty when no matches', () => {
    const wins = [
      { path: 'C:\\other.exe', title: 'Other' },
    ];
    const matchList = { 0: 'chrome\\.exe' };
    const result = matchStoredWindows(wins, matchList);
    expect(result).toEqual([]);
  });
});

describe('resolveMatchListPure', () => {
  const configDefault = { 0: 'chrome.exe', 1: 'code.exe' };

  it('returns override when non-empty array', () => {
    const override = ['firefox.exe', 'notepad.exe'];
    const result = resolveMatchListPure(override, configDefault);
    expect(result).toEqual(['firefox.exe', 'notepad.exe']);
  });

  it('falls back to config when override is empty array', () => {
    const result = resolveMatchListPure([], configDefault);
    expect(result).toBe(configDefault);
  });

  it('falls back to config when override is null', () => {
    const result = resolveMatchListPure(null, configDefault);
    expect(result).toBe(configDefault);
  });

  it('falls back to config when override is undefined', () => {
    const result = resolveMatchListPure(undefined, configDefault);
    expect(result).toBe(configDefault);
  });
});
