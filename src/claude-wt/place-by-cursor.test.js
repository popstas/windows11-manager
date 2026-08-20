// Кому окно достаётся после постановки по курсору: автоматике или человеку.
//
// Пометка (`markNoAutoplace`) закрывает окно и от расстановщика новых окон, и
// от демона, тянущего окно в запомненные границы. Поводов у неё два, и второй
// добавлен вместе с Ctrl в пикере. Поведением этого не поймать вовсе: разница
// видна лишь тем, что через секунду окно **не** уехало, а не уехать оно может
// и просто потому, что правила для него не нашлось.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const markNoAutoplace = vi.fn(() => true);
vi.mock('../no-autoplace.js', () => ({
  markNoAutoplace: (...args) => markNoAutoplace(...args),
  noAutoplaceIds: () => new Set(),
}));

const { placeByCursor } = await import('./cursor-place.js');

const target = (extra) => ({
  rule: { window: 77, x: 0, y: 0, width: 800, height: 600 },
  primary: true,
  pinned: false,
  ...extra,
});

describe('placeByCursor', () => {
  beforeEach(() => markNoAutoplace.mockClear());

  it('на главном экране без просьбы автоматику не трогает', async () => {
    // Правила из `config.windows` и память слотов там делают ровно то, чего от
    // них ждут, а выключенная расстановка выглядела бы поломкой конфига.
    expect(await placeByCursor(target(), vi.fn(), 'a window')).toBe(true);
    expect(markNoAutoplace).not.toHaveBeenCalled();
  });

  it('неглавный экран помечает, как помечал', async () => {
    await placeByCursor(target({ primary: false }), vi.fn(), 'a window');
    expect(markNoAutoplace).toHaveBeenCalledWith(77);
  });

  it('прямая просьба экрана не спрашивает', async () => {
    // Ctrl на строке пикера: галка «на активном экране» отвечает на вопрос «как
    // открывать всегда», модификатор — «как открыть вот эту», и на главном
    // экране он значит ровно то же, что на соседнем.
    await placeByCursor(target({ pinned: true }), vi.fn(), 'a window');
    expect(markNoAutoplace).toHaveBeenCalledWith(77);
  });

  it('перебитую память о месте помечает и на главном экране', async () => {
    // Слот у окна есть, и курсор его только что перебил. Не пометь — демон при
    // первой же привязке утащил бы окно в запомненные границы и на запомненный
    // стол (`step` в `tracker-helpers.js`), то есть отменил бы ровно то, о чём
    // человек просил. Оговорка про главный экран тут не работает: она про
    // окна, у которых своего места ещё нет, и правила `config.windows` для них
    // делают ожидаемое.
    await placeByCursor(target({ remembered: true }), vi.fn(), 'a window');
    expect(markNoAutoplace).toHaveBeenCalledWith(77);
  });

  it('не переехавшее окно не помечается', async () => {
    // Помеченное, но оставшееся на прежнем месте окно — худшее из двух: и не
    // там, и без расстановки.
    const place = vi.fn().mockRejectedValue(new Error('setBounds failed'));
    expect(await placeByCursor(target({ pinned: true }), place, 'a window')).toBe(false);
    expect(markNoAutoplace).not.toHaveBeenCalled();
  });
});
