/**
 * Тело просьбы для журнала — без промпта целиком.
 *
 * `terminal-prompt` везёт первый промпт новой сессии (до 8 КБ), а журнал
 * службы пишет входящее целиком — и по http, и по MQTT. Промпт — приватный
 * текст человека, и 8 КБ на каждую просьбу в файле журнала ни к чему
 * (решение head 2026-11-21). Вместо него — длина и начало: этого хватает,
 * чтобы узнать просьбу при разборе, и не хватает, чтобы журнал стал копией
 * переписки.
 */

const HEAD = 80;

function shortPrompt(prompt) {
  const bytes = Buffer.byteLength(prompt, 'utf8');
  const head = [...prompt].slice(0, HEAD).join('');
  const cut = head.length < prompt.length ? '…' : '';
  return `<prompt ${bytes} bytes: ${head}${cut}>`;
}

/** Объект тела с укороченным `prompt`; прочее — как было. */
function redactBody(body) {
  if (!body || typeof body !== 'object' || typeof body.prompt !== 'string') return body;
  return { ...body, prompt: shortPrompt(body.prompt) };
}

/** Сырой payload MQTT строкой для журнала: JSON с `prompt` укорачивается, прочее — как пришло. */
function redactPayload(payload) {
  const raw = Buffer.isBuffer(payload) ? payload.toString() : String(payload ?? '');
  if (!raw.includes('"prompt"')) return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && typeof parsed.prompt === 'string'
      ? JSON.stringify(redactBody(parsed))
      : raw;
  } catch {
    return raw;
  }
}

export { redactBody, redactPayload };
