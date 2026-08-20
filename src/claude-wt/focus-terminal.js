import { focusWindowById, getActiveWindowId } from '../windows.js';
import { virtualDesktop } from '../virtual-desktop.js';
import { noTiming } from './timing.js';

/**
 * Сфокусировать окно терминала, заплатив за столы только если пришлось.
 *
 * Раньше порядок был обратный: спросить у `VirtualDesktop11.exe` стол окна,
 * перейти на него, потом фокус. Два запуска процесса на каждый перевод фокуса —
 * 208 мс замером на popstas-pc, и платились они всегда, даже когда окно и так
 * на текущем столе, то есть почти всегда.
 *
 * Здесь сначала пробуется сам фокус, а потом проверяется, вышло ли: окно стало
 * передним — делать больше нечего, и ни одного процесса не запущено. Проверка
 * бесплатная, и в этом весь трюк: `getActiveWindowId()` — это
 * `GetForegroundWindow()` и ничего больше, тогда как любой вопрос про столы
 * стоит запуска exe. Не вышло — окно на другом столе (фокус на такое Windows
 * отдаёт молча и без результата), и вот тогда переход оправдан.
 *
 * `knownDesktop` (1-based, как хранит слот) снимает и оставшийся вопрос: стол
 * знает тот, кто только что сам поставил туда окно, и спрашивать его у Windows
 * незачем.
 *
 * Своим модулем, а не в `project.js`, ради восстановления: `restore.js` тоже
 * поднимает окно, а `project.js` уже импортирует `waitForNewWindow` оттуда —
 * обратный импорт замкнул бы круг.
 */
async function focusTerminalWindow(windowId, mark = noTiming, knownDesktop = null) {
  if (focusWindowById(windowId) && getActiveWindowId() === windowId) {
    mark('focus');
    return true;
  }
  try {
    const known = Number.isFinite(knownDesktop) && knownDesktop > 0 ? knownDesktop - 1 : null;
    const current = known ?? await virtualDesktop.GetWindowDesktopNumber(windowId);
    if (current !== undefined && current !== null && current !== '') {
      const target = Number(current);
      if (!Number.isNaN(target)) await virtualDesktop.GoToDesktopNumber(target);
    }
  } catch {
    // Focus still worth trying if the desktop query fails.
  }
  mark('desktop');
  const ok = focusWindowById(windowId);
  mark('focus');
  return ok;
}

export { focusTerminalWindow };
