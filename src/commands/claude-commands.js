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
      const { restored } = await winMan.restoreClaudeSessions({ sessionIds: [id] });
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
      const parsed = parseIdPayload(payload);
      const slot = parsed.slot !== undefined ? parsed.slot : parsed.id;
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
     * Просьба пикера с чужой машины открыть сессию здесь.
     *
     * Пока поддержано одно действие — `terminal`: остальные (cursor, explorer,
     * pr) осмысленны только там, где стоит человек, и пикер выполняет их у
     * себя. Уже открытую сессию поднимаем, а не открываем второй копией.
     */
    async 'claude-session-open'(payload) {
      const parsed = parseIdPayload(payload);
      const { id, action } = parsed;
      if (!id || !action) return;
      if (action !== 'terminal') {
        log(`claude-wt session-open: unsupported action ${action}`, 'warn');
        return;
      }
      const found = findSession(id);
      if (found.error) {
        log(`claude-wt session-open: ${found.error}`, 'warn');
        notify(`claude-wt: ${found.error}`);
        return;
      }
      await focusOrRestore(id, found.session);
    },
  };
}

export { claudeCommands, parseIdPayload };
