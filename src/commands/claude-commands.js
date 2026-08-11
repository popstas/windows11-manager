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
  function findSession(id) {
    let res;
    try {
      res = winMan.claudeWtSessions();
    } catch (e) {
      return { error: e.message };
    }
    if (!res.ok) return { error: res.reason };
    const session = res.sessions.find((s) => s.id === id);
    return session ? { session } : { error: `unknown session ${id}` };
  }

  async function restoreOne(id) {
    try {
      const { restored, skipped } = await winMan.restoreClaudeSessions({ sessionIds: [id] });
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
   * Переход на её рабочий стол идёт первым: фокус на окне с чужого стола
   * Windows отдаёт молча и без результата.
   */
  async function focusOrRestore(id, session) {
    if (chooseAction(session, (windowId) => !!winMan.getWindowById(windowId)) === 'restore') {
      await restoreOne(id);
      return;
    }
    const current = await winMan.virtualDesktop.GetWindowDesktopNumber(session.windowId);
    const target = resolveDesktopSwitch(current);
    if (target !== null) await winMan.virtualDesktop.GoToDesktopNumber(target);
    if (!winMan.focusWindowById(session.windowId)) log(`claude-wt: ${id} is not on screen`, 'warn');
  }

  /**
   * Открыть проект терминалом — тем же путём, что и `claude-wt open-project`.
   *
   * Ради этого вся просьба и заведена: каталог проекта переводит в профиль
   * Windows Terminal только эта машина (`claudeWt.projects` → `profileForCwd`),
   * и собранная в пикере команда `wt.exe` профиль теряет. `openClaudeProject`
   * сначала ищет уже открытую сессию этого каталога и поднимает её окно, и
   * только если такой нет — заводит новую: второй терминал на тот же проект
   * человеку не нужен.
   *
   * Имя нужно `claude -n` при запуске новой сессии. По умолчанию берётся
   * из каталога — ровно так же его считает сам `openClaudeProject`, и так же
   * называет новую сессию ccfzf.
   */
  async function openProject(cwd, name, { reuseOpen = true } = {}) {
    const opts = { cwd, name: name || basenameOfCwd(cwd) };
    // Ключа `reuseOpen: true` в обычной просьбе нет: у `openClaudeProject` это
    // и так умолчание, а лишний ключ пришлось бы дописать в каждый
    // существующий тест, ничего этим не проверив.
    if (!reuseOpen) opts.reuseOpen = false;
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

  async function focus(payload) {
    const { id } = parseIdPayload(payload);
    if (!id) return;
    const found = findSession(id);
    if (found.error) {
      log(`claude-wt: ${found.error}`, 'warn');
      notify(`claude-wt: ${found.error}`);
      return;
    }
    await focusOrRestore(id, found.session);
  }

  return {
    'claude-focus': focus,

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
     *  2. сессии в слотах нет, но известен каталог — открываем проект;
     *  3. нет ни того, ни другого — говорим об этом в журнал и человеку.
     *     Молчание здесь было бы неотличимо от успеха.
     */
    async 'claude-session-open'(payload) {
      const { id, action, cwd, name } = parseIdPayload(payload);
      if (!action) return;
      if (action !== 'terminal' && action !== 'terminal-new') {
        log(`claude-wt session-open: unsupported action ${action}`, 'warn');
        return;
      }
      const dir = typeof cwd === 'string' ? cwd.trim() : '';
      const asked = typeof name === 'string' ? name.trim() : '';
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
        await openProject(dir, asked, { reuseOpen: false });
        return;
      }
      const found = id ? findSession(id) : null;
      if (found?.session) {
        await focusOrRestore(id, found.session);
        return;
      }
      if (dir) {
        await openProject(dir, asked);
        return;
      }
      const reason = found?.error ?? 'session-open: нужен id известной сессии или cwd проекта';
      log(`claude-wt session-open: ${reason}`, 'warn');
      notify(`claude-wt: ${reason}`);
    },
  };
}

export { claudeCommands, parseIdPayload, slotFromPayload };
