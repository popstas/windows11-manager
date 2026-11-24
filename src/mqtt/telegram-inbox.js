/**
 * Наблюдатель входящих (Telegram, почта, …) в процессе службы.
 *
 * Новый `*.md` в корне папки inbox'а — новое окно терминала с сессией
 * (`openInboxSession`). Inbox'ы — список `claudeWt.inboxes`; старый блок
 * `claudeWt.telegramInbox` читается как элемент `{ name: 'telegram' }`
 * (`resolveInboxes`). У каждого своя папка, свой файл состояния и своя строка
 * в журнале (`[inbox:<name>]`), а очередь открытия общая: окна по-прежнему
 * открываются по одному, кто бы их ни прислал. Чистая часть — в
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
 * Каждый файл открывается один раз: имя пишется в файл состояния inbox'а
 * (`<name>-inbox.json` рядом с `claudeWt.statePath`, не в vault) **до**
 * запуска терминала. Упади служба
 * посреди запуска — окно, может быть, не откроется, но и пачкой при каждом
 * перезапуске не откроется тоже. На старте лежащие в корне файлы, которых нет в
 * состоянии, считаются новыми: скрипт на той стороне сразу уносит файл в
 * `processed/`, так что лежащий файл никто ещё не забрал. Открываются они по
 * одному, с паузой `gapMs` после того, как окно предыдущего нашлось. Окна по
 * умолчанию в фоне (`background`): ставятся на место, но фокус не берут.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  inboxRemoteFile,
  inboxSessionNameFor,
  inboxTemplateFor,
  keepSessionsOf,
  parseInboxState,
  planInboxTick,
  pruneProcessed,
  resolveInboxes,
  serializeInboxState,
  uniqueSessionName,
} from '../claude-wt/telegram-inbox-helpers.js';
import { renameWithRetry } from '../rename-retry.js';

const tagOf = name => `[inbox:${name}]`;

const defaultFs = {
  listDir(dir) {
    const out = [];
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!d.isFile()) {
        out.push({ name: d.name, isFile: false });
        continue;
      }
      // Временный файл syncthing переименовывается между readdir и stat —
      // такой просто пропускаем: на следующем проходе он уже под своим именем.
      try {
        const st = fs.statSync(path.join(dir, d.name));
        out.push({ name: d.name, isFile: true, size: st.size, mtimeMs: st.mtimeMs });
      } catch {
        // исчез — не беда
      }
    }
    return out;
  },
  readText(file) {
    return fs.readFileSync(file, 'utf8');
  },
  readState(file) {
    try {
      return parseInboxState(fs.readFileSync(file, 'utf8'));
    } catch {
      return { processed: {}, sessions: {} };
    }
  },
  writeState(file, state) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, serializeInboxState(state));
    renameWithRetry(tmp, file);
  },
};

/**
 * Завести наблюдатель всех inbox'ов. Возвращает `{ stop(), tick(), idle() }`
 * всегда — без включённых inbox'ов он просто ничего не делает на проходе.
 *
 * Список перечитывается на каждом проходе: inbox, появившийся в конфиге,
 * начинает работать без перезапуска, пропавший — замолкает. Память каждого
 * (`seen`, файл состояния, что уже сказано в журнал) живёт в своей записи по
 * имени.
 *
 * `tick()` наружу — для тестов: проход целиком, без таймера.
 */
