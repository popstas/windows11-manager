/**
 * Явная иконка и значок окна сессии из claude-wt CLI:
 * `claude-window-icon {id, icon: <имя>|null}`, `claude-window-badge {id, badge}`,
 * `claude-window-icons {}`. Только http (`/claude-wt/window-*`) — CLI ходит
 * лишь по нему. Спека — docs/superpowers/specs/2026-11-23-session-icon-design.md.
 *
 * Маршрут сам пишет хранилище и лишь подталкивает службу иконок, если она
 * есть: заданное сохраняется всегда (`ok: true`), а встало ли — `applied` и
 * `reason` от службы. Отказ (`ok: false`) — только когда сохранять нечего:
 * нет папки иконок, неизвестное имя.
 */
import { listIcons, resolveIcon } from '../claude-wt/session-icons.js';
import { parseIdPayload } from './claude-commands.js';
import { isSessionUuid } from '../claude-wt/session-name-helpers.js';

const NO_DIR = 'icons dir not configured (claudeWt.windowIcons.dir)';

function sessionIconCommands({ store, icons, getCfg, log }) {
  const dirOf = () => getCfg()?.windowIcons?.dir || '';

  function setter(kind) {
    return async (payload) => {
      const body = parseIdPayload(payload);
      const { id } = body;
      if (!id) return { ok: false, reason: 'no id' };
      // Только UUID: http без авторизации, а id — ключ хранилища на диске
      // (`__proto__`, мусорные id тысячами).
      if (!isSessionUuid(id)) return { ok: false, reason: 'bad id' };
      const name = body[kind];
      if (name !== null && (typeof name !== 'string' || !name)) {
        return { ok: false, reason: `need ${kind} name or null` };
      }
      let file = null;
      if (name !== null) {
        const dir = dirOf();
        if (!dir) return { ok: false, reason: NO_DIR };
        try {
          file = resolveIcon(name, dir);
        } catch {
          return { ok: false, reason: `icons dir unreadable: ${dir}` };
        }
        if (!file) return { ok: false, reason: `unknown icon ${name}; see claude-wt window icons` };
      }
      try {
        store.set(id, kind, file);
      } catch (e) {
        log(`claude-wt window ${kind} ${id}: не записано: ${e.message}`, 'error');
        return { ok: false, reason: e.message };
      }
      const service = icons();
      service?.tick();
      const status = service?.statusOf(id, kind) ?? { applied: false, reason: 'no icon service' };
      const what = file ?? (kind === 'icon' ? 'снята' : 'снят');
      log(`claude-wt window ${kind} ${id}: ${what} (${status.applied ? 'applied' : status.reason})`);
      return { ok: true, id, [kind]: file, ...status };
    };
  }

  return {
    'claude-window-icon': setter('icon'),
    'claude-window-badge': setter('badge'),
    async 'claude-window-icons'() {
      const dir = dirOf();
      if (!dir) return { ok: false, reason: NO_DIR };
      try {
        return { ok: true, dir, names: listIcons(dir) };
      } catch {
        return { ok: false, reason: `icons dir unreadable: ${dir}` };
      }
    },
  };
}

export { sessionIconCommands };
