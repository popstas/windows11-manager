import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Мокается модуль целиком, а не через vi.spyOn: sessions.js держит ссылку на
// импортированную функцию с момента импорта, и подмена свойства её не достанет.
//
// Для пустого каталога (``, что и шлют все тесты без явного progressDir) мок
// ведёт себя как настоящий progressStamp('') — стабильный 0, иначе старые
// тесты на кэш по mtime ловили бы лишний re-read просто от смены отметки на
// каждый вызов. Для непустого каталога отметка растёт с каждым вызовом — так
// в тестах ниже видно, действительно ли переход usesHookStamps в false
// перестаёт её спрашивать, а не просто совпадает по случайно одинаковому
// возврату.
const progressStamp = vi.hoisted(() => {
  let n = 0;
  return vi.fn(dir => (dir ? ++n : 0));
});
vi.mock('./progress.js', async (importOriginal) => ({
  ...await importOriginal(),
  progressStamp,
}));

import { loadSessionIndex, invalidateSessionIndex } from './sessions.js';

// loadSessionIndex keeps its cache at module scope, keyed by path. Every test
// therefore writes to its own file inside the temp dir, so nothing leaks from
// one case into the next.
let dir;
let n = 0;

const dumpWith = (...titles) => ({
  sessions: titles.map((title, i) => ({ id: `s${i}`, title, cwd: `/p${i}`, live: true, mtime: 100 + i })),
});

// То же самое, но с activityAt на каждой сессии — дамп, для которого
// usesHookStamps становится false и progressStamp выпадает из ключа кэша.
const withStamps = (...titles) => ({
  sessions: titles.map((title, i) => ({
    id: `s${i}`, title, cwd: `/p${i}`, live: true, mtime: 100 + i, activityAt: 1000 + i,
  })),
});

// Explicit mtimes: two writes in a row can land on the same timestamp, and
// "re-read only when the mtime changed" is exactly what is under test here.
const T0 = new Date(1700000000000);
const T1 = new Date(1700000005000);

function writeDump(filePath, dump, when) {
  fs.writeFileSync(filePath, JSON.stringify(dump));
  fs.utimesSync(filePath, when, when);
}

