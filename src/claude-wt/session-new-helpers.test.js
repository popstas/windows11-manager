import { describe, it, expect } from 'vitest';
import { parseSessionNewRequest } from './session-new-helpers.js';

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
      },
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

  it('accepts a JSON string body', () => {
    expect(parseSessionNewRequest(JSON.stringify(BODY), OPTS).ok).toBe(true);
  });

  it('400 for a body that is not an object', () => {
    expect(parseSessionNewRequest('nope', OPTS)).toMatchObject({ ok: false, status: 400 });
  });
});
