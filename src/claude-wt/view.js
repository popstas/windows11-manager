import fs from 'node:fs';
import { getWindows } from '../windows.js';
import { getMons } from '../monitors.js';
import { readState } from './state.js';
import { loadSessionIndexFor, loadBackgroundAgentsFor, loadShellSessionsFor, loadSessionIndexAndOwnersFor } from './sessions.js';
import { resolveSession } from './tracker-helpers.js';
import { stripTitleDecoration } from './title-helpers.js';
import { getClaudeWtConfig, isTerminalWindow } from './index.js';
import { buildSessionList, agentIds } from './view-helpers.js';
import { loadProgress } from './progress.js';
import { seenSinceUpdate } from './progress-helpers.js';
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
  const sessionIndex = loadSessionIndexFor(cfg);
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
function claudeWtSessions({ mark = noTiming, brief = false, openOnly = false } = {}) {
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
  const agents = loadBackgroundAgentsFor(cfg);
  // `openOnly` — состояние и мета только у открытых: закрытые строки в списке
  // остаются, но без полей агента. Окна уже сопоставлены (`openMap`), и это
  // ничего не стоит, а слотов на машине копятся сотни — на ноутбуке 458 давали
  // ~900 обращений по SMB за вызов и около десяти секунд занятой службы.
  const openIds = openOnly ? new Set(openMap.keys()) : null;
  const ids = agentIds({ slotIds, agents, openIds });
  mark('sessions:agents');
  const progress = brief ? {} : loadProgress(cfg.progressDir, ids);
  mark('sessions:progress');
  const metaIds = openIds ? slotIds.filter(id => openIds.has(id)) : slotIds;
  const meta = brief ? {} : loadMeta(cfg.progressDir, metaIds);
  mark('sessions:meta');
  const list = buildSessionList({
    slots: state.slots, openMap, mons: getMons(), progress, meta, agents,
  });
  mark('sessions:build');
  return { ok: true, sessions: list };
}

/**
 * Сессия за каждым из перечисленных окон: [{id, title}] → [{id, sessionId, cwd}].
 *
 * Для служб, которые оформляют окна claude снаружи: кнопку на панели задач
 * (src/mqtt/taskbar.js) и иконку окна (src/mqtt/window-icons.js). Окна они
 * находят сами и дёшево; здесь только сопоставление заголовка с сессией. В
 * отличие от claudeWtSessions(), без getWindows() (~30 мс), прогресса и меты:
 * зовут это раз в несколько секунд. Индекс кэшируется у своего загрузчика.
 *
 * Окно без сессии в ответ не попадает.
 */
function claudeWtWindowSessions(windows) {
  const cfg = getClaudeWtConfig();
  if (!cfg.enabled || !cfg.statePath || !windows?.length) return [];
  const state = readState(cfg.statePath);
  // Владелец сессии (projectCwd дампа) — по id, поэтому и у окна, найденного
  // по своей истории заголовков, а не по дампу: иконка и значки worktree —
  // основного проекта. Один проход по дампам на оба: каждый — сетевой stat.
  const { index, owners } = loadSessionIndexAndOwnersFor(cfg);
  const out = [];
  for (const w of windows) {
    // Заголовок без префиксов zellij/WezTerm: по нему ищется сессия и по нему
    // же — значок проекта (badges, src/claude-wt/window-icons-helpers.js).
    const title = stripTitleDecoration(w.title);
    const hit = resolveSession(title, index, state.slots);
    if (!hit) continue;
    const slot = state.slots[hit.id];
    out.push({
      id: w.id, sessionId: hit.id, cwd: hit.cwd || slot?.cwd || '', projectCwd: owners[hit.id] ?? '',
      focusedAt: slot?.focusedAt ?? 0, unreadAt: slot?.unreadAt ?? 0, title,
    });
  }
  return out;
}

/**
 * То же плюс состояние агента: [{id, title}] → [{id, sessionId, cwd, agentState, agentSeen, agentUpdated,
 * agentQuiet, agentUnread, shell}].
 * С сети читаются state.json только переданных окон (кэш 3 с у loadProgress).
 * `agentSeen` — окно выходило вперёд после последней записи агента
 * (`seenSinceUpdate`, тот же признак, что у пикера и панели). `shell` — ход
 * закончен, а фоновая команда идёт (`loadShellSessions`, из дампа ccfzf).
 * `agentQuiet` — хук назвал конец хода тихим (`quiet` в state.json, только у
 * review/idle). `agentUnread` — в слоте стоит «непросмотрено» от
 * `claude-session-unread` новее фокуса окна: та отметка переживает запись хука
 * и поэтому сильнее quiet (отметка службы `markHolds` сгорает на stop).
 */
function claudeWtWindowAgents(windows) {
  const resolved = claudeWtWindowSessions(windows);
  if (!resolved.length) return [];
  const cfg = getClaudeWtConfig();
  const progress = loadProgress(cfg.progressDir, resolved.map(r => r.sessionId));
  const shells = loadShellSessionsFor(cfg);
  return resolved.map(r => ({
    ...r,
    agentState: progress[r.sessionId]?.state ?? null,
    agentSeen: seenSinceUpdate({ focusedAt: r.focusedAt }, progress[r.sessionId]),
    agentUpdated: progress[r.sessionId]?.updated ?? 0,
    agentQuiet: progress[r.sessionId]?.quiet === true,
    agentUnread: r.unreadAt > 0 && r.unreadAt > r.focusedAt,
    shell: shells.has(r.sessionId),
  }));
}

/**
 * Id сессий, у которых есть метка head (<sessionId>.json в каталоге меток).
 *
 * Метку никто не удаляет, она «действует, пока сессия жива». Здесь этого
 * достаточно: спрашивают только про сессии с открытым окном, а открытое окно и
 * есть живая сессия. Поэтому читается только список файлов, без содержимого.
 */
function claudeWtHeadIds(dir) {
  if (!dir) return new Set();
  try {
    return new Set(fs.readdirSync(dir)
      .filter(name => name.endsWith('.json') && !name.startsWith('.'))
      .map(name => name.slice(0, -'.json'.length)));
  } catch {
    return new Set();
  }
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

export {
  openSessionMap, claudeWtSessions, claudeWtWindowSessions, claudeWtWindowAgents, claudeWtHeadIds, claudeWtSnapshots,
};
