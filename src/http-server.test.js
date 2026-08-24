import { describe, it, expect } from 'vitest';
import { routeToCommand } from './http-server.js';

describe('routeToCommand', () => {
  it('переводит путь в команду', () => {
    expect(routeToCommand('/place')).toBe('place');
    expect(routeToCommand('/placeAll')).toBe('placeAll');
    expect(routeToCommand('/store')).toBe('store');
    expect(routeToCommand('/desktop')).toBe('desktop');
  });

  it('терпит хвостовую косую черту', () => {
    expect(routeToCommand('/store/')).toBe('store');
  });

  it('знает вложенный путь claude-wt', () => {
    expect(routeToCommand('/claude-wt/restore')).toBe('claude-wt-restore');
    expect(routeToCommand('/claude-wt/session-open')).toBe('claude-session-open');
  });

  // Без этого маршрута пятая просьба пикера (раскладка) получала бы 404, и
  // человек видел бы «менеджер не отвечает» — неотличимо от лежащей службы.
  it('раскладка claude-wt ведёт в claude-place, а не в place окон', () => {
    expect(routeToCommand('/claude-wt/place')).toBe('claude-place');
  });

  it('чужой путь — null', () => {
    expect(routeToCommand('/nope')).toBe(null);
    expect(routeToCommand('/')).toBe(null);
  });
});
