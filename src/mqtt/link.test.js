import { describe, it, expect } from 'vitest';
import { linkLine, shortReason, createLinkReporter } from './link.js';

function reporter() {
  const lines = [];
  return { lines, link: createLinkReporter((line) => lines.push(line)) };
}

describe('linkLine', () => {
  it('пишет состояние строкой с маркером', () => {
    expect(linkLine('connected')).toBe('@@w11m-link {"state":"connected"}');
    expect(linkLine('disconnected', 'timeout'))
      .toBe('@@w11m-link {"state":"disconnected","reason":"timeout"}');
  });
});

describe('shortReason', () => {
  it('отказ брокера — коротким словом', () => {
    expect(shortReason(Object.assign(new Error('Connection refused: Not authorized'), { code: 5 })))
      .toBe('not authorized');
    expect(shortReason(Object.assign(new Error('Connection refused: Bad username or password'), { code: 4 })))
      .toBe('bad user name or password');
  });

  it('сетевые ошибки — по коду сокета', () => {
    expect(shortReason(Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:1883'), { code: 'ECONNREFUSED' })))
      .toBe('connection refused');
    expect(shortReason(Object.assign(new Error('getaddrinfo ENOTFOUND broker.example'), { code: 'ENOTFOUND' })))
      .toBe('host not found');
  });

  it('длинную причину режет для меню', () => {
    const text = shortReason(new Error('x'.repeat(200)));
    expect(text).toHaveLength(60);
    expect(text.endsWith('…')).toBe(true);
  });
});

describe('createLinkReporter', () => {
  it('пишет только смену состояния', () => {
    const { lines, link } = reporter();
    link.connecting();
    link.connected();
    link.connected();
    expect(lines).toEqual([
      '@@w11m-link {"state":"connecting"}',
      '@@w11m-link {"state":"connected"}',
    ]);
  });

  it('close после отказа несёт причину отказа, а не «connection lost»', () => {
    const { lines, link } = reporter();
    link.error(Object.assign(new Error('Connection refused: Not authorized'), { code: 5 }));
    link.closed();
    // Повтор той же пары через пять секунд — тишина: значок не мигает.
    link.error(Object.assign(new Error('Connection refused: Not authorized'), { code: 5 }));
    link.closed();
    expect(lines).toEqual(['@@w11m-link {"state":"disconnected","reason":"not authorized"}']);
  });

  it('обрыв живого соединения — «connection lost»', () => {
    const { lines, link } = reporter();
    link.connected();
    link.closed();
    expect(lines.at(-1)).toBe('@@w11m-link {"state":"disconnected","reason":"connection lost"}');
  });

  it('подключение стирает прежнюю причину', () => {
    const { lines, link } = reporter();
    link.error(new Error('timeout'));
    link.connected();
    link.closed();
    expect(lines.at(-1)).toBe('@@w11m-link {"state":"disconnected","reason":"connection lost"}');
  });
});
