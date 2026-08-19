/** Pure helper functions for windows logic. No external I/O or config. */

import { isWindowMatchRule } from './window-match.js';

function matchRules(window, rules) {
  const matched = rules.filter(rule => isWindowMatchRule(window, rule));
  const single = matched.find(rule => rule.single);
  if (single) return [single];
  return matched;
}

function isWindowExcluded({ title, path, excludedTitles, excludedPaths }) {
  for (const ex of excludedTitles ?? []) {
    if (title?.includes(ex)) return true;
  }
  for (const ex of excludedPaths ?? []) {
    if (path?.includes(ex)) return true;
  }
  return false;
}

/**
 * Порог, за которым окно считается свёрнутым.
 *
 * Windows паркует свёрнутое окно далеко за пределами всех экранов, и снаружи
 * это единственный признак: размеры остаются прежними, а флага, по которому
 * node-window-manager отличил бы свёрнутое от обычного, нет. Числа парковки у
 * Windows 11 разные — -32000 в описаниях, -20480 замером на popstas-pc
 * 19.08.2026, — поэтому порог берёт запас, а не сверяется с точным значением.
 * -10000 при этом не задевает честные отрицательные координаты монитора слева
 * от главного: -1920 у соседнего экрана и -20480 у свёрнутого не спутать.
 *
 * Своё число рядом заводить нельзя: ровно так фокус и сломался — в windows.js
 * стоял свой порог -30000, разошёлся с этим и не срабатывал никогда.
 */
const MINIMIZED_X = -10000;

/**
 * Свёрнуто ли окно. Единственное место, где это решается.
 *
 * Читателей четыре: расстановка (`placement.js`), раскладка сессий
 * (`claude-layout.js`), фокус (`windows.js`) и трекер claude-wt — последний
 * через тонкую обёртку в `claude-wt/tracker-helpers.js`, принимающую окно
 * целиком. Копия правила разошлась бы молча: окно не пошло бы в раскладку, а
 * в списке на той стороне выглядело бы обычным — и поймать это можно было бы
 * только глазами на живой машине.
 */
function isMinimized(bounds, minimizedX = MINIMIZED_X) {
  return Number.isFinite(bounds?.x) && bounds.x < minimizedX;
}

export { matchRules, isWindowExcluded, isMinimized, MINIMIZED_X };
