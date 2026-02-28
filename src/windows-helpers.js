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

export { matchRules, isWindowExcluded };
