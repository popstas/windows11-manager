import { describe, it, expect } from 'vitest';
import {
  normalizeProgress, sessionDescription, lastActivityAt, seenSinceUpdate,
} from './progress-helpers.js';

describe('normalizeProgress', () => {
  it('keeps a well-formed record', () => {
    expect(normalizeProgress({
      state: 'active', updated: 100, message: 'hi', summary: '', lastSummary: 'Закоммитил',
      prompt: 'добавь тесты', costUsd: 12, contextPct: 47,
    })).toEqual({
      state: 'active', updated: 100, event: '', message: 'hi', summary: '', lastSummary: 'Закоммитил',
      prompt: 'добавь тесты', costUsd: 12, contextPct: 47, branch: '', pr_url: '',
    });
  });

  it('treats missing money and context as zero', () => {
    // Их пишет не хук, а перехватчик статуслайна, и стоит он не у каждой
    // сессии: ноль здесь означает «не знаем», и показывать его как «$0» нельзя.
    const bare = normalizeProgress({ state: 'active', updated: 100 });
    expect(bare.costUsd).toBe(0);
    expect(bare.contextPct).toBe(0);
    expect(normalizeProgress({ state: 'active', updated: 1, costUsd: '12' }).costUsd).toBe(0);
  });

  it('treats a missing summary as no summary', () => {
    // Хук без правки на сводку — обычное дело: файл пишет чужой процесс на
    // другой машине, и он может быть старой версии.
    expect(normalizeProgress({ state: 'active', updated: 100 })?.summary).toBe('');
    expect(normalizeProgress({ state: 'active', updated: 100, summary: 42 })?.summary).toBe('');
  });

  it('treats a missing prompt as no prompt', () => {
    // То же, что у summary: старый хук поля не писал, а нестрока — мусор.
    expect(normalizeProgress({ state: 'active', updated: 100 })?.prompt).toBe('');
    expect(normalizeProgress({ state: 'active', updated: 100, prompt: 7 })?.prompt).toBe('');
  });

  it('accepts every state the hook writes', () => {
    for (const state of ['active', 'question', 'review', 'idle']) {
      expect(normalizeProgress({ state, updated: 1 })?.state).toBe(state);
    }
  });

  it('drops a state it does not know but keeps the timestamp', () => {
    // The hook has an `unknown` branch of its own, and the file is written by
    // another process: an unrecognised state must not reach the picker, yet
    // the write itself still proves the session was alive at that moment.
    expect(normalizeProgress({ state: 'unknown', updated: 42 }))
      .toEqual({
        state: null, updated: 42, event: '', message: '', summary: '', lastSummary: '',
        prompt: '', costUsd: 0, contextPct: 0, branch: '', pr_url: '',
      });
  });

  it('returns null when there is neither a state nor a time', () => {
    expect(normalizeProgress({ state: 'nope' })).toBeNull();
    expect(normalizeProgress({})).toBeNull();
    expect(normalizeProgress(null)).toBeNull();
    expect(normalizeProgress('active')).toBeNull();
  });

  it('ignores a non-numeric timestamp', () => {
    expect(normalizeProgress({ state: 'idle', updated: 'soon' }))
      .toEqual({
        state: 'idle', updated: 0, event: '', message: '', summary: '', lastSummary: '',
        prompt: '', costUsd: 0, contextPct: 0, branch: '', pr_url: '',
      });
  });

  it('ignores a non-string message', () => {
    expect(normalizeProgress({ state: 'question', updated: 5, message: { a: 1 } }).message).toBe('');
  });
});

describe('sessionDescription', () => {
  it('prefers the fresh summary', () => {
    expect(sessionDescription({ summary: 'Готово.', lastSummary: 'Чинил тесты' })).toBe('Готово.');
  });

  it('falls back to the last one while the session works', () => {
    // Именно этот случай и был виден на плате: у работающей сессии сводки нет,
    // и строка оставалась пустой, хотя сказать ей было что.
    expect(sessionDescription({ summary: '', lastSummary: 'Готовлю бриф' })).toBe('Готовлю бриф');
    expect(sessionDescription({ summary: '   ', lastSummary: 'Готовлю бриф' })).toBe('Готовлю бриф');
  });

  it('returns an empty string when there is nothing to say', () => {
    expect(sessionDescription({ summary: '', lastSummary: '' })).toBe('');
    expect(sessionDescription(null)).toBe('');
    expect(sessionDescription({ summary: 42, lastSummary: 7 })).toBe('');
  });
});

