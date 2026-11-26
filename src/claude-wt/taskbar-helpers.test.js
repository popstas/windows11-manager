import { describe, it, expect } from 'vitest';
import {
  TBPF, taskbarLook, isQuietAgent, isWeztermPath, planTaskbar, resetOps, markHolds, pruneMarks,
  cacheWarnDue, blinkBar, cacheWarnKey, parseCacheWarn,
} from './taskbar-helpers.js';

describe('taskbarLook', () => {
  // Соответствие из ~/.claude/hooks/wt-progress.sh: то, что wt рисует по OSC 9;4.
  it('работа — обычная полоса на 100', () => {
    expect(taskbarLook('active')).toEqual({ state: 'normal', value: 100, flash: false });
  });

  it('вопрос — пауза (жёлтая) и мигание кнопкой', () => {
    expect(taskbarLook('question')).toEqual({ state: 'paused', value: 22, flash: true });
  });

  it('простой и нет состояния — сброс', () => {
    for (const s of [null, undefined, 'что-то']) {
      expect(taskbarLook(s)).toEqual({ state: 'none', value: 0, flash: false });
    }
  });

  it('простой мигание не трогает', () => {
    expect(taskbarLook('idle')).toEqual({ state: 'none', value: 0, flash: null });
  });

  it('ход закончен и не просмотрен — мигание без полосы, просмотрен — сброс', () => {
    // В wt оранжевую кнопку давал звонок Claude Code на конец хода.
    expect(taskbarLook('review')).toEqual({ state: 'none', value: 0, flash: true });
    expect(taskbarLook('review', false)).toEqual({ state: 'none', value: 0, flash: true });
    expect(taskbarLook('review', true)).toEqual({ state: 'none', value: 0, flash: false });
  });

  it('фоновая команда при законченном ходе — зелёная полоса на 2%, мигание как без неё', () => {
    expect(taskbarLook('idle', false, null, true)).toEqual({ state: 'normal', value: 2, flash: null });
    expect(taskbarLook('review', false, null, true)).toEqual({ state: 'normal', value: 2, flash: true });
    expect(taskbarLook('review', true, null, true)).toEqual({ state: 'normal', value: 2, flash: false });
    expect(taskbarLook('review', true, 'unread', true)).toEqual({ state: 'normal', value: 2, flash: true });
    expect(taskbarLook('idle', false, 'seen', true)).toEqual({ state: 'normal', value: 2, flash: false });
  });

  it('работа и вопрос фоновой командой не перекрашиваются', () => {
    expect(taskbarLook('active', false, null, true)).toEqual(taskbarLook('active'));
    expect(taskbarLook('question', false, null, true)).toEqual(taskbarLook('question'));
    expect(taskbarLook(null, false, null, true)).toEqual({ state: 'none', value: 0, flash: false });
  });

  it('конец фоновой команды снимает полосу, мигание сохраняется', () => {
    const shell = taskbarLook('review', false, null, true);
    const { ops } = planTaskbar(new Map([[1, shell]]), new Map([[1, taskbarLook('review')]]), new Set([1]));
    expect(ops).toEqual([{ id: 1, state: 'none', value: 0, flash: null }]);
  });

  it('тихий конец хода — без мигания, полоса как у review/idle', () => {
    // Ход head начат ребёнком, ребёнок работает — Стасу делать нечего (26.11).
    expect(taskbarLook('review', false, null, false, true)).toEqual({ state: 'none', value: 0, flash: false });
    // false, а не null: idle должен погасить кнопку, зажжённую ещё на review.
    expect(taskbarLook('idle', false, null, false, true)).toEqual({ state: 'none', value: 0, flash: false });
    expect(taskbarLook('review', false, null, true, true)).toEqual({ state: 'normal', value: 2, flash: false });
  });

  it('unread сильнее тихого, seen — как было', () => {
    expect(taskbarLook('review', true, 'unread', false, true).flash).toBe(true);
    expect(taskbarLook('idle', false, 'unread', false, true).flash).toBe(true);
    expect(taskbarLook('review', false, 'seen', false, true).flash).toBe(false);
  });

  it('вопрос и работа тихими не бывают', () => {
    expect(taskbarLook('question', false, null, false, true)).toEqual(taskbarLook('question'));
    expect(taskbarLook('active', false, null, false, true)).toEqual(taskbarLook('active'));
  });

  it('уже мигающая с review кнопка гаснет, когда ход стал тихим', () => {
    const lit = taskbarLook('review');
    const { ops } = planTaskbar(new Map([[1, lit]]), new Map([[1, taskbarLook('idle', false, null, false, true)]]), new Set([1]));
    expect(ops).toEqual([{ id: 1, state: 'none', value: 0, flash: 'off' }]);
  });

  it('isQuietAgent: quiet хука без «непросмотрено» в слоте', () => {
    expect(isQuietAgent({ agentQuiet: true })).toBe(true);
    expect(isQuietAgent({ agentQuiet: true, agentUnread: true })).toBe(false);
    expect(isQuietAgent({ agentQuiet: false })).toBe(false);
    expect(isQuietAgent({})).toBe(false);
    expect(isQuietAgent(null)).toBe(false);
  });

  it('unknown — бегущая полоса', () => {
    expect(taskbarLook('unknown')).toEqual({ state: 'indeterminate', value: 0, flash: false });
  });

  it('у каждого состояния есть флаг TBPFLAG', () => {
    for (const s of ['active', 'question', 'review', 'idle', 'unknown']) {
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
  const none = taskbarLook(null);

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

describe('отметки человека (Mark seen / Mark unread)', () => {
  it('seen гасит в любом состоянии, полоса остаётся', () => {
    expect(taskbarLook('review', false, 'seen')).toEqual({ state: 'none', value: 0, flash: false });
    expect(taskbarLook('idle', false, 'seen')).toEqual({ state: 'none', value: 0, flash: false });
    expect(taskbarLook('question', false, 'seen')).toEqual({ state: 'paused', value: 22, flash: false });
  });
  it('unread зажигает и review, и idle, даже просмотренные', () => {
    expect(taskbarLook('review', true, 'unread')).toEqual({ state: 'none', value: 0, flash: true });
    expect(taskbarLook('idle', true, 'unread')).toEqual({ state: 'none', value: 0, flash: true });
    expect(taskbarLook('question', true, 'unread')).toEqual({ state: 'paused', value: 22, flash: true });
  });
  it('работа отметок не слушает', () => {
    for (const m of ['seen', 'unread']) expect(taskbarLook('active', false, m)).toEqual({ state: 'normal', value: 100, flash: false });
  });
});

describe('markHolds', () => {
  it('держится, пока хук не написал новое', () => {
    expect(markHolds({ kind: 'seen', at: 100 }, 99)).toBe(true);
    expect(markHolds({ kind: 'unread', at: 100 }, 100)).toBe(true);
    expect(markHolds({ kind: 'seen', at: 100 }, 0)).toBe(true);
    expect(markHolds({ kind: 'seen', at: 100 }, 101)).toBe(false);
    expect(markHolds(undefined, 1)).toBe(false);
    expect(markHolds({ kind: 'seen', at: 0 }, 0)).toBe(false);
  });
});

describe('pruneMarks', () => {
  it('оставляет действующие, выкидывает перекрытые хуком и сессии без окна', () => {
    const marks = new Map([['a', { kind: 'seen', at: 100 }], ['b', { kind: 'unread', at: 100 }], ['c', { kind: 'seen', at: 100 }]]);
    const agents = [{ sessionId: 'a', agentUpdated: 90 }, { sessionId: 'b', agentUpdated: 150 }];
    expect([...pruneMarks(marks, agents)]).toEqual([['a', { kind: 'seen', at: 100 }]]);
  });
});

describe('cacheWarnDue', () => {
  const at = 1_000_000;
  const warnSec = 600;
  const end = at + 3595;
  const waiting = { agentState: 'review', agentUpdated: at };
  it('мигает от порога до конца кеша', () => {
    expect(cacheWarnDue({ cacheAt: at }, warnSec, end - 601, waiting)).toBe(false);
    expect(cacheWarnDue({ cacheAt: at }, warnSec, end - 600, waiting)).toBe(true);
    expect(cacheWarnDue({ cacheAt: at }, warnSec, end - 1, waiting)).toBe(true);
    expect(cacheWarnDue({ cacheAt: at }, warnSec, end, waiting)).toBe(false);
  });
  it('опоздавший набор мигает сразу, если кеш жив', () => {
    expect(cacheWarnDue({ cacheAt: at }, warnSec, end - 120, waiting)).toBe(true);
  });
  it('0 — выключено', () => {
    expect(cacheWarnDue({ cacheAt: at }, 0, end - 60, waiting)).toBe(false);
  });
  it('работающая сессия и новый ход не мигают', () => {
    expect(cacheWarnDue({ cacheAt: at }, warnSec, end - 60, { agentState: 'active', agentUpdated: at })).toBe(false);
    expect(cacheWarnDue({ cacheAt: at }, warnSec, end - 60, { agentState: 'review', agentUpdated: at + 31 })).toBe(false);
    expect(cacheWarnDue({ cacheAt: at }, warnSec, end - 60, { agentState: 'question', agentUpdated: at + 31 })).toBe(false);
  });
  it('уведомление idle двигает updated без вызова API — мигание держится', () => {
    expect(cacheWarnDue({ cacheAt: at }, warnSec, end - 60, { agentState: 'idle', agentUpdated: at + 60 })).toBe(true);
  });
  it('нет окна у сессии — не мигает', () => {
    expect(cacheWarnDue({ cacheAt: at }, warnSec, end - 60, null)).toBe(false);
  });
});

describe('blinkBar', () => {
  it('вкл — жёлтая полная', () => {
    expect(blinkBar({ state: 'paused', value: 22, flash: true }, true)).toEqual({ state: 'paused', value: 100 });
  });
  it('выкл — полоса прежнего вида', () => {
    expect(blinkBar({ state: 'paused', value: 22, flash: true }, false)).toEqual({ state: 'paused', value: 22 });
    expect(blinkBar({ state: 'normal', value: 2, flash: false }, false)).toEqual({ state: 'normal', value: 2 });
    expect(blinkBar(null, false)).toEqual({ state: 'none', value: 0 });
  });
});

describe('cacheWarnKey', () => {
  it('ключ снятия — пара id и метки кеша', () => {
    expect(cacheWarnKey('a', 5)).toBe('a:5');
    expect(cacheWarnKey('a', 5)).not.toBe(cacheWarnKey('a', 6));
  });
});

describe('parseCacheWarn', () => {
  it('минуты → секунды, набор по id', () => {
    const r = parseCacheWarn('{"warnMin":10,"sessions":[{"id":"a","cacheAt":5}]}');
    expect(r.warnSec).toBe(600);
    expect([...r.warns]).toEqual([['a', { cacheAt: 5 }]]);
  });
  it('кривое тело и записи без cacheAt отбрасываются', () => {
    expect(parseCacheWarn('{').warnSec).toBe(0);
    expect([...parseCacheWarn({ warnMin: 10, sessions: [{ id: 'a' }, { cacheAt: 5 }] }).warns]).toEqual([]);
  });
  it('warnMin вне 0…59 — выключено', () => {
    expect(parseCacheWarn({ warnMin: 60, sessions: [] }).warnSec).toBe(0);
    expect(parseCacheWarn({ warnMin: -1, sessions: [] }).warnSec).toBe(0);
  });
});
