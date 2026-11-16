import { describe, it, expect } from 'vitest';
import { TBPF, taskbarLook, isWeztermPath, planTaskbar, resetOps } from './taskbar-helpers.js';

describe('taskbarLook', () => {
  // Соответствие из ~/.claude/hooks/wt-progress.sh: то, что wt рисует по OSC 9;4.
  it('работа — обычная полоса на 100', () => {
    expect(taskbarLook('active')).toEqual({ state: 'normal', value: 100, flash: false });
  });

  it('вопрос — пауза (жёлтая) и мигание кнопкой', () => {
    expect(taskbarLook('question')).toEqual({ state: 'paused', value: 22, flash: true });
  });

  it('простой и нет состояния — сброс', () => {
    for (const s of ['idle', null, undefined, 'что-то']) {
      expect(taskbarLook(s)).toEqual({ state: 'none', value: 0, flash: false });
    }
  });

  it('ход закончен и не просмотрен — мигание без полосы, просмотрен — сброс', () => {
    // В wt оранжевую кнопку давал звонок Claude Code на конец хода.
    expect(taskbarLook('review')).toEqual({ state: 'none', value: 0, flash: true });
    expect(taskbarLook('review', false)).toEqual({ state: 'none', value: 0, flash: true });
    expect(taskbarLook('review', true)).toEqual({ state: 'none', value: 0, flash: false });
  });

  it('unknown — бегущая полоса', () => {
    expect(taskbarLook('unknown')).toEqual({ state: 'indeterminate', value: 0, flash: false });
  });

  it('у каждого состояния есть флаг TBPFLAG', () => {
    for (const s of ['active', 'question', 'review', 'unknown']) {
      expect(TBPF[taskbarLook(s).state]).toBeTypeOf('number');
    }
  });
});

describe('isWeztermPath', () => {
  it('узнаёт wezterm-gui.exe по имени файла, без учёта регистра', () => {
    expect(isWeztermPath('C:\\Program Files\\WezTerm\\wezterm-gui.exe')).toBe(true);
    expect(isWeztermPath('C:/Program Files/WezTerm/WEZTERM-GUI.EXE')).toBe(true);
  });

  it('wt и консольный wezterm.exe — не то', () => {
    expect(isWeztermPath('C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal\\WindowsTerminal.exe')).toBe(false);
    expect(isWeztermPath('C:\\Program Files\\WezTerm\\wezterm.exe')).toBe(false);
    expect(isWeztermPath(undefined)).toBe(false);
  });
});

describe('planTaskbar', () => {
  const active = taskbarLook('active');
  const question = taskbarLook('question');
  const none = taskbarLook('idle');

  it('новое состояние — одна операция, без мигания', () => {
    const { ops, next } = planTaskbar(new Map(), new Map([[1, active]]), new Set([1]));
    expect(ops).toEqual([{ id: 1, state: 'normal', value: 100, flash: null }]);
    expect(next.get(1)).toEqual(active);
  });

  it('то же состояние на следующем тике — ничего не делать', () => {
    const { ops } = planTaskbar(new Map([[1, active]]), new Map([[1, active]]), new Set([1]));
    expect(ops).toEqual([]);
  });

  it('вопрос включает мигание один раз, а не на каждом тике', () => {
    const first = planTaskbar(new Map([[1, active]]), new Map([[1, question]]), new Set([1]));
    expect(first.ops).toEqual([{ id: 1, state: 'paused', value: 22, flash: 'on' }]);
    const again = planTaskbar(first.next, new Map([[1, question]]), new Set([1]));
    expect(again.ops).toEqual([]);
  });

  it('ответ на вопрос — сброс и конец мигания', () => {
    const { ops, next } = planTaskbar(new Map([[1, question]]), new Map([[1, none]]), new Set([1]));
    expect(ops).toEqual([{ id: 1, state: 'none', value: 0, flash: 'off' }]);
    expect(next.has(1)).toBe(false);
  });

  it('пустое состояние окна, которое никто не красил, — без операций', () => {
    const { ops, next } = planTaskbar(new Map(), new Map([[1, none]]), new Set([1]));
    expect(ops).toEqual([]);
    expect(next.size).toBe(0);
  });

  it('окно живо, но сессии больше нет — снять закраску', () => {
    const { ops, next } = planTaskbar(new Map([[1, question]]), new Map(), new Set([1]));
    expect(ops).toEqual([{ id: 1, state: 'none', value: 0, flash: 'off' }]);
    expect(next.size).toBe(0);
  });

  it('закрытое окно забывается без вызовов', () => {
    const { ops, next } = planTaskbar(new Map([[1, active]]), new Map(), new Set());
    expect(ops).toEqual([]);
    expect(next.size).toBe(0);
  });
});

describe('resetOps', () => {
  it('сбрасывает полосу и мигание каждому окну', () => {
    expect(resetOps([1, 2])).toEqual([
      { id: 1, state: 'none', value: 0, flash: 'off' },
      { id: 2, state: 'none', value: 0, flash: 'off' },
    ]);
  });
});
