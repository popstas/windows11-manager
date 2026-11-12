import { describe, it, expect, vi } from 'vitest';
import { parseSessionNewRequest, normalizeChildCwdRoot, childCwdUnderRoot } from './session-new-helpers.js';

const PROJECTS = [{ name: 'ExpertizeMe', cwd: '/vault' }];
const ID = '11111111-2222-4333-8444-555555555555';
const OPTS = { projects: PROJECTS, newId: () => ID };

const BODY = { cwd: '/vault', name: 'task-a', promptFile: '/tmp/head/task-a.md' };

describe('parseSessionNewRequest', () => {
  it('fills the optional values with `-` and generates the session id', () => {
    expect(parseSessionNewRequest(BODY, OPTS)).toEqual({
      ok: true,
      vars: {
        cwd: '/vault',
        name: 'task-a',
        sessionId: ID,
        promptFile: '/tmp/head/task-a.md',
        permissionMode: '-',
        head: '-',
        headId: '-',
        childCwdRoot: '',
      },
      zone: null,
      profileCwd: '/vault',
    });
  });

  it('keeps the id, mode and head the request named', () => {
    const own = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const res = parseSessionNewRequest({
      ...BODY, sessionId: own, permissionMode: 'auto', head: 'head-session-auto', headId: ID,
    }, OPTS);
    expect(res.vars).toMatchObject({ sessionId: own, permissionMode: 'auto', head: 'head-session-auto', headId: ID });
  });

  it.each(['cwd', 'name', 'promptFile'])('400 without %s', (key) => {
    const res = parseSessionNewRequest({ ...BODY, [key]: '  ' }, OPTS);
    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(res.reason).toContain(key);
  });

  it('403 for a cwd outside claudeWt.projects', () => {
    const res = parseSessionNewRequest({ ...BODY, cwd: '/etc' }, OPTS);
    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(res.reason).toContain('/etc');
  });

  // Белый список — точное совпадение: «внутри проекта» значило бы разбирать
  // `..` в чужом пути, а ошибка там открыла бы запуск агента в любом каталоге.
  it('403 for a subfolder of a listed project', () => {
    expect(parseSessionNewRequest({ ...BODY, cwd: '/vault/sub' }, OPTS).status).toBe(403);
  });

  it('400 for a session id that is not a uuid', () => {
    expect(parseSessionNewRequest({ ...BODY, sessionId: 'abc' }, OPTS)).toMatchObject({ ok: false, status: 400 });
  });

  // Правила обёртки ~/bin/claude-wt-new: имя и head — не опция для claude,
  // headId — uuid. Она ответила бы exit 2 на той стороне ssh, и окно
  // закрылось бы молча; здесь — 400 с причиной.
  it.each([['name', '-x'], ['head', '--bad']])('400 for %s starting with a dash', (key, value) => {
    expect(parseSessionNewRequest({ ...BODY, [key]: value }, OPTS)).toMatchObject({ ok: false, status: 400 });
  });

  it('400 for a headId that is not a uuid', () => {
    expect(parseSessionNewRequest({ ...BODY, headId: 'boss' }, OPTS)).toMatchObject({ ok: false, status: 400 });
  });

  // Решение Стаса (11.11): маршрут без авторизации, и любой в сети иначе
  // открыл бы агента без единого вопроса. Остальные режимы — как есть.
  it('400 for bypassPermissions', () => {
    const res = parseSessionNewRequest({ ...BODY, permissionMode: 'bypassPermissions' }, OPTS);
    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(res.reason).toContain('bypassPermissions');
  });

  it.each(['acceptEdits', 'auto', 'manual', 'dontAsk', 'plan'])('accepts permission mode %s', (mode) => {
    expect(parseSessionNewRequest({ ...BODY, permissionMode: mode }, OPTS).vars.permissionMode).toBe(mode);
  });

  it('400 for an unknown permission mode', () => {
    expect(parseSessionNewRequest({ ...BODY, permissionMode: 'yolo' }, OPTS)).toMatchObject({ ok: false, status: 400 });
  });

  // `;` для wt.exe — разделитель панелей в любом месте командной строки, а
  // кавычки и `$` ломают позиционные аргументы удалённого шелла.
  it.each([
    ['name', 'a;b'],
    ['promptFile', '/tmp/a;b.md'],
    ['cwd', '/vault;x'],
    ['head', 'he$ad'],
    ['headId', 'x"y'],
    ['head', 'a\tb'],
    ['name', 'a\nb'],
  ])('400 for %s that the launch command cannot carry', (key, value) => {
    expect(parseSessionNewRequest({ ...BODY, [key]: value }, OPTS)).toMatchObject({ ok: false, status: 400 });
  });

  // Зона окна ребёнка (окна head и детей по зонам FancyZones): пара обязана
  // быть из claudeWt.headZones, иначе 400 — голове есть кому сказать.
  describe('zone', () => {
    const HZ = { 1: [3, 4], 3: [1, 4] };

    it('zone из headZones проходит', () => {
      expect(parseSessionNewRequest({ ...BODY, zone: { monitor: 1, position: 4 } }, { ...OPTS, headZones: HZ }).zone)
        .toEqual({ monitor: 1, position: 4 });
    });

    it('без zone — null', () => {
      expect(parseSessionNewRequest(BODY, { ...OPTS, headZones: HZ }).zone).toBeNull();
      expect(parseSessionNewRequest({ ...BODY, zone: null }, { ...OPTS, headZones: HZ }).zone).toBeNull();
    });

    it('zone не трогает переменные шаблона запуска', () => {
      const res = parseSessionNewRequest({ ...BODY, zone: { monitor: 1, position: 4 } }, { ...OPTS, headZones: HZ });
      expect(res.vars).not.toHaveProperty('zone');
    });

    it.each([
      ['строки', { monitor: '1', position: '4' }],
      ['дробь', { monitor: 1, position: 4.5 }],
      ['не пара headZones', { monitor: 1, position: 1 }],
      ['монитора нет', { monitor: 2, position: 1 }],
      ['массив', [1, 4]],
      ['строка', '1:4'],
    ])('400 для zone: %s', (_, zone) => {
      expect(parseSessionNewRequest({ ...BODY, zone }, { ...OPTS, headZones: HZ })).toMatchObject({ ok: false, status: 400 });
    });

    it('в отказе перечислены допустимые зоны', () => {
      const res = parseSessionNewRequest({ ...BODY, zone: { monitor: 1, position: 1 } }, { ...OPTS, headZones: HZ });
      expect(res.reason).toContain('1:3, 1:4, 3:1, 3:4');
    });

    it('zone при пустых headZones — 400 с причиной про headZones', () => {
      const res = parseSessionNewRequest({ ...BODY, zone: { monitor: 1, position: 4 } }, OPTS);
      expect(res).toMatchObject({ ok: false, status: 400 });
      expect(res.reason).toContain('headZones');
    });
  });

  it('accepts a JSON string body', () => {
    expect(parseSessionNewRequest(JSON.stringify(BODY), OPTS).ok).toBe(true);
  });

  it('400 for a body that is not an object', () => {
    expect(parseSessionNewRequest('nope', OPTS)).toMatchObject({ ok: false, status: 400 });
  });
});

