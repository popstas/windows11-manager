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

  it('чужой путь — null', () => {
    expect(routeToCommand('/nope')).toBe(null);
    expect(routeToCommand('/')).toBe(null);
  });
});
