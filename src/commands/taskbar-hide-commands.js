/**
 * Прятание кнопок погашенных сессий с панели задач:
 * `claude-taskbar-hide {sessions}` — набор от пикера (раз в 5 минут),
 * `claude-window-taskbar {id, taskbar: 'hide'|'show'|null}` — явная отметка из
 * claude-wt CLI, `claude-taskbar-show-all {}` — вернуть все кнопки (пункт
 * трея), `claude-taskbar-release {startedAt}` — вернуть все кнопки, сохранив
 * отметки, и больше не прятать (трей, перед kill-ом службы). Доступны по http
 * (`/claude-wt/...`) и по MQTT `<base>/<команда>` — кроме release: он только
 * по http (`HTTP_ONLY_COMMANDS` в service.js).
 *
 * `startedAt` у release — мс старта процесса CLI. Служба, поднявшаяся позже,
 * его отклоняет: трей мог не дождаться release, человек — поднять службу
 * заново, и запоздалый POST выключил бы прятание у свежей службы.
 */
import { parseIdPayload } from './claude-commands.js';
import { isSessionUuid } from '../claude-wt/session-name-helpers.js';

function taskbarHideCommands({ store, service, log }) {
  let lastCount = null;

  return {
    // В журнал — только при смене числа: пикер повторяет набор каждые пять минут.
    async 'claude-taskbar-hide'(payload) {
      const count = service.setSet(payload) ?? 0;
      if (count !== lastCount) {
        lastCount = count;
        log(`claude-wt taskbar hide: ${count} session(s)`);
      }
      return service.isReleased?.() ? { ok: true, count, released: true } : { ok: true, count };
    },
    async 'claude-window-taskbar'(payload) {
      const body = parseIdPayload(payload);
      const { id, taskbar } = body;
      if (!id || !isSessionUuid(id)) return { ok: false, reason: 'bad id' };
      if (taskbar !== null && taskbar !== 'hide' && taskbar !== 'show') {
        return { ok: false, reason: 'need hide, show or null' };
      }
      try {
        store.set(id, taskbar);
      } catch (e) {
        log(`claude-wt window taskbar ${id}: не записано: ${e.message}`, 'error');
        return { ok: false, reason: e.message };
      }
      service.tick();
      const status = service.statusOf(id);
      log(`claude-wt window taskbar ${id}: ${taskbar ?? 'снята'} (${status.applied ? 'applied' : status.reason})`);
      return { ok: true, id, taskbar, ...status };
    },
    async 'claude-taskbar-show-all'() {
      const shown = service.showAll();
      log(`claude-wt taskbar show all: ${shown} button(s)`);
      return { ok: true, shown };
    },
    async 'claude-taskbar-release'(payload) {
      const { startedAt } = parseIdPayload(payload);
      if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return { ok: false, reason: 'need startedAt' };
      if (service.startedAt > startedAt) return { ok: false, reason: 'stale release: service started after the request' };
      return { ok: true, shown: service.release() };
    },
  };
}

export { taskbarHideCommands };
