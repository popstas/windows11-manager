import { getWindows } from '../windows.js';
import { getMons } from '../monitors.js';
import { readState } from './state.js';
import { loadSessionIndex, loadBackgroundAgents } from './sessions.js';
import { resolveSession } from './tracker-helpers.js';
import { stripTitleDecoration } from './title-helpers.js';
import { getClaudeWtConfig, isTerminalWindow } from './index.js';
import { buildSessionList } from './view-helpers.js';
import { loadProgress } from './progress.js';
import { loadMeta } from './meta.js';
import { listSnapshots } from './snapshotter.js';
import { noTiming } from './timing.js';

/**
 * Session id -> hwnd for every claude terminal on screen right now.
 *
 * openSessionIds() answers the same question but throws the handle away, and
 * the picker cannot focus a window it has no handle for.
 */
function openSessionMap(cfg, state) {
  const sessionIndex = loadSessionIndex(cfg.sessionsFile, cfg.progressDir);
  const map = new Map();
  for (const w of getWindows().filter(isTerminalWindow)) {
    const resolved = resolveSession(stripTitleDecoration(w.getTitle()), sessionIndex, state.slots);
    if (!resolved) continue;
    // Same title on two windows: keep the larger hwnd (newest). Ties in the
    // dump no longer block — resolveSession already picked a best id.
    const prev = map.get(resolved.id);
    if (prev === undefined || w.id > prev) map.set(resolved.id, w.id);
  }
  return map;
}

/**
 * Everything the picker needs about claude sessions, open and closed.
 *
 * State comes from disk rather than the daemon's in-memory copy: the daemon
 * writes on every change of the layout fingerprint, so the file is current, and
 * reading it keeps this usable from a process that is not running the watcher.
 *
 * `mark` — секундомер звеньев (`./timing.js`), и по умолчанию его нет: почти
 * всё здесь читается с сетевого диска, а зовут эту функцию и пикер, и экспорт
 * в Home Assistant. Разбивка нужна только в горячем пути открытия сессии, где
 * человек ждёт; в остальных вызовах она забила бы журнал.
 *
 * `brief` — список без состояния агента: пропускаются `loadProgress` и
 * `loadMeta`, и вместе с ними единственные два звена, которые здесь чего-то
 * стоят. Замер на popstas-pc: состояние, окна и фоновые агенты — 19 мс на всё,
 * прогресс — 669 мс, мета — 760 мс; каталог лежит на сетевом диске, и читается
 * из него файл на сессию. Зовущему, который решает «есть ли открытое окно
 * этого каталога», ни то, ни другое не нужно: `meta` в таком решении не
 * участвует вовсе, а `progress` — только тай-брейком при равном `focusedAt`,
 * где `lastActivityAt()` и так падает на `slot.lastSeen`. Пикеру список нужен
 * целиком — ему полтора лишних поля и есть весь смысл списка.
 */
function claudeWtSessions({ mark = noTiming, brief = false } = {}) {
  const cfg = getClaudeWtConfig();
  if (!cfg.enabled) return { ok: false, reason: 'claudeWt.enabled is false in config' };
  if (!cfg.statePath) return { ok: false, reason: 'claudeWt.statePath is not set in config' };
  const state = readState(cfg.statePath);
  mark('sessions:state');
  const openMap = openSessionMap(cfg, state);
  mark('sessions:openMap');
  // Прогресс и мета читаются только здесь — то есть пока открыт пикер. Каталог
  // лежит на сетевом диске, и в тике демона им не место.
  const slotIds = Object.keys(state.slots);
  // Фоновый агент пишет состояние под своим id, а слота у него нет: без этого
  // его файл никто бы не прочитал, и работающая сессия выглядела бы замершей
  // на том, что сказала перед уходом в фон.
  const agents = loadBackgroundAgents(cfg.sessionsFile, cfg.progressDir);
  const ids = [...new Set(slotIds.concat(
    slotIds.flatMap(id => (agents[id] ?? []).map(child => child.id)),
  ))];
  mark('sessions:agents');
  const progress = brief ? {} : loadProgress(cfg.progressDir, ids);
  mark('sessions:progress');
  const meta = brief ? {} : loadMeta(cfg.progressDir, slotIds);
  mark('sessions:meta');
  const list = buildSessionList({
    slots: state.slots, openMap, mons: getMons(), progress, meta, agents,
  });
  mark('sessions:build');
  return { ok: true, sessions: list };
}

/**
 * Remembered layouts for the picker / MQTT menu.
 *
 * Reads the snapshots file directly so this works even when the daemon is not
 * the process answering the call (windows-mqtt loads the library separately).
 */
function claudeWtSnapshots() {
  const cfg = getClaudeWtConfig();
  if (!cfg.enabled) return { ok: false, reason: 'claudeWt.enabled is false in config' };
  try {
    return { ok: true, snapshots: listSnapshots(cfg) };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

export { openSessionMap, claudeWtSessions, claudeWtSnapshots };
