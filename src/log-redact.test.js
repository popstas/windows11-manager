import { describe, it, expect } from 'vitest';
import { redactBody, redactPayload } from './log-redact.js';

const LONG = `секрет ${'ж'.repeat(4000)}`;

describe('redactBody', () => {
  it('промпт в журнал — длиной и началом, а не целиком', () => {
    const out = redactBody({ action: 'terminal-prompt', cwd: '/p/site', prompt: LONG });
    expect(out.action).toBe('terminal-prompt');
    expect(out.cwd).toBe('/p/site');
    expect(out.prompt).toContain(`${Buffer.byteLength(LONG)} bytes`);
    expect(out.prompt).toContain('секрет');
    expect(out.prompt.length).toBeLessThan(120);
    expect(out.prompt.endsWith('…>')).toBe(true);
  });

  it('короткий промпт — целиком, без многоточия', () => {
    expect(redactBody({ prompt: 'hi' }).prompt).toBe('<prompt 2 bytes: hi>');
  });

  it('тело без промпта не трогается', () => {
    const body = { action: 'terminal-new', cwd: '/p/site' };
    expect(redactBody(body)).toBe(body);
    expect(redactBody(null)).toBe(null);
  });
});

describe('redactPayload', () => {
  it('JSON с промптом укорачивается и по MQTT', () => {
    const out = redactPayload(Buffer.from(JSON.stringify({ action: 'terminal-prompt', prompt: LONG })));
    expect(out).not.toContain('ж'.repeat(200));
    expect(JSON.parse(out).action).toBe('terminal-prompt');
  });

  it('прочее — как пришло, включая не-JSON', () => {
    expect(redactPayload('abc')).toBe('abc');
    expect(redactPayload('{"id":"x"}')).toBe('{"id":"x"}');
    expect(redactPayload('{"prompt": broken')).toBe('{"prompt": broken');
  });
});
