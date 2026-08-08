/**
 * Автоматическая расстановка окон при их появлении.
 *
 * Переехало из windows-mqtt/src/modules/windows.js: там при старте модуля звали
 * `winMan.placeWindowOnOpen()`, а при остановке — `winMan.stopPlaceNewWindows()`.
 * В этом проекте `placeWindowOnOpen()` есть и экспортируется, но не звал её
 * никто, и с `windows.enabled: false` на той стороне расстановка пропала совсем.
 *
 * Про бюджет опроса (AGENTS.md, «claude-wt polling budget»). Внутри
 * `startPlaceNewWindows()` крутится таймер раз в 1500 мс, и это законный вид
 * опроса: в цикле зовётся только `getVisibleWindowIds()` (EnumWindows +
 * IsWindowVisible, ~1-3 мс), а дорогой `getWindows()` — лишь когда в системе
 * появился незнакомый hwnd, то есть по событию, а не по расписанию. Номер
 * рабочего стола в цикле не читается вовсе. Запрет из AGENTS.md касается именно
 * `getWindows()` и номера стола в цикле — он не нарушен.
 */

/**
 * Завести автоматическую расстановку, если она включена в конфиге.
 *
 * Возвращает `{ stop() }` в любом случае: вызывающему не приходится помнить,
 * завелась ли она.
 */
function startAutoplacer({ winMan, config, log }) {
  if (!config?.placeWindowOnOpen) return { stop() {} };
  if (typeof winMan.placeWindowOnOpen !== 'function') {
    log('placeWindowOnOpen: в библиотеке нет такой функции — окна при открытии '
      + 'расставляться не будут', 'error');
    return { stop() {} };
  }

  // Не await: служба не должна ждать расстановщика, чтобы подключиться к
  // брокеру. Отказ при этом обязан быть виден — необработанное отклонение в
  // node 22 роняет процесс молча и целиком.
  Promise.resolve()
    .then(() => winMan.placeWindowOnOpen())
    .then(() => log('placeWindowOnOpen: расстановка новых окон включена'))
    .catch((e) => log(`placeWindowOnOpen: не удалось включить расстановку: ${e.message}`, 'error'));

  return {
    stop() {
      try {
        winMan.stopPlaceNewWindows();
      } catch (e) {
        log(`placeWindowOnOpen: остановка расстановки не удалась: ${e.message}`, 'warn');
      }
    },
  };
}

export { startAutoplacer };