// Корень каталогов детей head (spawn по проекту head): ребёнок может открыться
// в любом подкаталоге корня, но не в нём самом и не снаружи.
describe('childCwdRoot', () => {
  const ROOT = '/home/popstas/projects';

  it.each([
    ['/home/popstas/projects', '/home/popstas/projects'],
    ['/home/popstas/projects/', '/home/popstas/projects'],
    [' /home/popstas//projects ', '/home/popstas/projects'],
    ['projects', ''], ['/', ''], ['', ''], [undefined, ''], [42, ''],
  ])('normalizeChildCwdRoot(%j) -> %j', (raw, want) => expect(normalizeChildCwdRoot(raw)).toBe(want));

  it('путь под корнем проходит нормализованным', () => {
    expect(childCwdUnderRoot('/home/popstas/projects//js/a/', ROOT)).toEqual({ ok: true, path: '/home/popstas/projects/js/a' });
  });

  it('пути-ловушки', () => {
    expect(childCwdUnderRoot('/home/popstas/projects/../.ssh', ROOT)).toMatchObject({ ok: false, status: 403 });
    expect(childCwdUnderRoot('/home/popstas/projectsX/a', ROOT)).toMatchObject({ ok: false, status: 403 });
    expect(childCwdUnderRoot('/home/popstas/projects', ROOT)).toMatchObject({ ok: false, status: 403 });
    expect(childCwdUnderRoot('/home/popstas/projects/', ROOT)).toMatchObject({ ok: false, status: 403 });
    expect(childCwdUnderRoot('projects/js/a', ROOT)).toMatchObject({ ok: false, status: 400 });
    expect(childCwdUnderRoot('/etc', ROOT).reason).toContain('claudeWt.childCwdRoot');
  });
});

