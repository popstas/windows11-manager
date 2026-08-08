import { describe, it, expect, vi } from 'vitest';
import { createRouter } from './router.js';

describe('createRouter', () => {
  it('разрешает известную команду в её обработчик', async () => {
    const store = vi.fn().mockResolvedValue('stored');
    const router = createRouter({ store });
    expect(await router.dispatch('store', { a: 1 })).toEqual({ ok: true, result: 'stored' });
    expect(store).toHaveBeenCalledWith({ a: 1 });
  });

  it('на неизвестной команде возвращает ошибку, а не бросает', async () => {
    const router = createRouter({ store: () => {} });
    expect(await router.dispatch('nope')).toEqual({ ok: false, error: 'unknown command: nope' });
  });

  it('ловит исключение обработчика', async () => {
    const router = createRouter({ boom: () => { throw new Error('нет окна'); } });
    expect(await router.dispatch('boom')).toEqual({ ok: false, error: 'нет окна' });
  });

  it('ловит отказ промиса обработчика', async () => {
    const router = createRouter({ boom: () => Promise.reject(new Error('таймаут')) });
    expect(await router.dispatch('boom')).toEqual({ ok: false, error: 'таймаут' });
  });

  it('has и commands рассказывают о карте', () => {
    const router = createRouter({ store: () => {}, restore: () => {} });
    expect(router.has('store')).toBe(true);
    expect(router.has('nope')).toBe(false);
    expect(router.commands().sort()).toEqual(['restore', 'store']);
  });
});