describe('lastActivityAt', () => {
  it('prefers the hook over the slot even when the slot is newer', () => {
    // lastSeen тикает каждую секунду, пока окно на экране — это не действие
    // агента. Без этого предпочтения у всех живых сессий справа всегда «now».
    expect(lastActivityAt({ lastSeen: 300 }, { updated: 200 })).toBe(200);
    expect(lastActivityAt({ lastSeen: 100 }, { updated: 200 })).toBe(200);
  });

  it('falls back to the slot when there is no hook data', () => {
    expect(lastActivityAt({ lastSeen: 100 }, null)).toBe(100);
  });

  it('falls back to the hook when the slot has no timestamp', () => {
    expect(lastActivityAt({}, { updated: 100 })).toBe(100);
    expect(lastActivityAt(null, { updated: 100 })).toBe(100);
  });

  it('returns null when nothing is known, so the picker draws no age', () => {
    expect(lastActivityAt({}, null)).toBeNull();
    expect(lastActivityAt({ lastSeen: 0 }, { updated: 0 })).toBeNull();
  });
});

describe('seenSinceUpdate', () => {
  it('counts a focus that came after the agent wrote its state', () => {
    expect(seenSinceUpdate({ focusedAt: 200 }, { updated: 100 })).toBe(true);
  });

  it('counts a focus in the very same second as seen', () => {
    // Both marks are in whole seconds, so an equal pair is a focus that
    // landed after the write, not before it.
    expect(seenSinceUpdate({ focusedAt: 100 }, { updated: 100 })).toBe(true);
  });

  it('does not count a focus from before the state was written', () => {
    // Looked at the window, then the agent finished: that state is unseen.
    expect(seenSinceUpdate({ focusedAt: 100 }, { updated: 200 })).toBe(false);
  });

  it('treats a window that was never focused as unseen', () => {
    expect(seenSinceUpdate({ focusedAt: 0 }, { updated: 100 })).toBe(false);
    expect(seenSinceUpdate({}, { updated: 100 })).toBe(false);
    expect(seenSinceUpdate(null, { updated: 100 })).toBe(false);
  });

  it('returns false when the agent said nothing, because there was nothing to see', () => {
    expect(seenSinceUpdate({ focusedAt: 500 }, null)).toBe(false);
    expect(seenSinceUpdate({ focusedAt: 500 }, { updated: 0 })).toBe(false);
  });
});

describe('normalizeProgress with a PR', () => {
  it('keeps a github pull request url and the branch', () => {
    const out = normalizeProgress({
      state: 'idle', updated: 5,
      branch: 'feat/x', pr_url: 'https://github.com/popstas/ccfzf/pull/3',
    });
    expect(out.branch).toBe('feat/x');
    expect(out.pr_url).toBe('https://github.com/popstas/ccfzf/pull/3');
  });

  it('drops anything that is not a github pull request url', () => {
    // Строку пишет чужой процесс на другой машине, а уходит она в аргумент
    // `start`. Ворота одни — здесь.
    for (const bad of [
      'http://github.com/a/b/pull/1',
      'https://github.com.evil.tld/a/b/pull/1',
      'https://github.com/a/b/issues/1',
      'https://github.com/a/b/pull/1 && calc.exe',
      42,
    ]) {
      expect(normalizeProgress({ state: 'idle', updated: 5, pr_url: bad }).pr_url).toBe('');
    }
  });

  it('defaults both fields to empty strings', () => {
    const out = normalizeProgress({ state: 'idle', updated: 5 });
    expect(out.branch).toBe('');
    expect(out.pr_url).toBe('');
  });
});
