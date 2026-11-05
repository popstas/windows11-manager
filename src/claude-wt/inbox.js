/**
 * Окно с сессией на входящий файл из Telegram.
 *
 * Дорога та же, что у проектного хоткея в ветке «открыть новую»
 * (`openClaudeProject` с `reuseOpen: false`): терминал из реестра, профиль по
 * `cwd` из `claudeWt.projects`, `focusSpawnedWindow` по имени сессии. Поиска
 * уже открытого окна нет намеренно — каждая пересылка своя сессия, даже если
 * окно прошлой ещё открыто.
 *
 * Отличается только удалённая команда: шаблон `claudeWt.launchInbox`, а не
 * `launchNew` — на той стороне запускается скрипт vault'а, а уже он зовёт
 * `claude -n <имя> …`. Имя сессии он обязан передать без изменений: по нему
 * здесь ищется окно.
 */
import { spawn } from 'node:child_process';
import { getClaudeWtConfig } from './index.js';
import { planWtLaunch, profileForTerminal } from './project-helpers.js';
import { chooseTerminal } from './terminal-helpers.js';
import { focusSpawnedWindow } from './project.js';
import { startTiming } from './timing.js';

/**
 * Открыть окно и дождаться, пока оно найдётся и получит фокус.
 *
 * В отличие от `openClaudeProject`, хвост с фокусом здесь ждут: зовёт не
 * роутер, которому надо ответить сразу, а очередь наблюдателя, и следующую
 * пересылку она откроет только после того, как окно этой нашлось, — иначе
 * пачка файлов дала бы пачку окон, дерущихся за фокус.
 *
 * @returns {Promise<{ ok: boolean, action?: string, reason?: string, sessionName?: string, focused?: boolean }>}
 */
async function openInboxSession({ file, name, cwd, script, terminal } = {}, deps = {}) {
  const {
    cfg = getClaudeWtConfig(),
    spawnProcess = spawn,
    focusByTitle = focusSpawnedWindow,
  } = deps;
  if (![file, name, cwd, script].every(v => typeof v === 'string' && v)) {
    return { ok: false, reason: 'file, name, cwd and script are required' };
  }
  const mark = deps.mark ?? startTiming(`inbox ${name}`);
  const { chosen, message } = chooseTerminal(terminal, cfg, 'launchInbox');
  if (message) console.error(message);
  if (!Array.isArray(cfg.launchInbox?.args) || !cfg.launchInbox.args.length) {
    return { ok: false, reason: 'claudeWt.launchInbox.args is empty' };
  }
  const { command, args } = planWtLaunch({
    launch: cfg.launchInbox,
    vars: { cwd, name, file, script },
    profile: profileForTerminal(cwd, chosen.name, cfg),
    terminal: chosen.entry,
  });
  if (!command) {
    return { ok: false, reason: 'claudeWt: no terminal named by the config' };
  }
  mark('plan');
  try {
    spawnProcess(command, args, { detached: true, stdio: 'ignore' }).unref();
  } catch (e) {
    return { ok: false, action: 'spawn', reason: e.message };
  }
  mark('spawn');
  let focused = false;
  try {
    focused = Boolean(await focusByTitle(name, { mark }));
  } catch (e) {
    console.error(`[claude-wt] failed to focus ${name}: ${e.message}`);
  }
  return { ok: true, action: 'spawn', sessionName: name, focused };
}

export { openInboxSession };
