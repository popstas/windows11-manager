import { describe, it, expect } from 'vitest';

import {parseRestorePayload} from './restore-payload.js';

describe('restore-payload', () => {
  it('пустое сообщение значит самый свежий снимок', () => {
    // Кнопка Restore last на панели шлёт пустоту. Снимок, а не lastLayout:
    // последний обнуляется через секунду после закрытия окон.
    expect(parseRestorePayload('')).toEqual({id: 'last', sessionIds: []});
    expect(parseRestorePayload(null)).toEqual({id: 'last', sessionIds: []});
  });

  it('сырая строка — это id снимка', () => {
    // С панели прилетает так же, как и прежде: ветка не меняется.
    expect(parseRestorePayload('snap-1')).toEqual({id: 'snap-1', sessionIds: []});
  });

  it('объект от пикера разбирается, а не уезжает литералом', () => {
    // Без этой ветки id снимка стал бы строкой `{"id":"snap-1"}`, и
    // восстановление молча не находило бы ничего: ошибки на такой вход нет,
    // есть пустой результат.
    expect(parseRestorePayload('{"id":"snap-1"}')).toEqual({id: 'snap-1', sessionIds: []});
  });

  it('sessionIds доезжает до restoreSnapshot', () => {
    expect(parseRestorePayload('{"id":"snap-1","sessionIds":["aaa"]}')).toEqual(
      {id: 'snap-1', sessionIds: ['aaa']});
  });

  it('объект без id — тоже самый свежий снимок', () => {
    expect(parseRestorePayload('{"sessionIds":["aaa"]}')).toEqual(
      {id: 'last', sessionIds: ['aaa']});
  });

  it('мусор в sessionIds отбрасывается, а снимок поднимается целиком', () => {
    // Полбеды лучше беды: раскладка поднимется вся, а не ни одна.
    expect(parseRestorePayload('{"id":"snap-1","sessionIds":"aaa"}')).toEqual(
      {id: 'snap-1', sessionIds: []});
  });
});