// Второй проход: каталог ребёнка не в claudeWt.projects, но под childCwdRoot,
// проект head — в списке или тоже под корнем, окно head открыто здесь.
describe('ребёнок head вне claudeWt.projects', () => {
  const ROOT = '/home/popstas/projects';
  const EXP = '/home/popstas/projects/text/obsidian/ExpertizeMe';
  const PROJ = [{ cwd: '/vault' }, { cwd: EXP }];
  const HEAD = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const AMN = '/home/popstas/projects/js/amnezia-shared-panel';
  const CHILD = { ...BODY, cwd: AMN, headId: HEAD, headCwd: EXP };
  const opts = (live = vi.fn(id => id === HEAD), extra = {}) => ({
    projects: PROJ, newId: () => ID, childCwdRoot: ROOT, isLiveHead: live, ...extra,
  });

  it('ребёнок head под корнем проходит', () => {
    const live = vi.fn(id => id === HEAD);
    const res = parseSessionNewRequest(CHILD, opts(live));
    expect(res.ok).toBe(true);
    expect(res.vars.cwd).toBe(AMN);
    expect(res.vars.childCwdRoot).toBe(ROOT);
    expect(live).toHaveBeenCalledWith(HEAD);
  });

  it('profileCwd: свой из списка, иначе присланный из списка, иначе свой', () => {
    expect(parseSessionNewRequest({ ...CHILD, profileCwd: '/vault' }, opts()).profileCwd).toBe('/vault');
    expect(parseSessionNewRequest({ ...CHILD, profileCwd: '/nope' }, opts()).profileCwd).toBe(AMN);
    expect(parseSessionNewRequest({ ...BODY, profileCwd: EXP }, opts()).profileCwd).toBe('/vault');
  });

  it('выдуманный headId — 403', () => {
    const fake = '11111111-2222-4333-8444-555555555555';
    const live = vi.fn(() => false);
    const res = parseSessionNewRequest({ ...CHILD, headId: fake }, opts(live));
    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(res.reason).toContain('no window');
    expect(live).toHaveBeenCalledWith(fake);
  });

  it('без headId вне списка — 403 как раньше', () => {
    const noHead = { ...CHILD, headId: undefined };
    const res = parseSessionNewRequest(noHead, opts());
    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(res.reason).toContain('is not in claudeWt.projects');
  });

  it('без childCwdRoot нового прохода нет', () => {
    const live = vi.fn(() => true);
    const res = parseSessionNewRequest(CHILD, opts(live, { childCwdRoot: '' }));
    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(res.reason).toContain('childCwdRoot is not set');
    expect(live).not.toHaveBeenCalled();
  });

  it('старый проход не спрашивает живость и не передаёт корень', () => {
    const live = vi.fn(() => false);
    const res = parseSessionNewRequest({ ...BODY, headId: HEAD }, opts(live));
    expect(res.ok).toBe(true);
    expect(live).not.toHaveBeenCalled();
    expect(res.vars.childCwdRoot).toBe('');
  });

  it('headCwd: корень, чужой, мусор', () => {
    expect(parseSessionNewRequest({ ...CHILD, headCwd: ROOT }, opts())).toMatchObject({ ok: false, status: 403 });
    expect(parseSessionNewRequest({ ...CHILD, headCwd: '/opt/x' }, opts())).toMatchObject({ ok: false, status: 403 });
    const noHeadCwd = { ...CHILD, headCwd: undefined };
    const missing = parseSessionNewRequest(noHeadCwd, opts());
    expect(missing).toMatchObject({ ok: false, status: 403 });
    expect(missing.reason).toContain('headCwd');
    expect(parseSessionNewRequest({ ...CHILD, headCwd: '/home/popstas/projects/a;b' }, opts())).toMatchObject({ ok: false, status: 400 });
  });

  it('headCwd под корнем годится — внук', () => {
    const res = parseSessionNewRequest({ ...CHILD, headCwd: AMN, cwd: '/home/popstas/projects/js/other' }, opts());
    expect(res.ok).toBe(true);
  });

  it('пути-ловушки через запрос', () => {
    expect(parseSessionNewRequest({ ...CHILD, cwd: '/home/popstas/projects/../.ssh' }, opts())).toMatchObject({ ok: false, status: 403 });
    expect(parseSessionNewRequest({ ...CHILD, cwd: 'js/a' }, opts())).toMatchObject({ ok: false, status: 400 });
  });
});
