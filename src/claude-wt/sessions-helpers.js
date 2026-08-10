/** Pure helper functions for the ccfzf session dump. No external I/O. */
import { stripTitleDecoration } from './title-helpers.js';

/**
 * У записи есть собственная отметка активности, добытая ccfzf, а не той, что
 * ещё предстоит добыть пробой читателя.
 *
 * Общая калитка для `stampOf` (чем сравнивать тёзок) и для
 * `dumpNeedsHookStamps` в sessions.js (нужны ли этому дампу вообще сетевые
 * отметки хука). Одно правило — в одном месте: разъедься они, `stampOf` мог
 * бы однажды провалиться в пробу для записи, которую `dumpNeedsHookStamps`
 * уже сочла «со своей отметкой», — и `progressStamp` выпал бы из ключа кэша
 * sessions.js, хотя индекс от него уже зависит. Именно такое расхождение
 * между кэшем и его настоящей зависимостью пятнадцать минут привязывало окна
 * к id перезапустившихся сессий (см. MAX_AGE_MS в sessions.js).
 */
function hasHookStamp(s) {
  return Number.isFinite(s?.activityAt);
}

/**
 * Отметка активности сессии: своя, из дампа, либо добытая у читателя.
 *
 * Поле `activityAt` кладёт ccfzf: файлы `<id>.state.json` у него локальные, а
 * здесь они на сетевом диске, и мерить одно и то же с двух сторон незачем —
 * 354 сетевых stat на 200 сессий, 455 мс на перечитывание индекса. Ноль
 * значит «хук про эту сессию не писал», ровно то же, что возвращает сетевой
 * вызов при отсутствии файла.
 */
function stampOf(s, probe) {
  if (hasHookStamp(s)) return s.activityAt;
  return probe ? (probe(s?.id) ?? 0) : 0;
}

/**
 * Сравнение с учётом того, что говорят хуки самих агентов.
 *
 * Флаг `live` в дампе ccfzf бывает неверен: замерено 2026-08-01, когда две
 * сессии делили заголовок `shared` — работала та, у которой стояло
 * `live=false`, а `live=true` висело на старой. Хук же срабатывает на каждый
 * вызов инструмента реально работающего агента, поэтому свежая отметка от
 * него — довод сильнее любого флага в дампе.
 *
 * Если хук не установлен, обе отметки нулевые и всё сводится к прежнему
 * правилу.
 */
function byActivityThen(probe) {
  return (a, b) => {
    const diff = stampOf(b, probe) - stampOf(a, probe);
    return diff !== 0 ? diff : compareSessions(a, b);
  };
}

/** Newest live session wins: live first, then larger mtime. */
function compareSessions(a, b) {
  const aLive = a.live ? 1 : 0;
  const bLive = b.live ? 1 : 0;
  if (aLive !== bLive) return bLive - aLive;
  return (b.mtime ?? 0) - (a.mtime ?? 0);
}

/**
 * Заворачивает пробу в память на одну сборку индекса.
 *
 * Один и тот же id внутри группы тёзок сравнивается компаратором помногу
 * раз за время `sort()`, а следом ещё раз — отдельным вызовом `compare` для
 * поля `ambiguous`. Без памятки это значило `fs.statSync` по сетевому диску
 * на каждое такое обращение: 354 запроса на 200 сессий. Память живёт ровно
 * вызов `indexSessions` и не переживает его — за пределами одной сборки
 * отметка хука уже могла обновиться, и закешированный ответ был бы устаревшим.
 */
function memoize(probe) {
  const cache = new Map();
  return id => {
    if (!cache.has(id)) cache.set(id, probe(id));
    return cache.get(id);
  };
}

/**
 * Build a title -> session index out of a ccfzf dump.
 * A title shared by two equally good sessions is still marked ambiguous for
 * diagnostics, but the tracker binds to `best` anyway — refusing left windows
 * stranded when the dump could not break a tie.
 *
 * Keyed by the decoration-stripped title, because that is the form the window
 * title arrives in: the dump holds "Check branch commit count" while the window
 * shows "✳ Check branch commit count". Both sides are stripped by the same
 * function, so the two always line up. `title` keeps the dump's own spelling.
 */
function indexSessions(dump, activityAt) {
  const sessions = Array.isArray(dump?.sessions) ? dump.sessions : [];
  const byTitle = new Map();
  for (const s of sessions) {
    if (!s?.id || !s?.title) continue;
    // У фонового агента нет своего окна: он форкнут от родителя и живёт под
    // демоном. Заголовок при этом наследуется, так что в индексе он был бы
    // соперником родителю за его же окно — и выигрывал бы, потому что
    // работает именно он. Окно уехало бы к сессии, которой в нём нет.
    if (s.kind === 'background') continue;
    const key = stripTitleDecoration(s.title);
    if (!key) continue;
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(s);
  }
  // Память на всю сборку: id не повторяются между группами (у каждой сессии
  // свой), так что один Map безопасно накрывает и сортировку, и проверку
  // ambiguous во всех группах разом.
  const probe = activityAt ? memoize(activityAt) : activityAt;
  const index = {};
  for (const [key, list] of byTitle) {
    // Спрашивать про активность есть смысл только когда кандидатов больше
    // одного: у единственного всё равно нет соперника. Решение — за
    // stampOf: у него отметка из дампа своя, а до пробы он опускается
    // по каждой записи отдельно, а не по группе целиком — иначе одна
    // проштампованная соседка глушила бы пробу и той записи, у которой
    // поля нет.
    const compare = list.length > 1 ? byActivityThen(probe) : compareSessions;
    const sorted = [...list].sort(compare);
    const [best, second] = sorted;
    index[key] = {
      id: best.id,
      cwd: best.cwd ?? '',
      title: best.title,
      ambiguous: Boolean(second) && compare(best, second) === 0,
    };
  }
  return index;
}

/**
 * Родитель -> id его фоновых агентов, новейший первым.
 *
 * `claude agents` уводит сессию в фон: интерактивный процесс уходит, работа
 * продолжается в форке под демоном, а окно остаётся с заголовком родителя. Без
 * этой связи работающий агент не виден нигде — своего окна у него нет, а строка
 * родителя стоит с той сводкой, на которой он ушёл в фон.
 *
 * Родитель без окна (сессия закрыта, а агент работает) тоже сюда попадает:
 * решает, показывать ли такую строку, тот, у кого есть слоты.
 */
function indexBackgroundAgents(dump) {
  const sessions = Array.isArray(dump?.sessions) ? dump.sessions : [];
  const byParent = new Map();
  for (const s of sessions) {
    if (!s?.id || s.kind !== 'background' || !s.parent) continue;
    if (!byParent.has(s.parent)) byParent.set(s.parent, []);
    byParent.get(s.parent).push(s);
  }
  const index = {};
  for (const [parent, list] of byParent) {
    index[parent] = [...list]
      .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
      .map(s => ({ id: s.id, title: s.title ?? '', live: Boolean(s.live) }));
  }
  return index;
}

export { compareSessions, byActivityThen, stampOf, hasHookStamp, indexSessions, indexBackgroundAgents };
