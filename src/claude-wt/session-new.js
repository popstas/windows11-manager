/**
 * Окно новой сессии по просьбе head-session (`POST /claude-wt/session-new`).
 *
 * Дорога та же, что у `terminal-new` из пикера (`openClaudeProject` с
 * `reuseOpen: false`): терминал из реестра, профиль по `cwd` из
 * `claudeWt.projects`, окно ищется по имени сессии. Отличий три:
 * - удалённая команда — шаблон `claudeWt.launchSession`, на той стороне
 *   обёртка `~/bin/claude-wt-new`, она и зовёт `claude -n <имя> --session-id …`;
 * - id сессии известен заранее (пришёл в просьбе или сгенерирован здесь) и
 *   уходит в ответ — по нему голова находит новую сессию в реестре pc-virt;
 * - отказ возвращается кодом (`status`), а не только строкой в журнал: у
 *   этой просьбы есть кому ответить.
 *
 * Ответ уходит сразу после spawn; окно ловится хвостом, как у
 * `openClaudeProject`.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { getClaudeWtConfig, isTerminalWindow } from './index.js';
import { getWindows } from '../windows.js';
import { planWtLaunch, profileForTerminal, parseCursorPoint } from './project-helpers.js';
import { chooseTerminal } from './terminal-helpers.js';
import { focusSpawnedWindow, focusNewTerminalWindow, placeSpawnedWindow } from './project.js';
import { placeChildWindow } from './child-place.js';
import { parseSessionNewRequest } from './session-new-helpers.js';
import { startTiming } from './timing.js';

const terminalWindows = () => getWindows().filter(isTerminalWindow);

/**
 * @returns {Promise<{ ok: true, action: 'spawn', sessionId: string, name: string }
 *   | { ok: false, status: number, reason: string, action?: string }>}
 */
async function openNewSession(body, deps = {}) {
  const {
    cfg = getClaudeWtConfig(),
    spawnProcess = spawn,
    listWindows = terminalWindows,
    focusByTitle = focusSpawnedWindow,
    focusNew = focusNewTerminalWindow,
    newId = randomUUID,
    placeChild = placeChildWindow,
    placeOld = placeSpawnedWindow,
  } = deps;
  const parsed = parseSessionNewRequest(body, { projects: cfg.projects, newId, headZones: cfg.headZones });
  if (!parsed.ok) return parsed;
  const { vars } = parsed;

  if (!Array.isArray(cfg.launchSession?.args) || !cfg.launchSession.args.length) {
    return { ok: false, status: 500, reason: 'claudeWt.launchSession.args is empty' };
  }
  const raw = body && typeof body === 'object' ? body : {};
  const cursor = parseCursorPoint(raw.cursor, { noAutoplace: raw.noAutoplace === true });
  const mark = deps.mark ?? startTiming(`session-new ${vars.name}`);
  const { chosen, message } = chooseTerminal(raw.terminal, cfg, 'launchSession');
  if (message) console.error(message);
  const { command, args } = planWtLaunch({
    launch: cfg.launchSession,
    vars,
    profile: profileForTerminal(vars.cwd, chosen.name, cfg),
    terminal: chosen.entry,
  });
  if (!command) {
    return { ok: false, status: 500, reason: 'claudeWt: no terminal named by the request or the config' };
  }
  mark('plan');
  // Список окон снимается до запуска и только курсорной дороге: после spawn
  // новое окно уже не отличить, а без курсора окно ищется по заголовку.
  const headId = vars.headId === '-' ? null : vars.headId;
  const childPlan = Boolean(headId || parsed.zone);
  const known = cursor && !childPlan ? new Set(listWindows().map(w => w.id)) : null;
  try {
    spawnProcess(command, args, { detached: true, stdio: 'ignore' }).unref();
  } catch (e) {
    return { ok: false, status: 500, action: 'spawn', reason: e.message };
  }
  mark('spawn');
  // Хвостом и с `.catch()` — по той же причине, что у `openClaudeProject`:
  // ответ ждут сейчас, а необработанное отклонение роняет служебный процесс.
  // Ребёнок head (или явная зона) ставится по основным зонам, и хвост тогда
  // всегда по имени: у него есть хук `place`. Курсор остаётся откатом — нет
  // плана (зоны не разрешились, окна head нет), окно встаёт как раньше.
  const place = (w, title, m, c) => Promise.resolve()
    .then(() => placeChild(w, { sessionId: vars.sessionId, headId, zone: parsed.zone, name: vars.name, mark: m }))
    .catch((e) => {
      console.error(`[claude-wt] session-new ${vars.name}: зона не применилась — ${e.message}`);
      return null;
    })
    .then(r => r ?? placeOld(w, title, m, c));
  let tail;
  if (childPlan) tail = focusByTitle(vars.name, { mark, cursor, place });
  else if (cursor) tail = focusNew(known, { ...deps, mark, cursor });
  else tail = focusByTitle(vars.name, { mark });
  Promise.resolve(tail).catch((e) => {
    console.error(`[claude-wt] failed to focus ${vars.name}: ${e.message}`);
  });
  return { ok: true, action: 'spawn', sessionId: vars.sessionId, name: vars.name };
}

export { openNewSession };
