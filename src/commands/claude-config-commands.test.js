import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parse } from 'yaml';

let file;
let config = {};
vi.mock('../config.js', () => ({ getConfig: () => config, resolveConfigPath: () => file }));

const {
  readClaudeConfig, writeClaudeConfig, patchProjectIcons, setProjectType, parseProjectTypeRequest,
} = await import('./claude-config-commands.js');
const { normalizeProjects } = await import('../claude-wt/project-helpers.js');
const { buildWindowsFile } = await import('../claude-wt/windows-file-helpers.js');

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

  it('список inboxes рядом не мешает: правится только telegramInbox, элементы списка не тронуты', () => {
    const yaml = `claudeWt:
  inboxes:
    - name: email
      enabled: false
      gapMs: 500
  telegramInbox:
    enabled: true
    gapMs: 2000
  interval: 1000
`;
    fs.writeFileSync(file, yaml);
    expect(writeClaudeConfig({ 'claudeWt.telegramInbox.gapMs': '1000' })).toEqual(['claudeWt.telegramInbox.gapMs']);
    expect(fs.readFileSync(file, 'utf8')).toBe(yaml.replace('gapMs: 2000', 'gapMs: 1000'));

    const tail = `claudeWt:
  telegramInbox:
    enabled: true
  inboxes:
    - name: email
      enabled: false
`;
    fs.writeFileSync(file, tail);
    writeClaudeConfig({ 'claudeWt.telegramInbox.background': false });
    expect(fs.readFileSync(file, 'utf8')).toBe(tail.replace('    enabled: true\n', '    enabled: true\n    background: false\n'));
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

describe('readClaudeConfig — _projects несёт тип', () => {
  afterEach(() => { config = {}; });

  it('тип записи — нормализованный, без типа — пустая строка', () => {
    config = { claudeWt: { projects: [
      { name: 'site', cwd: '/p/site', type: ' Work ' },
      { name: 'home', cwd: '/p/home' },
    ] } };
    const got = readClaudeConfig()._projects;
    expect(got.map((p) => [p.cwd, p.type])).toEqual([['/p/site', 'work'], ['/p/home', '']]);
  });
});

describe('setProjectType — claude-project-type', () => {
  // Живой конфиг ведут руками: комментарии, кириллица, кавычки — всё это
  // обязано пережить запись типа побайтно.
  const LIVE = [
    '# Конфиг менеджера — правится руками',
    'claudeWt:',
    '  enabled: true',
    '  projects:',
    '    # Проекты с хоткеями',
    "    - name: 'дом'  # домашний",
    "      cwd: '/p/home'",
    '      hotkey: Ctrl+F11',
    '    - name: site',
    '      cwd: /p/site',
    '      type: work # рабочий',
    '    # конец списка',
    '  interval: 1000 # мс',
    '',
  ].join('\n');

  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-type-'));
    file = path.join(dir, 'windows11-manager.config.yaml');
    fs.writeFileSync(file, LIVE);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const read = () => fs.readFileSync(file, 'utf8');

  it('у записи без типа — одна новая строка, остальное побайтно', () => {
    expect(setProjectType({ cwd: '/p/home', type: 'home' })).toEqual({ ok: true, cwd: '/p/home', type: 'home', added: false, changed: true });
    expect(read()).toBe(LIVE.replace('      hotkey: Ctrl+F11\n', '      hotkey: Ctrl+F11\n      type: home\n'));
  });

  it('смена типа меняет только значение, хвостовой комментарий на месте', () => {
    expect(setProjectType({ cwd: '/p/site', type: ' Home ' })).toMatchObject({ ok: true, added: false, changed: true });
    expect(read()).toBe(LIVE.replace('type: work # рабочий', 'type: home # рабочий'));
  });

  it('снятие типа убирает его строку', () => {
    expect(setProjectType({ cwd: '/p/site', type: null })).toMatchObject({ ok: true, changed: true });
    expect(read()).toBe(LIVE.replace('      type: work # рабочий\n', ''));
    expect(setProjectType({ cwd: '/p/site', type: '' })).toMatchObject({ ok: true, changed: false });
  });

  it('тот же тип — файл не переписывается', () => {
    const before = fs.statSync(file).mtimeMs;
    fs.utimesSync(file, new Date(1000), new Date(1000));
    expect(setProjectType({ cwd: '/p/site/', type: 'work' })).toMatchObject({ ok: true, added: false, changed: false });
    expect(fs.statSync(file).mtimeMs).toBe(1000);
    expect(before).not.toBe(1000);
  });

  it('неизвестный cwd дописывается элементом, остальное не тронуто; повтор — уже не добавление', () => {
    expect(setProjectType('{"cwd":"/p/новый/","type":"home"}')).toEqual({ ok: true, cwd: '/p/новый', type: 'home', added: true, changed: true });
    expect(read()).toBe(LIVE.replace(
      '      type: work # рабочий\n',
      '      type: work # рабочий\n    - name: новый\n      cwd: /p/новый\n      type: home\n',
    ));
    expect(setProjectType({ cwd: '/p/новый', type: 'work' })).toMatchObject({ ok: true, added: false, changed: true });
  });

  it('дописанная запись доезжает до файла трекера с типом', () => {
    setProjectType({ cwd: '/p/новый', type: 'home' });
    const projects = normalizeProjects(parse(read()).claudeWt.projects);
    const out = buildWindowsFile({ windows: [], slots: {}, host: 'h', pid: 1, nowMs: 0, projects });
    expect(out.projects).toContainEqual({ cwd: '/p/новый', name: 'новый', type: 'home' });
  });

  it('снятие типа у неизвестного cwd — тишина, записи не дописывается', () => {
    expect(setProjectType({ cwd: '/p/none', type: null })).toMatchObject({ ok: true, added: false, changed: false });
    expect(read()).toBe(LIVE);
  });

  it.each([
    [{ cwd: '/p/a;rm', type: 'work' }, /unsafe/],
    [{ cwd: 'p/rel', type: 'work' }, /absolute/],
    [{ cwd: '/p/a\u0007', type: 'work' }, /unsafe/],
    [{ cwd: '/p/../etc', type: 'work' }, /segments/],
    [{ cwd: '/', type: 'work' }, /absolute|directory name/],
    [{ cwd: '/p/x', type: 'untyped' }, /reserved/],
    [{ cwd: '/p/x', type: ' None ' }, /reserved/],
    [{ cwd: '/p/x', type: 5 }, /string or null/],
    [{ cwd: '/p/x', type: 'a$b' }, /unsafe/],
    [{ type: 'work' }, /cwd is required/],
    ['not json', /bad payload/],
  ])('отказ %j, файл побайтно прежний', (payload, reason) => {
    const res = setProjectType(payload);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(reason);
    expect(read()).toBe(LIVE);
  });

  it('секции claudeWt.projects нет — отказ, файл не тронут', () => {
    const raw = 'claudeWt:\n  enabled: true # да\n';
    fs.writeFileSync(file, raw);
    expect(setProjectType({ cwd: '/p/x', type: 'work' })).toMatchObject({ ok: false, reason: expect.stringMatching(/claudeWt\.projects/) });
    expect(read()).toBe(raw);
  });

  it('flow-запись проекта — отказ, а не исключение', () => {
    const raw = 'claudeWt:\n  projects:\n    - { name: a, cwd: /p/a }\n';
    fs.writeFileSync(file, raw);
    expect(setProjectType({ cwd: '/p/a', type: 'work' })).toMatchObject({ ok: false });
    expect(read()).toBe(raw);
  });

  it('тип первым ключом элемента: снять его патчер не может без дефиса — отказ сверкой', () => {
    const raw = 'claudeWt:\n  projects:\n    - type: work\n      name: a\n      cwd: /p/a\n';
    fs.writeFileSync(file, raw);
    expect(setProjectType({ cwd: '/p/a', type: null })).toMatchObject({ ok: false, reason: expect.stringMatching(/internal check/) });
    expect(read()).toBe(raw);
  });

  it('конфиг не разбирается — отказ', () => {
    const raw = 'claudeWt:\n  projects:\n    - [\n';
    fs.writeFileSync(file, raw);
    expect(setProjectType({ cwd: '/p/a', type: 'work' }).ok).toBe(false);
    expect(read()).toBe(raw);
  });
});

describe('parseProjectTypeRequest', () => {
  it('cwd без хвостового слэша, тип нормализован, пустой — null', () => {
    expect(parseProjectTypeRequest({ cwd: ' /p/a/ ', type: ' Work ' })).toEqual({ cwd: '/p/a', type: 'work' });
    expect(parseProjectTypeRequest({ cwd: '/p/a', type: '  ' })).toEqual({ cwd: '/p/a', type: null });
    expect(parseProjectTypeRequest({ cwd: '/p/a' })).toEqual({ cwd: '/p/a', type: null });
  });
});
