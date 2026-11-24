import { describe, it, expect, vi, beforeEach } from 'vitest';

// Аддон подменён объектом: настоящий собирается только на Windows.
const fakeAddon = vi.hoisted(() => ({ current: undefined }));
vi.mock('node-window-manager', () => ({
  windowManager: {},
  Window: class {},
  get addon() { return fakeAddon.current; },
}));

const load = () => import('./windows.js');

describe('deleteTab / addTab', () => {
  beforeEach(() => {
    fakeAddon.current = undefined;
  });

  it('без аддона deleteTab/addTab отвечают false и не бросают', async () => {
    const w = await load();
    expect(w.hasTabControl(), 'без аддона управления нет').toBe(false);
    expect(w.deleteTab(1234)).toBe(false);
    expect(w.addTab(1234)).toBe(false);
  });

  it('аддон, собранный до этих функций, тоже даёт false', async () => {
    fakeAddon.current = { setTaskbarProgress() {}, flashWindow() {} };
    const w = await load();
    expect(w.hasTabControl()).toBe(false);
    expect(w.deleteTab(1234)).toBe(false);
  });

  it('с аддоном передают hwnd как есть и возвращают ответ аддона', async () => {
    const deleteTab = vi.fn(() => true);
    const addTab = vi.fn(() => false);
    fakeAddon.current = { deleteTab, addTab };
    const w = await load();
    expect(w.hasTabControl()).toBe(true);
    expect(w.deleteTab(0x1a2b)).toBe(true);
    expect(deleteTab, 'hwnd без преобразований').toHaveBeenCalledWith(0x1a2b);
    expect(w.addTab(0x1a2b)).toBe(false);
    expect(addTab).toHaveBeenCalledWith(0x1a2b);
  });

  it('видны через src/lib/index.js', async () => {
    const lib = await import('./lib/index.js');
    expect(typeof lib.deleteTab).toBe('function');
    expect(typeof lib.addTab).toBe('function');
    expect(typeof lib.hasTabControl).toBe('function');
  });
});
