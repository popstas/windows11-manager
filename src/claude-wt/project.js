import { spawn } from 'node:child_process';
import { focusWindowById, getWindowById, getWindows } from '../windows.js';
import { virtualDesktop } from '../virtual-desktop.js';
import { getClaudeWtConfig, isTerminalWindow } from './index.js';
import { claudeWtSessions } from './view.js';
import { stripTitleDecoration } from './title-helpers.js';
import { pickOpenProjectSession, planLaunchNew, profileForTerminal, sessionNameFor } from './project-helpers.js';
import { isLegacyLaunch, resolveTerminal } from './terminal-helpers.js';

async function focusTerminalWindow(windowId) {
  try {
    const current = await virtualDesktop.GetWindowDesktopNumber(windowId);
    if (current !== undefined && current !== null && current !== '') {
      const target = Number(current);
      if (!Number.isNaN(target)) await virtualDesktop.GoToDesktopNumber(target);
    }
  } catch {
    // Focus still worth trying if the desktop query fails.
  }
  return focusWindowById(windowId);
}

/**
 * Open WT window whose decoration-stripped title equals `title`.
 * Covers the gap before the ccfzf dump catches up and the daemon binds a slot.
 */
function findOpenTerminalByTitle(title) {
  const want = stripTitleDecoration(title);
  if (!want) return null;
  for (const w of getWindows().filter(isTerminalWindow)) {
    if (stripTitleDecoration(w.getTitle()) === want) return w;
  }
  return null;
}

// Окно ждём дольше, чем кажется нужным: `wt.exe` рисуется за полсекунды, но
// заголовок ему ставит уже сам `claude -n`, а тот поднимается на удалённой
// машине через ssh. Пятнадцать секунд — с запасом на холодный старт; не нашли
// за это время — значит и не найдём, а не «подождём ещё».
const WINDOW_WAIT_MS = 15000;
const WINDOW_POLL_MS = 250;
// Пауза между появлением окна и фокусом. За неё успевают оба, кто двигает окно
// новой сессии: автопостановщик (такт 1.5 с плюс задержка 1 с) и демон
// claude-wt, привязывающий сессию к слоту за два тика и способный увести окно
// на чужой стол. Фокус, взятый раньше них, у человека отберут — переход на
// другой стол оставляет передним что придётся.
const PLACEMENT_SETTLE_MS = 4000;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Дождаться окна только что запущенной сессии и сфокусировать его.
 *
 * Зачем это вообще нужно: `wt.exe` запускает фоновый процесс службы MQTT, а
 * Windows отдаёт передний план только процессу, который им уже владеет либо
 * получил последнее событие ввода. Новый терминал — ни то, ни другое, и его
 * окно то открывается за чужими, то вовсе оказывается свёрнутым; выглядит это
 * случайным, потому что случайно и есть — гонка с тем, кто в этот момент
 * владеет передним планом. Здесь окно поднимают явно, и это работает без
 * всякой грамоты: `bringToTop()` в node-window-manager подцепляет свой ввод к
 * потоку переднего окна (`AttachThreadInput`), а такой подъём Windows не
 * запрещает.
 *
 * Фокус идёт через `focusTerminalWindow`, а не через голый `focusWindowById`:
 * демон к этому моменту мог увести окно на стол слота, а фокус на окне с
 * чужого стола Windows отдаёт молча и без результата.
 *
 * Зависимости — аргументами: без них проверить можно было бы только настоящие
 * четыре секунды ожидания.
 */
async function focusSpawnedWindow(title, deps = {}) {
  const {
    findWindow = findOpenTerminalByTitle,
    focus = focusTerminalWindow,
    wait = sleep,
    now = Date.now,
    waitMs = WINDOW_WAIT_MS,
    pollMs = WINDOW_POLL_MS,
    settleMs = PLACEMENT_SETTLE_MS,
  } = deps;
  const deadline = now() + waitMs;
  let w = findWindow(title);
  while (!w && now() < deadline) {
    await wait(pollMs);
    w = findWindow(title);
  }
  if (!w) return false;
  await wait(settleMs);
  return focus(w.id);
}

