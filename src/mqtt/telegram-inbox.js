/**
 * Наблюдатель входящих из Telegram в процессе службы.
 *
 * Новый `*.md` в корне `claudeWt.telegramInbox.dir` — новое окно терминала с
 * сессией `tg-<имя>` (`openInboxSession`). Чистая часть — в
 * `../claude-wt/telegram-inbox-helpers.js`.
 *
 * Почему опрос, а не `fs.watch`: файл всё равно надо дождаться (размер и mtime
 * перестали меняться), то есть таймер нужен и с событиями; а опрос одного
 * локального каталога раз в три секунды — один `readdir` и по `stat` на файл.
 * Окна в цикле не перечисляются вовсе, бюджет опроса из AGENTS.md не задет.
 *
 * Конфиг перечитывается на каждом проходе (`getClaudeWtConfig()` сверяет mtime
 * файла), поэтому включение на машине не требует перезапуска трея.
 *
 * Каждый файл открывается один раз: имя пишется в файл состояния (рядом с
 * `claudeWt.statePath`, не в vault) **до** запуска терминала. Упади служба
 * посреди запуска — окно, может быть, не откроется, но и пачкой при каждом
 * перезапуске не откроется тоже. На старте лежащие в корне файлы, которых нет в
 * состоянии, считаются новыми: скрипт на той стороне сразу уносит файл в
 * `processed/`, так что лежащий файл никто ещё не забрал. Открываются они по
 * одному, с паузой `gapMs` после того, как окно предыдущего нашлось.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  inboxRemoteFile,
  inboxSessionName,
  normalizeInboxConfig,
  parseInboxState,
  planInboxTick,
  pruneProcessed,
  serializeInboxState,
} from '../claude-wt/telegram-inbox-helpers.js';

const TAG = '[telegram-inbox]';

const defaultFs = {
  listDir(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).map((d) => {
      if (!d.isFile()) return { name: d.name, isFile: false };
      const st = fs.statSync(path.join(dir, d.name));
      return { name: d.name, isFile: true, size: st.size, mtimeMs: st.mtimeMs };
    });
  },
  readState(file) {
    try {
      return parseInboxState(fs.readFileSync(file, 'utf8'));
    } catch {
      return { processed: {} };
    }
  },
  writeState(file, state) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, serializeInboxState(state));
    fs.renameSync(tmp, file);
  },
};

/**
 * Завести наблюдатель. Возвращает `{ stop(), tick() }` всегда — выключенный в
 * конфиге он просто ничего не делает на проходе.
 *
 * `tick()` наружу — для тестов: проход целиком, без таймера.
 */
function startTelegramInbox({ winMan, log, deps = {} }) {
  const {
    io = defaultFs,
    now = Date.now,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    schedule = (fn, ms) => setTimeout(fn, ms),
    cancel = clearTimeout,
    autostart = true,
  } = deps;

  let stopped = false;
  let timer = null;
  let seen = new Map();
  let reported = new Set();
  let state = null;
  let statePath = '';
  const queue = [];
  const busy = new Set();
  let draining = null;
  let lastProblem = null;
  let lastListError = null;
  let wasEnabled = false;

  const readConfig = () => {
    let claude;
    try {
      claude = winMan.getClaudeWtConfig();
    } catch {
      return null;
    }
    return { claude, ...normalizeInboxConfig(claude?.telegramInbox ?? {}, { statePath: claude?.statePath }) };
  };

  const persist = () => {
    try {
      io.writeState(statePath, state);
    } catch (e) {
      log(`${TAG} cannot write ${statePath}: ${e.message}`, 'error');
    }
  };

  async function openOne(name, cfg) {
    const sessionName = inboxSessionName(name);
    const file = inboxRemoteFile(cfg.fileDir, name);
    state.processed = { ...state.processed, [name]: now() };
    persist();
    // Файл пролежит в корне, пока скрипт на той стороне не унесёт его в
    // processed/, — «пропущен: уже открыт» про только что открытый не пишем.
    reported.add(name);
    log(`${TAG} open ${name} as ${sessionName} (${file})`);
    let res;
    try {
      res = await winMan.openInboxSession({
        file, name: sessionName, cwd: cfg.cwd, script: cfg.script, terminal: cfg.terminal,
      });
    } catch (e) {
      res = { ok: false, reason: e.message };
    }
    if (!res?.ok) {
      log(`${TAG} failed to open ${name}: ${res?.reason ?? 'unknown error'} (marked as opened, not retried)`, 'error');
    } else if (!res.focused) {
      log(`${TAG} ${sessionName}: window did not show up in time`, 'warn');
    }
  }

  async function drain() {
    while (queue.length && !stopped) {
      const { name, cfg } = queue.shift();
      await openOne(name, cfg);
      busy.delete(name);
      if (queue.length && !stopped) await sleep(cfg.gapMs);
    }
    draining = null;
  }

  function tick() {
    const conf = readConfig();
    if (!conf || !conf.cfg.enabled) {
      if (wasEnabled) log(`${TAG} disabled`);
      wasEnabled = false;
      return conf?.cfg.pollMs ?? 3000;
    }
    const { cfg, problem } = conf;
    if (problem) {
      if (problem !== lastProblem) log(`${TAG} not started: ${problem}`, 'warn');
      lastProblem = problem;
      wasEnabled = false;
      return cfg.pollMs;
    }
    lastProblem = null;
    if (!wasEnabled) log(`${TAG} watching ${cfg.dir} every ${cfg.pollMs}ms, state: ${cfg.statePath}`);
    wasEnabled = true;

    if (!state || statePath !== cfg.statePath) {
      statePath = cfg.statePath;
      state = io.readState(statePath);
    }

    let entries;
    try {
      entries = io.listDir(cfg.dir);
      lastListError = null;
    } catch (e) {
      if (e.message !== lastListError) log(`${TAG} cannot read ${cfg.dir}: ${e.message}`, 'warn');
      lastListError = e.message;
      return cfg.pollMs;
    }

    const t = now();
    const plan = planInboxTick({
      entries, now: t, seen, processed: state.processed, busy, reported, settleMs: cfg.settleMs,
    });
    seen = plan.seen;
    reported = plan.reported;
    for (const { name, reason } of plan.skipped) log(`${TAG} skip ${name}: ${reason}`);

    const pruned = pruneProcessed(state.processed, plan.present, t);
    if (Object.keys(pruned).length !== Object.keys(state.processed).length) {
      state.processed = pruned;
      persist();
    }

    if (plan.ready.length) {
      const waiting = queue.length + plan.ready.length;
      if (waiting > 1) log(`${TAG} ${waiting} files queued, opening one by one`, 'warn');
      for (const name of plan.ready) {
        busy.add(name);
        queue.push({ name, cfg });
      }
      if (!draining) {
        draining = drain().catch((e) => {
          draining = null;
          log(`${TAG} queue failed: ${e.message}`, 'error');
        });
      }
    }
    return cfg.pollMs;
  }

  const loop = () => {
    if (stopped) return;
    let next = 3000;
    try {
      next = tick();
    } catch (e) {
      log(`${TAG} tick failed: ${e.message}`, 'error');
    }
    if (!stopped) timer = schedule(loop, next);
  };

  if (autostart) timer = schedule(loop, 0);

  return {
    tick,
    idle: () => draining ?? Promise.resolve(),
    stop() {
      stopped = true;
      if (timer) cancel(timer);
    },
  };
}

export { startTelegramInbox };
