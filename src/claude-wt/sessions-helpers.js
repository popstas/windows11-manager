/** Pure helper functions for the ccfzf session dump. No external I/O. */
import { stripTitleDecoration } from './title-helpers.js';

/**
 * Сравнение с учётом того, что говорят хуки самих агентов.
 *
 * Флаг `live` в дампе ccfzf бывает неверен: замерено 2026-08-01, когда две
 * сессии делили заголовок `shared` — работала та, у которой стояло
 * `live=false`, а `live=true` висело на старой. Хук же срабатывает на каждый
 * вызов инструмента реально работающего агента, поэтому свежая запись от него
 * — довод сильнее любого флага в дампе.
 *
 * Если хук не установлен, обе отметки нулевые и всё сводится к прежнему
 * правилу.
 */
function byActivityThen(activityAt) {
  return (a, b) => {
    const diff = (activityAt(b.id) ?? 0) - (activityAt(a.id) ?? 0);
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
  const index = {};
  for (const [key, list] of byTitle) {
    // Спрашивать про активность есть смысл только когда кандидатов больше
    // одного: у единственного всё равно нет соперника, а каждый вопрос — это
    // stat по сетевому диску.
    const compare = list.length > 1 && activityAt
      ? byActivityThen(activityAt)
      : compareSessions;
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

// Дамп штампует `generated` за миг до переименования, так что в норме
// содержимое отстаёт от mtime на доли секунды. Тридцать секунд — заведомо
// больше любой честной разницы и заведомо меньше промежутка между дампами.
const STALE_TOLERANCE_MS = 30000;

/**
 * Содержимое дампа старее, чем отметка файла, из которого оно прочитано.
 *
 * Так выглядит враньё SMB: `V:\.ccfzf.sessions.json` переписывается на pc-virt
 * локально (tmp + rename), мимо шары, — редиректор не узнаёт, что его кэш
 * чтения протух, и обновляет только метаданные. Замерено 2026-08-03: statSync
 * показывал свежий mtime, а readFileSync пятнадцать минут отдавал прежние
 * байты и прежний размер.
 *
 * Само по себе это ещё полбеды, но кэш индекса ключуется по mtime — устаревшие
 * байты закреплялись за новой отметкой, и сессия, открытая после прошлого
 * дампа, не появлялась нигде: ни в пикере, ни на плате.
 */
function isStaleRead(mtimeMs, generated) {
  const generatedMs = Number(generated) * 1000;
  if (!Number.isFinite(generatedMs) || !Number.isFinite(mtimeMs)) return false;
  return mtimeMs - generatedMs > STALE_TOLERANCE_MS;
}

export {
  compareSessions, byActivityThen, indexSessions, indexBackgroundAgents,
  isStaleRead, STALE_TOLERANCE_MS,
};