function freshPath() {
  return path.join(dir, `dump-${n++}.json`);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-wt-sessions-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('loadSessionIndex', () => {
  it('indexes a valid dump by title', () => {
    const p = freshPath();
    writeDump(p, dumpWith('ccfzf'), T0);
    expect(loadSessionIndex(p)).toEqual({
      ccfzf: { id: 's0', cwd: '/p0', title: 'ccfzf', ambiguous: false },
    });
  });

  it('does not re-read the file while its mtime is unchanged', () => {
    const p = freshPath();
    writeDump(p, dumpWith('ccfzf'), T0);
    const first = loadSessionIndex(p);
    // Содержимое подменено, mtime возвращён прежний: если бы файл читался
    // каждый раз, здесь появился бы 'home' — демон опрашивает раз в секунду,
    // а дамп меняется пару раз в день, ради этого кэш и существует.
    writeDump(p, dumpWith('home'), T0);
    expect(loadSessionIndex(p)).toEqual(first);
    expect(loadSessionIndex(p).home).toBeUndefined();
  });

  it('re-reads the file after its mtime changes', () => {
    const p = freshPath();
    writeDump(p, dumpWith('ccfzf'), T0);
    loadSessionIndex(p);
    writeDump(p, dumpWith('home'), T1);
    const index = loadSessionIndex(p);
    expect(index.home).toEqual({ id: 's0', cwd: '/p0', title: 'home', ambiguous: false });
    expect(index.ccfzf).toBeUndefined();
  });

  it('re-reads the file once the cached index is older than its max age', () => {
    const p = freshPath();
    writeDump(p, dumpWith('ccfzf'), T0);
    const base = 1_000_000;
    loadSessionIndex(p, '', base);
    // Тот же mtime, другое содержимое — ровно то, что видит долгоживущий
    // процесс на сетевом диске: клиент SMB отдаёт ему закэшированные атрибуты,
    // и кэш, который верит одному mtime, привязывает окна к сессиям, которых в
    // дампе давно нет.
    writeDump(p, dumpWith('home'), T0);
    expect(loadSessionIndex(p, '', base + 1000).home).toBeUndefined();
    expect(loadSessionIndex(p, '', base + 20000).home)
      .toEqual({ id: 's0', cwd: '/p0', title: 'home', ambiguous: false });
  });

  it('invalidateSessionIndex forces a re-read even within the age window', () => {
    const p = freshPath();
    writeDump(p, dumpWith('ccfzf'), T0);
    const base = 1_000_000;
    loadSessionIndex(p, '', base);
    writeDump(p, dumpWith('home'), T0);
    invalidateSessionIndex();
    expect(loadSessionIndex(p, '', base + 1000).home)
      .toEqual({ id: 's0', cwd: '/p0', title: 'home', ambiguous: false });
  });

  it('yields an empty index for a path that does not exist', () => {
    expect(loadSessionIndex(path.join(dir, 'never-written.json'))).toEqual({});
  });

  it('yields an empty index for an unparseable dump', () => {
    const p = freshPath();
    fs.writeFileSync(p, '{ half a write');
    expect(loadSessionIndex(p)).toEqual({});
  });

  it('yields an empty index for an empty path', () => {
    expect(loadSessionIndex('')).toEqual({});
  });

  it('keeps serving the last good index when the path becomes unreachable', () => {
    const p = freshPath();
    writeDump(p, dumpWith('ccfzf'), T0);
    const good = loadSessionIndex(p);
    // V: отвалился. Потерять все сессии из-за моргнувшего сетевого диска хуже,
    // чем отдать слегка устаревший индекс.
    fs.rmSync(p);
    expect(loadSessionIndex(p)).toEqual(good);
    expect(loadSessionIndex(p).ccfzf.id).toBe('s0');
  });

  it('does not serve another path\'s cached index when a path is unreachable', () => {
    const cached = freshPath();
    writeDump(cached, dumpWith('ccfzf'), T0);
    loadSessionIndex(cached);
    expect(loadSessionIndex(path.join(dir, 'other.json'))).toEqual({});
  });
});

describe('warning throttle', () => {
  // Свежая копия модуля: lastWarnedAt живёт в области модуля, и предупреждения
  // из тестов выше уже израсходовали бы первое окно.
  async function freshModule() {
    vi.resetModules();
    return (await import('./sessions.js')).loadSessionIndex;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns once per five minutes, not once per tick', async () => {
    const load = await freshModule();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const missing = path.join(dir, 'never-mounted.json');
    // Демон тикает раз в секунду по сетевому пути: отвалившийся V: без троттла
    // превращается в поток одинаковых строк в логе.
    load(missing);
    load(missing);
    load(missing);
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it('warns again after the interval has passed', async () => {
    const load = await freshModule();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const missing = path.join(dir, 'never-mounted.json');
    const base = Date.now();
    load(missing);
    vi.spyOn(Date, 'now').mockReturnValue(base + 6 * 60 * 1000);
    load(missing);
    expect(errors).toHaveBeenCalledTimes(2);
  });
});

describe('loadSessionIndex against a lying read cache', () => {
  // Кэш SMB отдаёт содержимое поколением назад, и отличить это чтение от
  // честного нельзя — поэтому дамп читается только после сброса кэша. Локально
  // сбрасывать нечего; здесь проверяется, что сам сброс ничего не ломает.
  it('reads the dump after asking the OS to drop what it cached', () => {
    const p = freshPath();
    writeDump(p, dumpWith('ccfzf'), T0);
    expect(loadSessionIndex(p).ccfzf.id).toBe('s0');
  });

  it('leaves the file it opened untouched', () => {
    // Открытие на запись — единственный способ сломать read lease, но писать в
    // дамп мы не имеем права: его владелец на той стороне.
    const p = freshPath();
    writeDump(p, dumpWith('ccfzf'), T0);
    const before = fs.readFileSync(p, 'utf8');
    loadSessionIndex(p);
    expect(fs.readFileSync(p, 'utf8')).toBe(before);
  });

  it('still reads a dump it cannot open for writing', () => {
    const p = freshPath();
    writeDump(p, dumpWith('ccfzf'), T0);
    fs.chmodSync(p, 0o444);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(loadSessionIndex(p).ccfzf.id).toBe('s0');
    } finally {
      errors.mockRestore();
      fs.chmodSync(p, 0o644);
    }
  });
});

describe('loadSessionIndex и отметка каталога состояний', () => {
  it('перестаёт статить каталог состояний, когда дамп несёт activityAt', () => {
    // progressStamp — сетевой stat на V: в каждом тике демона, то есть раз в
    // секунду. Он там только ради зависимости, которой больше нет.
    const p = freshPath();
    writeDump(p, withStamps('ccfzf'), T0);
    loadSessionIndex(p, '/progress');            // первое чтение: ещё не знаем
    progressStamp.mockClear();
    writeDump(p, withStamps('ccfzf'), T1);
    loadSessionIndex(p, '/progress');
    expect(progressStamp).not.toHaveBeenCalled();
  });

  it('продолжает статить каталог, когда дамп поля не несёт', () => {
    const p = freshPath();
    writeDump(p, dumpWith('ccfzf'), T0);
    loadSessionIndex(p, '/progress');
    progressStamp.mockClear();
    writeDump(p, dumpWith('ccfzf'), T1);
    loadSessionIndex(p, '/progress');
    expect(progressStamp).toHaveBeenCalled();
  });

  // Опасная половина: одних только счётчиков вызовов недостаточно, потому что
  // они ничего не говорят о самом индексе. Ниже — те же три сценария
  // инвалидации, что и в 'loadSessionIndex' выше (смена mtime, MAX_AGE_MS,
  // invalidateSessionIndex), но на дампе с activityAt на каждой сессии —
  // именно там, где progressStamp выпадает из ключа кэша, и где регресс в
  // индексации был бы не пойман старыми тестами (у dumpWith() поля нет).
  it('re-reads the file after its mtime changes, even once progressStamp stops being consulted', () => {
    const p = freshPath();
    writeDump(p, withStamps('ccfzf'), T0);
    loadSessionIndex(p, '/progress');             // учится: usesHookStamps === false
    progressStamp.mockClear();
    writeDump(p, withStamps('home'), T1);
    const index = loadSessionIndex(p, '/progress');
    expect(progressStamp).not.toHaveBeenCalled();
    expect(index.home).toEqual({ id: 's0', cwd: '/p0', title: 'home', ambiguous: false });
    expect(index.ccfzf).toBeUndefined();
  });

  it('re-reads once the cached index is older than max age, even with activityAt on every session', () => {
    const p = freshPath();
    writeDump(p, withStamps('ccfzf'), T0);
    const base = 1_000_000;
    loadSessionIndex(p, '/progress', base);       // учится: usesHookStamps === false
    // Ровно на этом, первом после установления режима чтении кэшевый stamp
    // ещё хранит настоящее, ненулевое значение progressStamp с того момента,
    // когда режим ещё не был известен, — а вычисленный stamp уже 0, раз
    // usesHookStamps теперь false. Несовпадение бьёт по условию кэша и
    // безопасно, но один раз пересобирает дамп заново, даже без смены mtime.
    // Даём этому осесть до начала отсчёта MAX_AGE_MS, иначе тест ловил бы
    // этот безвредный лишний пересбор, а не то, что проверяет.
    loadSessionIndex(p, '/progress', base);
    progressStamp.mockClear();
    // Тот же mtime, другое содержимое — врущий SMB-кэш; без stamp в ключе
    // единственная страховка здесь — срок годности MAX_AGE_MS.
    writeDump(p, withStamps('home'), T0);
    expect(loadSessionIndex(p, '/progress', base + 1000).home).toBeUndefined();
    expect(loadSessionIndex(p, '/progress', base + 20000).home)
      .toEqual({ id: 's0', cwd: '/p0', title: 'home', ambiguous: false });
    expect(progressStamp).not.toHaveBeenCalled();
  });

  it('invalidateSessionIndex forces a re-read even with activityAt on every session', () => {
    const p = freshPath();
    writeDump(p, withStamps('ccfzf'), T0);
    const base = 1_000_000;
    loadSessionIndex(p, '/progress', base);       // учится: usesHookStamps === false
    progressStamp.mockClear();
    writeDump(p, withStamps('home'), T0);
    invalidateSessionIndex();
    // Сброс кэша забывает и usesHookStamps: следующее чтение снова «не знает»
    // и опять спрашивает сеть — ровно как первое чтение нового пути.
    expect(loadSessionIndex(p, '/progress', base + 1000).home)
      .toEqual({ id: 's0', cwd: '/p0', title: 'home', ambiguous: false });
    expect(progressStamp).toHaveBeenCalled();
  });
});
