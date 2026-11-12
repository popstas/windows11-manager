/**
 * Подсказка под селектом `claudeWt.childPlacement` во вкладке Claude: описание
 * и мини-схема выбранного режима. Блоки — статичная разметка в index.html
 * (`data-placement-help="<режим>"`), здесь только выбор видимого.
 *
 * Без `window` и `document` намеренно: модуль гоняет vitest
 * (`src/commands/placement-help.test.js`).
 */

const MODES = ['stack', 'free', 'deck'];

/** Режим, чью подсказку показывать: пусто и незнакомое — умолчание stack. */
export function placementHelpMode(value) {
  return MODES.includes(value) ? value : MODES[0];
}

/** Показать блок выбранного режима, остальные спрятать. */
export function syncPlacementHelp(root, value) {
  const mode = placementHelpMode(value);
  for (const node of root.querySelectorAll('[data-placement-help]')) {
    node.hidden = node.dataset.placementHelp !== mode;
  }
}