function startInboxes({ winMan, log, deps = {} }) {
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
  const records = new Map();
  const queue = [];
  let draining = null;
  let lastErrors = '';

  const recordOf = (name) => {
    let r = records.get(name);
    if (!r) {
      r = {
        name,
        tag: tagOf(name),
        seen: new Map(),
        reported: new Set(),
        busy: new Set(),
        state: null,
        statePath: '',
        lastProblem: null,
        lastListError: null,
        wasEnabled: false,
      };
      records.set(name, r);
    }
    return r;
  };

  const persist = (r) => {
    try {
      io.writeState(r.statePath, r.state);
    } catch (e) {
      log(`${r.tag} cannot write ${r.statePath}: ${e.message}`, 'error');
    }
  };

  // Окно ищется по заголовку, а заголовок — имя сессии: имена, выданные
  // любым inbox'ом, заняты для всех.
  const usedSessionNames = () => {
    const used = new Set();
    for (const r of records.values()) {
      for (const n of Object.values(r.state?.sessions ?? {})) used.add(n);
    }
    return used;
  };

  async function openOne(r, name, cfg) {
    // Текст читается, только если шаблону нужен `{task}`: файл локальный и
    // уже устоялся (settleMs), но лишний read на каждую пересылку незачем.
    let text = null;
    if (inboxTemplateFor(cfg, name).includes('{task}')) {
      try {
        text = io.readText(path.join(cfg.dir, name));
      } catch (e) {
        log(`${r.tag} ${name}: cannot read for {task}: ${e.message}`, 'warn');
      }
    }
    const { name: wanted, warning } = inboxSessionNameFor(name, cfg, text);
    if (warning) log(`${r.tag} ${name}: ${warning}`, 'warn');
    const sessionName = uniqueSessionName(wanted, usedSessionNames());
    const file = inboxRemoteFile(cfg.fileDir, name);
    r.state.processed = { ...r.state.processed, [name]: now() };
    r.state.sessions = { ...r.state.sessions, [name]: sessionName };
    persist(r);
    // Файл пролежит в корне, пока скрипт на той стороне не унесёт его в
    // processed/, — «пропущен: уже открыт» про только что открытый не пишем.
    r.reported.add(name);
    log(`${r.tag} open ${name} as ${sessionName} (${file})`);
    let res;
    try {
      res = await winMan.openInboxSession({
        file, name: sessionName, cwd: cfg.cwd, script: cfg.script, terminal: cfg.terminal,
        background: cfg.background,
      });
    } catch (e) {
      res = { ok: false, reason: e.message };
    }
    if (!res?.ok) {
      log(`${r.tag} failed to open ${name}: ${res?.reason ?? 'unknown error'} (marked as opened, not retried)`, 'error');
    } else if (!res.focused) {
      log(`${r.tag} ${sessionName}: window did not show up in time`, 'warn');
    }
  }

  async function drain() {
    while (queue.length && !stopped) {
      const { r, name, cfg } = queue.shift();
      await openOne(r, name, cfg);
      r.busy.delete(name);
      if (queue.length && !stopped) await sleep(cfg.gapMs);
    }
    draining = null;
  }

  const disable = (r) => {
    if (r.wasEnabled) log(`${r.tag} disabled`);
    r.wasEnabled = false;
  };

  /** Проход одного inbox'а; ответ — через сколько его хочется опросить снова. */
  function tickOne(r, cfg, problem) {
    if (!cfg.enabled) {
      disable(r);
      return cfg.pollMs;
    }
    if (problem) {
      if (problem !== r.lastProblem) log(`${r.tag} not started: ${problem}`, 'warn');
      r.lastProblem = problem;
      r.wasEnabled = false;
      return cfg.pollMs;
    }
    r.lastProblem = null;
    if (!r.wasEnabled) log(`${r.tag} watching ${cfg.dir} every ${cfg.pollMs}ms, state: ${cfg.statePath}`);
    r.wasEnabled = true;

    if (!r.state || r.statePath !== cfg.statePath) {
      r.statePath = cfg.statePath;
      r.state = io.readState(r.statePath);
    }

    let entries;
    try {
      entries = io.listDir(cfg.dir);
      r.lastListError = null;
    } catch (e) {
      if (e.message !== r.lastListError) log(`${r.tag} cannot read ${cfg.dir}: ${e.message}`, 'warn');
      r.lastListError = e.message;
      return cfg.pollMs;
    }

    const t = now();
    const plan = planInboxTick({
      entries, now: t, seen: r.seen, processed: r.state.processed, busy: r.busy, reported: r.reported, settleMs: cfg.settleMs,
    });
    r.seen = plan.seen;
    r.reported = plan.reported;
    for (const { name, reason } of plan.skipped) log(`${r.tag} skip ${name}: ${reason}`);

    const pruned = pruneProcessed(r.state.processed, plan.present, t);
    if (Object.keys(pruned).length !== Object.keys(r.state.processed).length) {
      r.state.processed = pruned;
      // Выданное имя забывается вместе с файлом: дальше повтор ему не грозит.
      r.state.sessions = keepSessionsOf(r.state.sessions, pruned);
      persist(r);
    }

    if (plan.ready.length) {
      const waiting = queue.length + plan.ready.length;
      if (waiting > 1) log(`${r.tag} ${waiting} files queued, opening one by one`, 'warn');
      for (const name of plan.ready) {
        r.busy.add(name);
        queue.push({ r, name, cfg });
      }
      if (!draining) {
        draining = drain().catch((e) => {
          draining = null;
          log(`${r.tag} queue failed: ${e.message}`, 'error');
        });
      }
    }
    return cfg.pollMs;
  }

  function tick() {
    let claude;
    try {
      claude = winMan.getClaudeWtConfig();
    } catch {
      // Конфиг не прочитался — память inbox'ов не трогаем, ждём следующего прохода.
      return 3000;
    }
    const { inboxes, errors } = resolveInboxes(claude);
    const errorsKey = errors.join('\n');
    if (errorsKey !== lastErrors) for (const e of errors) log(`[inbox] ${e}`, 'error');
    lastErrors = errorsKey;

    // Общий таймер — по самому частому inbox'у: лишний readdir редкому не
    // вредит, файл всё равно открывается по settleMs, а не по числу проходов.
    let next = Infinity;
    const active = new Set();
    for (const { name, cfg, problem } of inboxes) {
      active.add(name);
      const r = recordOf(name);
      try {
        next = Math.min(next, tickOne(r, cfg, problem));
      } catch (e) {
        log(`${r.tag} tick failed: ${e.message}`, 'error');
        next = Math.min(next, cfg.pollMs);
      }
    }
    // Inbox пропал из конфига (или отсеян как повтор) — замолкает, как
    // выключенный. Запись с памятью остаётся: файлы, уже стоящие в очереди,
    // откроются и запишутся в его состояние, а вернись он — продолжит с ней.
    for (const r of records.values()) {
      if (!active.has(r.name)) disable(r);
    }
    return Number.isFinite(next) ? next : 3000;
  }

  const loop = () => {
    if (stopped) return;
    let next = 3000;
    try {
      next = tick();
    } catch (e) {
      log(`[inbox] tick failed: ${e.message}`, 'error');
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

export { startInboxes, defaultFs };
