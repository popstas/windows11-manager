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
 * Свёрнуто ли окно.
 *
 * Windows паркует свёрнутое окно далеко за пределами всех экранов (x = -32000),
 * и снаружи это единственный признак: размеры остаются прежними, а флага, по
 * которому node-window-manager отличил бы свёрнутое от обычного, нет. Порог
 * -10000 берёт запас на честные отрицательные координаты монитора слева от
 * главного: -1920 у соседнего экрана и -32000 у свёрнутого не спутать.
 */
function isMinimized(bounds) {
  const x = bounds?.x;
  return typeof x === 'number' && x < -10000;
}

export { matchRules, isWindowExcluded, isMinimized };
