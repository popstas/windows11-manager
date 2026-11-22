/**
 * Команды claude-wt. Переехали из windows-mqtt/src/modules/windows.js.
 *
 * `claude-session-unread` и `claude-session-open` заводятся здесь заново: в
 * windows-mqtt у них были только stdinActions старого webview-пикера, а
 * MQTT-подписки не было ни у кого. Из-за этого отметка «непросмотрено» из
 * ccfzf-picker пропадала молча — тот же случай, что уже описан в комментарии
 * windows.js:1088-1093 про claude-focus.
 */
import { chooseAction } from '../claude-wt/ha/session-groups.js';
import { sessionIdForSlot } from '../claude-wt/ha/session-slots.js';
import { basenameOfCwd, parseCursorPoint, promptFromRequest } from '../claude-wt/project-helpers.js';
import { parseRestorePayload } from './restore-payload.js';
import { parseArrangePayload } from '../claude-layout-helpers.js';
import { startTiming, noTiming } from '../claude-wt/timing.js';
import { publishedTerminal } from '../claude-wt/terminal-helpers.js';
import { isSessionUuid, sessionNameProblem, pickSessionByTitle } from '../claude-wt/session-name-helpers.js';

/** Тело просьбы: `{"id": …}` либо голый id строкой — ради вызова руками. */
function parseIdPayload(payload) {
  if (payload && typeof payload === 'object') return payload;
  const raw = String(payload ?? '').trim();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch { /* не JSON — значит сам id */ }
  return { id: raw };
}

/**
 * Номер строки панели: `{"slot":3}`, `{"id":3}` или голое `3`.
 *
 * Отдельно от обработчика, потому что тот же номер нужен build.js, чтобы
 * погасить плитку: там он брался из сырого тела, и `Number('{"slot":3}')` давал
 * NaN — слот не находился, плитка оставалась гореть.
 */
function slotFromPayload(payload) {
  const parsed = parseIdPayload(payload);
  return parsed.slot !== undefined ? parsed.slot : parsed.id;
}

/**
 * Сколько после открытия сессии повторная просьба о ней же не открывает окно.
 * Окно поднимается не сразу: restore и resume отвечают, когда терминал
 * запущен, а демон узнаёт окно тиком позже. Второй клик в эти секунды
 * (двойной клик по `- Сессия <имя>` в Obsidian, 2026-11-20 на nb) видел
 * сессию закрытой и запускал второй `ccfzf --session` на ту же сессию.
 */
const OPEN_GUARD_MS = 10_000;

