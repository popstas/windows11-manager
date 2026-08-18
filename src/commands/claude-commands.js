/**
 * Команды claude-wt. Переехали из windows-mqtt/src/modules/windows.js.
 *
 * `claude-session-unread` и `claude-session-open` заводятся здесь заново: в
 * windows-mqtt у них были только stdinActions старого webview-пикера, а
 * MQTT-подписки не было ни у кого. Из-за этого отметка «непросмотрено» из
 * ccfzf-picker пропадала молча — тот же случай, что уже описан в комментарии
 * windows.js:1088-1093 про claude-focus.
 */
import { chooseAction, resolveDesktopSwitch } from '../claude-wt/ha/session-groups.js';
import { sessionIdForSlot } from '../claude-wt/ha/session-slots.js';
import { basenameOfCwd } from '../claude-wt/project-helpers.js';
import { parseRestorePayload } from './restore-payload.js';
import { parseArrangePayload } from '../claude-layout-helpers.js';
import { startTiming, noTiming } from '../claude-wt/timing.js';

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

function claudeCommands({ winMan, log, notify, slots }) {
  /**
   * `brief: true` — по той же причине, что и в openClaudeProject: решается
   * здесь «открыто ли окно этой сессии», а на это состояние агента не влияет
   * никак. Читалось же оно дольше всего остального вместе взятого — прогресс и
   * мета лежат на сетевом диске, файл на сессию, 1.43 с замером на popstas-pc.
   * Ровно эту секунду с лишним человек и ждал, выбирая в пикере уже открытое
   * окно: сама расстановка фокуса занимает миллисекунды.
   */
  function findSession(id, mark = noTiming) {
    let res;
    try {
      res = winMan.claudeWtSessions({ mark, brief: true });
    } catch (e) {
      return { error: e.message };
    }
    if (!res.ok) return { error: res.reason };
    const session = res.sessions.find((s) => s.id === id);
    // `unknown` отделяет «слота под этот id нет» от «список не прочитался
    // вовсе»: первое для session-open — обычное дело (сессия с чужой машины),
    // второе — поломка, о которой надо сказать. Без флага их пришлось бы
    // различать по тексту сообщения.
    return session ? { session } : { error: `unknown session ${id}`, unknown: true };
  }

  async function restoreOne(id, terminal) {
    try {
      const opts = { sessionIds: [id] };
      // Ключа нет, когда пикер имя не назвал: дефолт машины решает сам
      // restoreClaudeSessions, а не пустая строка здесь — тот же приём, что у
      // openProject.
      if (terminal) opts.terminal = terminal;
      const { restored, skipped } = await winMan.restoreClaudeSessions(opts);
      log(`claude-wt restored ${restored.length}, skipped ${skipped.length}`);
      if (!restored.length) notify(`claude-wt: не удалось поднять сессию ${id}`);
    } catch (e) {
      log(`claude-wt restore failed: ${e.message}`, 'error');
      notify(`claude-wt: ошибка восстановления — ${e.message}`);
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
   * аргумент.
   */
  async function focusOrRestore(id, session, terminal, mark = noTiming) {
    if (chooseAction(session, (windowId) => !!winMan.getWindowById(windowId)) === 'restore') {
      await restoreOne(id, terminal);
      return;
    }
    if (!(await winMan.focusTerminalWindow(session.windowId, mark))) log(`claude-wt: ${id} is not on screen`, 'warn');
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
  async function openProject(cwd, name, { reuseOpen = true, terminal = '' } = {}) {
    const opts = { cwd, name: name || basenameOfCwd(cwd) };
    // Ключа `reuseOpen: true` в обычной просьбе нет: у `openClaudeProject` это
    // и так умолчание, а лишний ключ пришлось бы дописать в каждый
    // существующий тест, ничего этим не проверив. Та же причина — у `terminal`
    // ниже: пустая строка значит «пикер имя не назвал», и дефолт машины решает
    // сам реестр терминалов, а не пустой ключ здесь.
    if (!reuseOpen) opts.reuseOpen = false;
    if (terminal) opts.terminal = terminal;
    let res;
    try {
      res = await winMan.openClaudeProject(opts);
    } catch (e) {
      log(`claude-wt session-open ${cwd}: ${e.message}`, 'error');
      notify(`claude-wt: ${e.message}`);
      return;
    }
    if (!res?.ok) {
      const reason = res?.reason ?? 'не удалось открыть';
      log(`claude-wt session-open ${cwd}: ${reason}`, 'warn');
      notify(`claude-wt: ${reason}`);
      return;
    }
    log(`claude-wt session-open ${cwd}: ${res.action}`);
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
  async function resumeSession(id, cwd, terminal) {
    // Пустых ключей в просьбе нет по тому же правилу, что у `openProject`:
    // отсутствие каталога и отсутствие имени терминала — это ответы («профиль
    // брать неоткуда», «дефолт машины»), а не пустые строки.
    const opts = { id };
    if (cwd) opts.cwd = cwd;
    if (terminal) opts.terminal = terminal;
    let res;
    try {
      res = await winMan.resumeClaudeSession(opts);
    } catch (e) {
      log(`claude-wt session-open ${id}: ${e.message}`, 'error');
      notify(`claude-wt: ${e.message}`);
      return;
    }
    if (!res?.ok) {
      const reason = res?.reason ?? 'не удалось поднять сессию';
      log(`claude-wt session-open ${id}: ${reason}`, 'warn');
      notify(`claude-wt: ${reason}`);
      return;
    }
    log(`claude-wt session-open ${id}: ${res.action}`);
  }

  async function focus(payload) {
    const { id } = parseIdPayload(payload);
    if (!id) return;
    const mark = startTiming(`focus ${id}`);
    const found = findSession(id, mark);
    if (found.error) {
      log(`claude-wt: ${found.error}`, 'warn');
      notify(`claude-wt: ${found.error}`);
      return;
    }
    await focusOrRestore(id, found.session, undefined, mark);
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
     */
    async 'claude-place'(payload) {
      const parsed = parseArrangePayload(payload);
      if (!parsed) {
        log(`claude-place: тело не разобрано — ${JSON.stringify(payload)}`, 'warn');
        return;
      }
      let res;
      try {
        res = await winMan.arrangeClaudeWindows({ mode: parsed.mode, ids: parsed.ids, log });
      } catch (e) {
        log(`claude-place ${parsed.mode}: ${e.message}`, 'error');
        notify(`claude-wt: ошибка раскладки — ${e.message}`);
        return;
      }
      if (!res?.ok) {
        const reason = res?.reason ?? 'не удалось разложить';
        log(`claude-place ${parsed.mode}: ${reason}`, 'warn');
        notify(`claude-wt: ${reason}`);
      }
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

    async 'claude-snapshot-restore'(payload) {
      const { id, sessionIds } = parseRestorePayload(payload);
      try {
        const { restored, skipped } = await winMan.restoreSnapshot({ id, sessionIds });
        log(`claude-wt snapshot ${id}: restored ${restored.length}, skipped ${skipped.length}`);
        if (!restored.length && !skipped.length) notify('claude-wt: нечего восстанавливать');
      } catch (e) {
        log(`claude-wt snapshot restore failed: ${e.message}`, 'error');
        notify(`claude-wt: ошибка восстановления — ${e.message}`);
      }
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
     *     пустую новую;
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
     */
    async 'claude-session-open'(payload) {
      const { id, action, cwd, name, terminal } = parseIdPayload(payload);
      if (!action) return;
      if (action !== 'terminal' && action !== 'terminal-new') {
        // Незнакомое действие не делает хотя бы ничего и жалуется — тем же
        // стилем, что terminal-new без cwd: в журнал и человеку, а не только
        // в журнал, иначе отказ был бы неотличим от тишины.
        const reason = `session-open: unsupported action ${action}`;
        log(`claude-wt ${reason}`, 'warn');
        notify(`claude-wt: ${reason}`);
        return;
      }
      const dir = typeof cwd === 'string' ? cwd.trim() : '';
      const asked = typeof name === 'string' ? name.trim() : '';
      // Имя терминала из просьбы. Пикер называет то, что выбрано у него;
      // пусто — берётся дефолт машины. Проверять имя здесь нечем и незачем:
      // реестр знает менеджер, и он же скажет в лог, если имя чужое.
      const wantedTerminal = typeof terminal === 'string' ? terminal.trim() : '';
      // Секундомер заводится здесь, а не в ветке подъёма: считать надо с
      // прихода просьбы, иначе разбор тела и поиск сессии выпадут из отчёта —
      // а именно поиск и оказался тем, что стоило больше секунды.
      const mark = startTiming(`session-open ${id ?? dir}`);
      // «Заведи ещё одну» — просьба про каталог и только про него. Сессию не
      // ищем даже при заданном id: нашлась бы та самая, рядом с которой просят
      // открыть новую, и вместо второго терминала человек получил бы подъём
      // первого — обратное тому, о чём просил.
      if (action === 'terminal-new') {
        if (!dir) {
          const reason = 'session-open: terminal-new нужен cwd проекта';
          log(`claude-wt ${reason}`, 'warn');
          notify(`claude-wt: ${reason}`);
          return;
        }
        await openProject(dir, asked, { reuseOpen: false, terminal: wantedTerminal });
        return;
      }
      const found = id ? findSession(id, mark) : null;
      if (found?.session) {
        await focusOrRestore(id, found.session, wantedTerminal, mark);
        return;
      }
      // Список сессий не прочитался — это поломка, а не «сессии тут нет»;
      // сказать о ней надо, но не встать: поднять сессию по id можно и без
      // списка, шаблон возобновления лежит в конфиге.
      if (found && !found.unknown) log(`claude-wt session-open: ${found.error}`, 'warn');
      if (id) {
        await resumeSession(id, dir, wantedTerminal);
        return;
      }
      if (dir) {
        await openProject(dir, asked, { terminal: wantedTerminal });
        return;
      }
      const reason = 'session-open: нужен id сессии или cwd проекта';
      log(`claude-wt session-open: ${reason}`, 'warn');
      notify(`claude-wt: ${reason}`);
    },
  };
}

export { claudeCommands, parseIdPayload, slotFromPayload };
