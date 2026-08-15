/**
 * Тело просьбы о восстановлении — от панели и от пикера.
 *
 * С панели прилетает сырая строка (или пустота, что значит «самый свежий»), от
 * ccfzf-picker — объект `{id, sessionIds}`. Без разбора JSON id снимка стал бы
 * литералом `{"id":"snap-1"}`, и восстановление молча не находило бы ничего:
 * ошибки у него на такой вход нет, есть пустой результат.
 *
 * Тот же приём, что у claudeFocusSlot, и по той же причине.
 */

/** Готовый объект: и от пикера по HTTP, и из разобранной строки MQTT. */
function fromObject(parsed) {
  const ids = Array.isArray(parsed?.sessionIds)
    ? parsed.sessionIds.filter(v => typeof v === 'string' && v)
    : [];
  const id = typeof parsed?.id === 'string' && parsed.id.trim() ? parsed.id.trim() : 'last';
  return { id, sessionIds: ids };
}

function parseRestorePayload(message) {
  // По HTTP тело приходит уже разобранным (readBody зовёт JSON.parse), и
  // String() превращал его в `[object Object]`: маршрут /claude-wt/snapshot-restore
  // не восстанавливал ничего и отвечал 200 ok. Соседи по файлу — asObject и
  // parseIdPayload — объект принимают, этот разбор портировали без той ветки.
  if (message && typeof message === 'object') return fromObject(message);
  const raw = String(message ?? '').trim();
  if (!raw) return { id: 'last', sessionIds: [] };
  if (raw.startsWith('{')) {
    try {
      return fromObject(JSON.parse(raw));
    } catch {
      // Не JSON, хотя начинается с фигурной скобки: снимка с таким id всё
      // равно нет, и «самый свежий» здесь честнее отказа.
      return { id: 'last', sessionIds: [] };
    }
  }
  return { id: raw, sessionIds: [] };
}

export {parseRestorePayload};