/**
 * Focus the last open Claude session for a project cwd, or spawn a fresh
 * `claude -n <name>` there when none is on screen — `<name>` defaults to
 * `basename(cwd)`, but at `reuseOpen: false` it comes straight from the
 * request body instead (see below).
 *
 * `reuseOpen: false` — «заведи ещё одну»: оба поиска пропускаются, и терминал
 * открывается всегда. Просьба приходит от `^N` в ccfzf-picker, где человек
 * нажимает её именно потому, что сессия уже есть и нужна вторая. Умолчание
 * `true` оставляет проектный хоткей и Enter прежними.
 *
 * Ответ возвращается сразу после `spawn`, но работа на этом не кончается:
 * окно новой сессии поднимает `focusSpawnedWindow` отдельным хвостом — см.
 * его докстроку о том, почему без этого терминал открывается за чужими окнами
 * или свёрнутым. Найденное окно (обе ветки `focus*`) поднимается на месте:
 * там ждать нечего, окно уже стоит там, где стояло.
 *
 * @param {{ cwd: string, name: string, profile?: string, reuseOpen?: boolean, terminal?: string }} opts
 * @returns {Promise<{ ok: boolean, action?: string, reason?: string, sessionId?: string, sessionName?: string }>}
 */
async function openClaudeProject({ cwd, name, profile, reuseOpen = true, terminal } = {}) {
  if (typeof cwd !== 'string' || !cwd || typeof name !== 'string' || !name) {
    return { ok: false, reason: 'cwd and name are required' };
  }
  const sessionName = sessionNameFor({ cwd, name, reuseOpen });

  // Просьбе «заведи ещё одну» оба поиска не нужны и вредны: первый поднял бы
  // ту самую сессию, рядом с которой просят открыть новую, а второй — её окно
  // по заголовку. Заодно не читается список сессий, а он ходит на сетевой диск.
  if (reuseOpen) {
    let res;
    try {
      res = claudeWtSessions();
    } catch (e) {
      return { ok: false, reason: e.message };
    }
    if (!res.ok) return { ok: false, reason: res.reason };

    const session = pickOpenProjectSession(res.sessions, cwd);
    if (session?.windowId && getWindowById(session.windowId)) {
      if (!(await focusTerminalWindow(session.windowId))) {
        return { ok: false, action: 'focus', reason: 'window is not on screen', sessionId: session.id };
      }
      return { ok: true, action: 'focus', sessionId: session.id };
    }

    const byTitle = findOpenTerminalByTitle(sessionName);
    if (byTitle) {
      if (!(await focusTerminalWindow(byTitle.id))) {
        return { ok: false, action: 'focus-title', reason: 'window is not on screen' };
      }
      return { ok: true, action: 'focus-title', sessionName };
    }
  }

  const cfg = getClaudeWtConfig();
  const legacy = isLegacyLaunch(cfg);
  if (legacy && !cfg.launchNew?.command) {
    return { ok: false, reason: 'claudeWt.launchNew.command is not set in config' };
  }
  const chosen = legacy ? { name: 'wt', entry: null, fallback: false } : resolveTerminal(terminal, cfg);
  if (chosen.fallback && terminal) {
    console.error(`[claude-wt] terminal ${terminal} is not in claudeWt.terminals, using ${chosen.name}`);
  }
  if (legacy && terminal) {
    console.error('[claude-wt] claudeWt.launch.command is set: config is legacy, terminal choice is ignored');
  }
  const effectiveProfile = profile ?? profileForTerminal(cwd, chosen.name, cfg);
  const { command, args } = planLaunchNew({
    launchNew: cfg.launchNew,
    cwd,
    name: sessionName,
    profile: effectiveProfile,
    terminal: chosen.entry,
  });
  if (!command) {
    return { ok: false, reason: 'claudeWt: терминал не назван ни просьбой, ни конфигом' };
  }
  try {
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
  } catch (e) {
    return { ok: false, action: 'spawn', reason: e.message };
  }
  // Хвостом, а не до ответа: окно появится через секунды, а просьба должна
  // вернуться сразу — её ждёт обработчик MQTT, который пишет в журнал исход.
  // `.catch()` обязателен: необработанное отклонение в node 22 роняет процесс
  // целиком, а в нём же живут экспорт в Home Assistant и сторож демона.
  focusSpawnedWindow(sessionName).catch((e) => {
    console.error(`[claude-wt] failed to focus ${sessionName}: ${e.message}`);
  });
  return { ok: true, action: 'spawn', cwd, name: sessionName, sessionName };
}

export { openClaudeProject, focusSpawnedWindow };
