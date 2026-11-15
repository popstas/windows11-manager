import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let file;
let config = {};
vi.mock('../config.js', () => ({ getConfig: () => config, resolveConfigPath: () => file }));

const { readClaudeConfig, writeClaudeConfig, patchProjectIcons } = await import('./claude-config-commands.js');

const YAML = `claudeWt:
  enabled: true
  # как ставить детей head
  childPlacement: stack
`;

describe('writeClaudeConfig — claudeWt.childPlacement', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'));
    file = path.join(dir, 'windows11-manager.config.yaml');
    fs.writeFileSync(file, YAML);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('free меняет одно значение, комментарий и прочее на месте', () => {
    expect(writeClaudeConfig({ 'claudeWt.childPlacement': 'free' })).toEqual(['claudeWt.childPlacement']);
    expect(fs.readFileSync(file, 'utf8')).toBe(YAML.replace('childPlacement: stack', 'childPlacement: free'));
  });

  it('чужое значение — отказ, файл не тронут', () => {
    expect(() => writeClaudeConfig({ 'claudeWt.childPlacement': 'mosaic' })).toThrow(/ожидается одно из stack \| free \| deck/);
    expect(fs.readFileSync(file, 'utf8')).toBe(YAML);
  });
});

// Поля третьего уровня: `claudeWt.telegramInbox.*`.
const INBOX_YAML = `claudeWt:
  telegramInbox:
    enabled: true
    sessionName: '{user}-tg-{date}'
`;

describe('claudeWt.telegramInbox на вкладке Claude', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'));
    file = path.join(dir, 'windows11-manager.config.yaml');
    fs.writeFileSync(file, INBOX_YAML);
  });
  afterEach(() => {
    config = {};
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('читает вложенное значение, незаданное — null', () => {
    config = { claudeWt: { telegramInbox: { gapMs: 1500 } } };
    const got = readClaudeConfig();
    expect(got['claudeWt.telegramInbox.gapMs']).toBe(1500);
    expect(got['claudeWt.telegramInbox.background']).toBeNull();
  });

  it('пишет gapMs внутрь блока', () => {
    expect(writeClaudeConfig({ 'claudeWt.telegramInbox.gapMs': '1000' })).toEqual(['claudeWt.telegramInbox.gapMs']);
    expect(fs.readFileSync(file, 'utf8')).toBe(INBOX_YAML + '    gapMs: 1000\n');
  });
});

describe('patchProjectIcons', () => {
  const raw = [
    'claudeWt:',
    '  projects:',
    "    - name: 'home'",
    "      cwd: '/p/home'",
    "      profile: 'home'  # профиль wt",
    "    - name: 'w11m'",
    "      cwd: '/p/w11m'",
    '',
  ].join('\n');

  it('ставит, меняет и убирает icon у проекта с этим cwd, остальное не трогает', () => {
    const set = patchProjectIcons(raw, { '/p/w11m': 'D:\\pics\\w.png' });
    expect(set).toBe(`${raw}      icon: D:\\pics\\w.png\n`);
    const changed = patchProjectIcons(set, { '/p/w11m': 'icons/x.ico' });
    expect(changed).toBe(`${raw}      icon: icons/x.ico\n`);
    expect(patchProjectIcons(changed, { '/p/w11m': null })).toBe(raw);
  });

  it('незнакомый cwd — отказ', () => {
    expect(() => patchProjectIcons(raw, { '/p/none': 'x.ico' })).toThrow(/проекта с cwd/);
  });
});