function claudeCommands({ winMan, log, notify, slots, now = () => Date.now() }) {
  // id сессии → до какого момента новое открытие её не запускает. Infinity —
  // открытие ещё идёт. Ключ — настоящий id после поиска по имени, чтобы имя и
  // uuid одной сессии делили одну защиту.
  const opening = new Map();

  /** Запустить открытие `key`, если такое же не идёт и не шло только что. */
  async function guardOpen(key, run) {
    const until = opening.get(key);
    if (until !== undefined && now() < until) {
      log(`claude-wt session-open ${key}: уже открывается — повтор пропущен`);
      return { ok: true, action: 'pending' };
    }
    opening.set(key, Infinity);
    let res;
    try {
      res = await run();
    } catch (e) {
      opening.delete(key);
      throw e;
    }
    // Отказ защиту снимает: повторить неудавшееся человек вправе сразу.
    if (res?.ok) opening.set(key, now() + OPEN_GUARD_MS);
    else opening.delete(key);
    return res;
  }

  /**
   * `brief: true` — по той же причине, что и в openClaudeProject: решается
   * здесь «открыто ли окно этой сессии», а на это состояние агента не влияет
   * никак. Читалось же оно дольше всего остального вместе взятого — прогресс и
   * мета лежат на сетевом диске, файл на сессию, 1.43 с замером на popstas-pc.
   * Ровно эту секунду с лишним человек и ждал, выбирая в пикере уже открытое
   * окно: сама расстановка фокуса занимает миллисекунды.
   */
  function findSession(id, mark = noTiming, { byTitle = false } = {}) {
    let res;
    try {
      res = winMan.claudeWtSessions({ mark, brief: true });
    } catch (e) {
      return { error: e.message };
    }
    if (!res.ok) return { error: res.reason };
    let session = res.sessions.find((s) => s.id === id);
    // Имя вместо id (подпункт `- Сессия <имя>` из tasks.md): ищется по
    // заголовку, точно. UUID по заголовку не ищем — у настоящего id тёзок
    // среди имён не бывает, а совпадение было бы случайным.
    if (!session && byTitle && !isSessionUuid(id)) {
      session = pickSessionByTitle(res.sessions, id, (windowId) => !!winMan.getWindowById(windowId)) ?? undefined;
    }
    // `unknown` отделяет «слота под этот id нет» от «список не прочитался
    // вовсе»: первое для session-open — обычное дело (сессия с чужой машины),
    // второе — поломка, о которой надо сказать. Без флага их пришлось бы
    // различать по тексту сообщения.
    return session ? { session } : { error: `unknown session ${id}`, unknown: true };
  }

  async function restoreOne(id, terminal, cursor) {
    try {
      const opts = { sessionIds: [id] };
      // Ключа нет, когда пикер имя не назвал: дефолт машины решает сам
      // restoreClaudeSessions, а не пустая строка здесь — тот же приём, что у
      // openProject.
      if (terminal) opts.terminal = terminal;
      // И так же с точкой: её нет, когда галка «на активном экране» выключена
      // или пикер прежней версии её не шлёт, — а «нет точки» и значит «ставь
      // как ставил».
      if (cursor) opts.cursor = cursor;
      const { restored, skipped } = await winMan.restoreClaudeSessions(opts);
      log(`claude-wt restored ${restored.length}, skipped ${skipped.length}`);
      if (!restored.length) {
        const reason = `не удалось поднять сессию ${id}`;
        notify(`claude-wt: ${reason}`);
        return { ok: false, reason };
      }
      return { ok: true };
    } catch (e) {
      log(`claude-wt restore failed: ${e.message}`, 'error');
      notify(`claude-wt: ошибка восстановления — ${e.message}`);
      return { ok: false, reason: e.message };
    }
  }

  /**
   * Живое окно поднимаем, мёртвую сессию восстанавливаем.
   *
   * Стол трогается только если пришлось: `focusTerminalWindow` сперва пробует
   * сам фокус и бесплатно проверяет, стал ли hwnd передним, и лишь потом
   * платит за запуск `VirtualDesktop11.exe`. Окно на текущем столе — обычный
   * случай, и он теперь не стоит ничего.
   *
   * Известный номер стола сюда не передаётся намеренно, хотя слот его помнит:
   * память слота может отстать от жизни (окно увели вручную), и переход по ней
   * увёл бы человека не туда. Живой ответ спрашивается только тогда, когда
   * дешёвая попытка уже не удалась, — то есть редко.
   *
   * `terminal` доходит только досюда с дорогой session-open: у claude-focus
   * его в просьбе не бывает, и вызов оттуда просто не передаёт третий
   * аргумент. То же и с точкой курсора: подъём уже открытого окна её не
   * спрашивает вовсе — ставить нечего, окно стоит там, куда его поставили.
   */
  async function focusOrRestore(id, session, terminal, mark = noTiming, cursor = null, { raiseOnly = false } = {}) {
    if (chooseAction(session, (windowId) => !!winMan.getWindowById(windowId)) === 'restore') {
      // «Только поднять» (CLI claude-wt агента): окна нет — отказ, а не новое
      // окно. Агент, открывший терминал, думая, что переключает фокус, — ровно
      // то, чего этот режим и стережёт; открыть сессию — отдельная просьба.
      if (raiseOnly) {
        log(`claude-wt: ${id} has no window — raise only, nothing opened`);
        return { ok: false, reason: 'no window' };
      }
      return guardOpen(id, async () => ({ action: 'restore', ...(await restoreOne(id, terminal, cursor)) }));
    }
    const foreground = Boolean(await winMan.focusTerminalWindow(session.windowId, mark));
    if (!foreground) log(`claude-wt: ${id} is not on screen`, 'warn');
    // Окно не вышло вперёд — не отказ: оно есть, и стол или фокус ему мог не
    // отдать Windows. Второе окно той же сессии тут хуже, чем журнал. Исход
    // уходит в `foreground`: пикер тело не читает, CLI агента считает `false`
    // отказом сам.
    return { action: 'focus', ok: true, foreground };
  }

  /**
   * Открыть проект терминалом — тем же путём, что и `claude-wt open-project`.
   *
   * Ради этого вся просьба и заведена: каталог проекта переводит в профиль
   * Windows Terminal только эта машина (`claudeWt.projects` → `profileForTerminal`),
   * и собранная в пикере команда `wt.exe` профиль теряет. `openClaudeProject`
   * сначала ищет уже открытую сессию этого каталога и поднимает её окно, и
   * только если такой нет — заводит новую: второй терминал на тот же проект
   * человеку не нужен. При `reuseOpen: false` (просьба `terminal-new`) поиск
   * пропускается целиком — второй терминал как раз и нужен.
   *
   * Имя нужно `claude -n` при запуске новой сессии. По умолчанию берётся
   * из каталога — ровно так же его считает сам `openClaudeProject`, и так же
   * называет новую сессию ccfzf.
   */
  async function openProject(cwd, name, { reuseOpen = true, terminal = '', cursor = null, promptB64 = '' } = {}) {
    const opts = { cwd, name: name || basenameOfCwd(cwd) };
    // Ключа `reuseOpen: true` в обычной просьбе нет: у `openClaudeProject` это
    // и так умолчание, а лишний ключ пришлось бы дописать в каждый
    // существующий тест, ничего этим не проверив. Та же причина — у `terminal`
    // ниже: пустая строка значит «пикер имя не назвал», и дефолт машины решает
    // сам реестр терминалов, а не пустой ключ здесь.
    if (!reuseOpen) opts.reuseOpen = false;
    if (terminal) opts.terminal = terminal;
    // Ключа нет, когда пикер точки не назвал: окно тогда встаёт туда, куда его
    // поставит терминал, — ровно как было до появления галки. То же правило,
    // что у `terminal` выше.
    if (cursor) opts.cursor = cursor;
    // Ключ только у просьбы с промптом — то же правило пустых ключей.
    if (promptB64) opts.promptB64 = promptB64;
    let res;
    try {
      res = await winMan.openClaudeProject(opts);
    } catch (e) {
      log(`claude-wt session-open ${cwd}: ${e.message}`, 'error');
      notify(`claude-wt: ${e.message}`);
      return { ok: false, reason: e.message };
    }
    if (!res?.ok) {
      const reason = res?.reason ?? 'не удалось открыть';
      log(`claude-wt session-open ${cwd}: ${reason}`, 'warn');
      notify(`claude-wt: ${reason}`);
      return { ok: false, reason };
    }
    log(`claude-wt session-open ${cwd}: ${res.action}`);
    return { ok: true, action: res.action };
  }

  /**
   * Поднять ту самую сессию по id — дорога для сессий, которых эта машина не
   * помнит слотом.
   *
   * Отличается от `focusOrRestore` тем, что не требует слота: тот поднимает
   * окно или восстанавливает его на прежнее место, а здесь ни окна, ни места
   * нет — сессия живёт (или жила) на другой машине. Отчитывается тем же
   * набором строк, что `openProject`: у публикации в MQTT ответа нет, и
   * единственный способ узнать исход — журнал и уведомление.
   */
  async function resumeSession(id, cwd, terminal, cursor = null) {
    // Пустых ключей в просьбе нет по тому же правилу, что у `openProject`:
    // отсутствие каталога и отсутствие имени терминала — это ответы («профиль
    // брать неоткуда», «дефолт машины»), а не пустые строки.
    const opts = { id };
    if (cwd) opts.cwd = cwd;
    if (terminal) opts.terminal = terminal;
    if (cursor) opts.cursor = cursor;
    let res;
    try {
      res = await winMan.resumeClaudeSession(opts);
    } catch (e) {
      log(`claude-wt session-open ${id}: ${e.message}`, 'error');
      notify(`claude-wt: ${e.message}`);
      return { ok: false, reason: e.message };
    }
    if (!res?.ok) {
      const reason = res?.reason ?? 'не удалось поднять сессию';
      log(`claude-wt session-open ${id}: ${reason}`, 'warn');
      notify(`claude-wt: ${reason}`);
      return { ok: false, reason };
    }
    log(`claude-wt session-open ${id}: ${res.action}`);
    return { ok: true, action: res.action };
  }

  /**
   * Поднять окно сессии. Ответ — для http: `{ok, action, foreground}` или
   * `{ok:false, reason}` с кодом 200 (пикер читает только код, и новые отказы
   * не должны появиться у него в статуслайне). `raiseOnly: true` — только
   * настоящий булев: строка `"false"` иначе молча включила бы режим.
   */
  async function focus(payload) {
    const { id, raiseOnly } = parseIdPayload(payload);
    if (!id) return { ok: false, reason: 'no id' };
    const mark = startTiming(`focus ${id}`);
    const found = findSession(id, mark);
    if (found.error) {
      log(`claude-wt: ${found.error}`, 'warn');
      notify(`claude-wt: ${found.error}`);
      return { ok: false, reason: found.error };
    }
    return focusOrRestore(id, found.session, undefined, mark, null, { raiseOnly: raiseOnly === true });
  }

  return {
    'claude-focus': focus,

    /**
     * Разложить окна сессий плиткой или каскадом.
     *
     * Тело разбирается тремя видами, как у мака: объект от пикера, json-строка
     * и голое слово с панели openHASP. Успех в журнал пишет сам
     * arrangeClaudeWindows — он один знает, сколько окон нашлось; сюда доходят
     * только отказы, и они идут ещё и человеком, потому что у публикации в
     * MQTT ответа нет и молчание неотличимо от успеха.
     *
     * По http отвечает `{ok:true, placed}` или `{ok:false, reason}` (код 200):
     * тело читает CLI claude-wt агента, пикер — только код ответа.
     */
    async 'claude-place'(payload) {
      const parsed = parseArrangePayload(payload);
      if (!parsed) {
        log(`claude-place: тело не разобрано — ${JSON.stringify(payload)}`, 'warn');
        return { ok: false, reason: 'bad payload' };
      }
      let res;
      try {
        res = await winMan.arrangeClaudeWindows({
          mode: parsed.mode, ids: parsed.ids, groups: parsed.groups, selected: parsed.selected, log,
        });
      } catch (e) {
        log(`claude-place ${parsed.mode}: ${e.message}`, 'error');
        notify(`claude-wt: ошибка раскладки — ${e.message}`);
        return { ok: false, reason: e.message };
      }
      if (!res?.ok) {
        const reason = res?.reason ?? 'не удалось разложить';
        log(`claude-place ${parsed.mode}: ${reason}`, 'warn');
        notify(`claude-wt: ${reason}`);
        return { ok: false, reason };
      }
      return { ok: true, placed: Number.isInteger(res.placed) ? res.placed : 0 };
    },

    /**
     * Панель шлёт номер строки, а не id: топик в openhasp_buttons.yaml —
     * фиксированная строка и от содержимого строки зависеть не может.
     * Раскладка берётся из последнего экспорта, чтобы номер значил ровно то,
     * что человек видел в момент нажатия.
     */
    async 'claude-focus-slot'(payload) {
      const slot = slotFromPayload(payload);
      const id = sessionIdForSlot(slots(), slot);
      if (!id) {
        log(`claude-wt: slot ${slot} is empty`, 'warn');
        return;
      }
      await focus({ id });
    },

    /**
     * Какой терминал выбран на этой машине (`claudeWt.terminal`). Спрашивает
     * ccfzf-picker перед своими запусками мимо менеджера, по http, на каждое
     * действие: конфиг читается на каждый запрос, правка переключателя сразу
     * меняет ответ. Тело не читается.
     */
    'claude-terminal'() {
      return publishedTerminal(winMan.getClaudeWtConfig());
    },

    async 'claude-session-unread'(payload) {
      const { id } = parseIdPayload(payload);
      if (!id) return;
      let res;
      try {
        res = winMan.markSessionUnread(id);
      } catch (e) {
        log(`claude-wt mark unread failed: ${e.message}`, 'error');
        notify(`claude-wt: ${e.message}`);
        return;
      }
      if (!res.ok) {
        log(`claude-wt mark unread: ${res.reason}`, 'warn');
        notify(`claude-wt: ${res.reason}`);
        return;
      }
      log(`claude-wt marked unread: ${res.ids.join(', ')}`);
    },

    // Хвостом, а не до ответа. launchPlan (restore.js) ждёт каждое окно до
    // 30 с и держит между запусками паузу 2 с — снимок из трёх сессий легко
    // занимает 10-30 секунд, а у http-транспорта пикера потолок 5 с на всю
    // просьбу (manager_http.rs::TIMEOUT). Синхронный await отвечал бы
    // «refused» ровно там, где восстановление дошло бы до конца, — обучая не
    // верить строке ошибки, хотя вся эта работа затеяна ради обратного. Тот
    // же приём, что у `openClaudeProject` (`project.js`): `tail.catch()`
    // обязателен — необработанное отклонение в node 22 роняет весь служебный
    // процесс, а не только эту просьбу.
    async 'claude-snapshot-restore'(payload) {
      const { id, sessionIds } = parseRestorePayload(payload);
      const tail = winMan.restoreSnapshot({ id, sessionIds }).then(({ restored, skipped }) => {
        log(`claude-wt snapshot ${id}: restored ${restored.length}, skipped ${skipped.length}`);
        if (!restored.length && !skipped.length) notify('claude-wt: нечего восстанавливать');
      });
      tail.catch((e) => {
        log(`claude-wt snapshot restore failed: ${e.message}`, 'error');
        notify(`claude-wt: ошибка восстановления — ${e.message}`);
      });
    },

    /**
     * Просьба пикера открыть сессию здесь: `{id, action: 'terminal', cwd}`.
     *
     * Поддержано два действия. `terminal` — «покажи мне проект»: сессию
     * поднимают, если она есть. `terminal-new` — «дай ещё один терминал»:
     * поиск пропускается целиком, и имя берётся из тела, потому что basename
     * каталога занят той сессией, рядом с которой просят открыть новую.
     * Остальные действия (cursor, explorer, pr) осмысленны только там, где
     * стоит человек, и пикер выполняет их у себя.
     *
     * «Открыть» и «поднять» — разные просьбы, и это единственное, чем этот
     * обработчик отличается от `claude-focus`. Фокусу нужна живая сессия, а
     * открытию — нет: список пикера приезжает от ccfzf с ssh-хоста и знает
     * сессии, которых на Windows не открывали ни разу. Раньше такая просьба
     * упиралась в `unknown session` и не делала ничего, а пикер об этом не
     * узнавал — у публикации нет ответа. Поэтому в теле едет ещё и каталог
     * проекта: по нему сессию можно открыть, не зная её вовсе.
     *
     * Порядок:
     *  1. сессию трекер знает — прежняя дорога: живое окно поднимаем (со
     *     сменой виртуального стола), закрытое поднимаем восстановлением. Оно
     *     возвращает **ту же** сессию (`claude --resume {id}`) на её прежнее
     *     место и с тем же профилем — терминал по каталогу дал бы вместо неё
     *     пустую новую. Отменяет эту ветку одно: `noAutoplace` в теле (Ctrl в
     *     пикере) — «прежнее место» и «не расставляй» противоречат друг другу,
     *     и тогда закрытая сессия поднимается ветками ниже, дорогой resume;
     *  2. слота под этот id нет, но id назван — возобновляем сессию по нему
     *     (`resumeClaudeSession`). Слота нет у сессии, чьё окно стоит на другой
     *     машине или закрыто вовсе, а такую как раз и просят открыть здесь;
     *     каталог в этой ветке нужен только ради профиля терминала. Раньше эта
     *     просьба падала в ветку ниже и человек получал пустую `claude -n`
     *     вместо своей сессии — молча, потому что ответа у публикации нет;
     *  3. id не назван, но известен каталог — открываем проект. Откат на
     *     каталог остался только здесь: при названном id он означал бы «вместо
     *     твоей сессии вот тебе новая»;
     *  4. нет ни того, ни другого — говорим об этом в журнал и человеку.
     *     Молчание здесь было бы неотличимо от успеха.
     *
     * В `id` может приехать и имя сессии (`/rename`) — так просит плагин
     * tasks-mover по клику на `- Сессия <имя>` в tasks.md. Имя ищется по
     * заголовку среди слотов (`pickSessionByTitle`), и найденная сессия идёт
     * дальше по шагу 1 уже под своим id. Не нашлась — шаг 2 с самим именем:
     * `ccfzf --session` на pc-virt разрешает имя сам, по всем транскриптам.
     * Имя попадает в командную строку (WT → ssh → шелл), поэтому не-UUID
     * проходит белый список символов (`sessionNameProblem`) раньше всего.
     *
     * Ответ — для http-слушателя; по MQTT его никто не читает. Отказ несёт
     * `httpStatus` (400 — кривая просьба, 500 — поднять не вышло), успех —
     * `{action}`: focus | restore | resume | pending | spawn… (`pending` —
     * та же сессия уже открывается, `OPEN_GUARD_MS`). Id сессии наружу не
     * отдаётся: слушатель без авторизации, а живой sessionId открывает
     * head-session второй проход session-new.
     */
    async 'claude-session-open'(payload) {
      const { id, action, cwd, name, terminal, cursor, noAutoplace, prompt } = parseIdPayload(payload);
      // Отказ: в журнал и человеку — у публикации в MQTT ответа нет, и
      // молчание было бы неотличимо от успеха, — и кодом для http.
      const refuse = (reason, status = 400) => {
        log(`claude-wt ${reason}`, 'warn');
        notify(`claude-wt: ${reason}`);
        return { httpStatus: status, error: reason };
      };
      // Исход ветки → ответ. Об отказе ветка уже сказала сама.
      const answer = (res) => (res?.ok
        ? { action: res.action }
        : { httpStatus: 500, error: res?.reason ?? 'не удалось открыть' });
      if (!action) return undefined;
      if (action !== 'terminal' && action !== 'terminal-new' && action !== 'terminal-prompt') {
        // Незнакомое действие не делает хотя бы ничего и жалуется — тем же
        // стилем, что terminal-new без cwd: в журнал и человеку, а не только
        // в журнал, иначе отказ был бы неотличим от тишины.
        return refuse(`session-open: unsupported action ${action}`);
      }
      const dir = typeof cwd === 'string' ? cwd.trim() : '';
      const asked = typeof name === 'string' ? name.trim() : '';
      // Имя терминала из просьбы. Пикер называет то, что выбрано у него;
      // пусто — берётся дефолт машины. Проверять имя здесь нечем и незачем:
      // реестр знает менеджер, и он же скажет в лог, если имя чужое.
      const wantedTerminal = typeof terminal === 'string' ? terminal.trim() : '';
      // Точка курсора: пикер просит поставить новое окно на тот экран, где
      // сейчас смотрит человек. Экран называется точкой, а не номером —
      // нумераций мониторов у нас три, и общий словарь на два репозитория
      // разошёлся бы молча. Просеивается здесь же (`parseCursorPoint`): тело
      // пишет чужая машина, а мусор доехал бы до `setBounds`.
      // `noAutoplace` едет вместе с точкой, потому что без точки не значит
      // ничего: пометку ставит та же дорога, что и окно по курсору. Пикер
      // прежней версии ключа не шлёт вовсе, и это читается как «расставляй
      // как обычно».
      const at = parseCursorPoint(cursor, { noAutoplace: noAutoplace === true });
      // Секундомер заводится здесь, а не в ветке подъёма: считать надо с
      // прихода просьбы, иначе разбор тела и поиск сессии выпадут из отчёта —
      // а именно поиск и оказался тем, что стоило больше секунды.
      const mark = startTiming(`session-open ${id ?? dir}`);
      // «Заведи ещё одну» — просьба про каталог и только про него. Сессию не
      // ищем даже при заданном id: нашлась бы та самая, рядом с которой просят
      // открыть новую, и вместо второго терминала человек получил бы подъём
      // первого — обратное тому, о чём просил.
      if (action === 'terminal-new') {
        if (!dir) return refuse('session-open: terminal-new нужен cwd проекта');
        return answer(await openProject(dir, asked, { reuseOpen: false, terminal: wantedTerminal, cursor: at }));
      }
      // «Заведи новую и отдай ей этот промпт» (`/p <проект> <промпт>` в
      // пикере). Своё действие, а не поле `prompt` у `terminal-new`: менеджер
      // прежней версии незнакомое поле выкинул бы молча и открыл сессию без
      // промпта, а незнакомое действие он отвергает вслух (ветка выше). Сессию
      // не ищем по той же причине, что у `terminal-new`.
      if (action === 'terminal-prompt') {
        if (!dir) return refuse('session-open: terminal-prompt нужен cwd проекта');
        const { promptB64, error } = promptFromRequest(prompt);
        if (error) return refuse(`session-open: ${error}`);
        return answer(await openProject(dir, asked, {
          reuseOpen: false, terminal: wantedTerminal, cursor: at, promptB64,
        }));
      }
      // Строка, а не что попало: id из JSON может приехать числом или
      // объектом, а дальше он идёт и в поиск, и в шаблон командной строки.
      const want = typeof id === 'string' ? id.trim() : (id == null ? '' : String(id));
      if (want && !isSessionUuid(want)) {
        const problem = sessionNameProblem(want);
        if (problem) return refuse(`session-open: ${problem}`);
      }
      const found = want ? findSession(want, mark, { byTitle: true }) : null;
      if (found?.session) {
        // Точка едет и сюда. Прежде эта ветка курсора не получала вовсе — она
        // **тем и занимается**, что возвращает окно в запомненные границы, —
        // и просьбу «не расставляй» приходилось исполнять отменой самой ветки:
        // сессия поднималась дорогой resume мимо слота. Двух дорог к одному
        // результату больше нет, и это важнее удобства: разойдись они, окно
        // вставало бы по-разному в зависимости от того, помнит ли трекер эту
        // сессию, а сказать об этом было бы некому — ответа у публикации нет.
        //
        // У живого окна точка не значит ничего: подъём — не открытие, ставить
        // нечего, а второе окно той же сессии человек не просил.
        const sid = found.session.id;
        if (sid !== want) log(`claude-wt session-open ${want}: по имени → ${sid}`);
        return answer(await focusOrRestore(sid, found.session, wantedTerminal, mark, at));
      }
      // Список сессий не прочитался — это поломка, а не «сессии тут нет»;
      // сказать о ней надо, но не встать: поднять сессию по id можно и без
      // списка, шаблон возобновления лежит в конфиге. `found.error` в условии
      // обязателен: сюда доходит и найденная сессия, у которой ошибки нет
      // вовсе, — без проверки в журнал ушло бы слово `undefined`.
      if (found && !found.unknown && found.error) log(`claude-wt session-open: ${found.error}`, 'warn');
      // Ключ здесь — то, что пришло: id настоящий у пикера, а имя, которое
      // трекер не знает, разрешит только ccfzf на той стороне.
      if (want) return answer(await guardOpen(want, () => resumeSession(want, dir, wantedTerminal, at)));
      if (dir) return answer(await openProject(dir, asked, { terminal: wantedTerminal, cursor: at }));
      return refuse('session-open: нужен id сессии или cwd проекта');
    },

    /**
     * Новая сессия по просьбе head-session — в отличие от session-open, с
     * ответом: голове нужен id новой сессии, а отказ (каталог не в списке,
     * кривое тело) — кодом. `httpStatus` http-слушатель превращает в код
     * ответа; по MQTT ответа нет, там остаётся строка в журнале.
     * Уведомления человеку нет: просит не он, а голова, и она же получит отказ.
     */
    async 'claude-session-new'(payload) {
      let res;
      try {
        res = await winMan.openNewSession(payload);
      } catch (e) {
        log(`claude-wt session-new: ${e.message}`, 'error');
        return { httpStatus: 500, error: e.message };
      }
      if (!res?.ok) {
        const reason = res?.reason ?? 'не удалось открыть';
        log(`claude-wt session-new: ${reason}`, 'warn');
        return { httpStatus: res?.status ?? 500, error: reason };
      }
      log(`claude-wt session-new ${res.name}: ${res.action} ${res.sessionId}`);
      return { action: res.action, sessionId: res.sessionId, name: res.name };
    },
  };
}

export { claudeCommands, parseIdPayload, slotFromPayload };
