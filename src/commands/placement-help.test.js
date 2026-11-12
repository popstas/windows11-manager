import { describe, it, expect } from 'vitest';
import { placementHelpMode, syncPlacementHelp } from '../../tauri-app/src/placement-help.js';

// Подсказка под селектом claudeWt.childPlacement во вкладке Claude: видно
// описание и схему ровно выбранного режима, пустое поле — умолчание stack.
describe('placement-help', () => {
  it.each([['', 'stack'], [null, 'stack'], ['yolo', 'stack'], ['free', 'free'], ['deck', 'deck'], ['stack', 'stack']])(
    'placementHelpMode(%j) -> %s', (value, mode) => expect(placementHelpMode(value)).toBe(mode));

  it('syncPlacementHelp показывает ровно один блок', () => {
    const nodes = ['stack', 'free', 'deck'].map(placementHelp => ({ dataset: { placementHelp }, hidden: false }));
    const root = { querySelectorAll: sel => (sel === '[data-placement-help]' ? nodes : []) };
    syncPlacementHelp(root, 'deck');
    expect(nodes.map(n => n.hidden)).toEqual([true, true, false]);
    syncPlacementHelp(root, '');
    expect(nodes.map(n => n.hidden)).toEqual([false, true, true]);
  });
});
