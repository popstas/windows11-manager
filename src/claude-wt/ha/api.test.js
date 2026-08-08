import { describe, it, expect, vi, afterEach } from 'vitest';
import { HomeAssistantApi, mergeHaConfig } from './api.js';
import {
  slotText, slotUsage, slotTime, slotDescription, sessionEntity, buildSessionEntities, buildSummaryEntity,
} from './entities.js';
import { buildSlots } from './session-slots.js';
import { stateMessages } from './discovery.js';

const s = (over) => ({
  id: 'x', title: 't', cwd: '/p', bounds: { x: 0, y: 0, width: 10, height: 10 },
  desktop: 1, monitor: 1, open: true, lastActivity: 100, ...over,
});

function fakeFetch(record) {
  return async (url, options) => {
    record.push({ url, options });
    return record.response ?? { ok: true, status: 200 };
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('api', () => {
  it('mergeHaConfig fills the defaults', () => {
    expect(mergeHaConfig(undefined).enabled).toBe(false);
    expect(mergeHaConfig({ url: 'http://ha' }).timeoutMs).toBe(5000);
  });

  it('the client stays disabled until it has a url and a token', () => {
    // A half-filled config must not turn into requests to nowhere.
    expect(new HomeAssistantApi({ enabled: true }).enabled).toBe(false);
    expect(new HomeAssistantApi({ enabled: true, url: 'http://ha' }).enabled).toBe(false);
    expect(new HomeAssistantApi({ enabled: false, url: 'http://ha', token: 't' }).enabled).toBe(false);
    expect(new HomeAssistantApi({ enabled: true, url: 'http://ha', token: 't' }).enabled).toBe(true);
  });

  it('setState posts the entity to the states endpoint', async () => {
    const calls = [];
    vi.spyOn(global, 'fetch').mockImplementation(fakeFetch(calls));
    const api = new HomeAssistantApi({ enabled: true, url: 'http://ha:8123/', token: 'secret' });

    expect(await api.setState('sensor.a', 'hi', { x: 1 })).toBe(true);
    expect(calls[0].url).toBe('http://ha:8123/api/states/sensor.a');
    expect(calls[0].options.headers.Authorization).toBe('Bearer secret');
    expect(JSON.parse(calls[0].options.body)).toEqual({ state: 'hi', attributes: { x: 1 } });
  });

  it('setState truncates a state Home Assistant would reject', async () => {
    // HA caps state at 255 characters and refuses the whole request beyond that;
    // session titles do get longer than this.
    const calls = [];
    vi.spyOn(global, 'fetch').mockImplementation(fakeFetch(calls));
    const api = new HomeAssistantApi({ enabled: true, url: 'http://ha', token: 't' });

    await api.setState('sensor.a', 'x'.repeat(300));
    expect(JSON.parse(calls[0].options.body).state.length).toBe(255);
  });

  it('setState reports failure instead of throwing', async () => {
    // Exporting state is background work: an unreachable HA must not take the
    // windows module down with it.
    vi.spyOn(global, 'fetch').mockImplementation(async () => { throw new Error('ECONNREFUSED'); });
    const api = new HomeAssistantApi({ enabled: true, url: 'http://ha', token: 't' });
    expect(await api.setState('sensor.a', 'hi')).toBe(false);
  });

  it('setState treats a non-2xx answer as failure', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => ({ ok: false, status: 401 }));
    const api = new HomeAssistantApi({ enabled: true, url: 'http://ha', token: 't' });
    expect(await api.setState('sensor.a', 'hi')).toBe(false);
  });

  it('a disabled client makes no requests at all', async () => {
    const calls = [];
    vi.spyOn(global, 'fetch').mockImplementation(fakeFetch(calls));
    const api = new HomeAssistantApi({ enabled: false, url: 'http://ha', token: 't' });
    expect(await api.setState('sensor.a', 'hi')).toBe(false);
    expect(calls.length).toBe(0);
  });

  it('the same error is logged once, not on every tick', async () => {
    // HA restarts and the export keeps running; repeating the same line every
    // interval would bury the log.
    const lines = [];
    vi.spyOn(global, 'fetch').mockImplementation(async () => { throw new Error('ECONNREFUSED'); });
    const api = new HomeAssistantApi({ enabled: true, url: 'http://ha', token: 't' }, m => lines.push(m));
    await api.setState('sensor.a', '1');
    await api.setState('sensor.a', '1');
    expect(lines.length).toBe(1);
  });

  it('setStates counts the entities that made it', async () => {
    let n = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async () => ({ ok: n++ === 0, status: 500 }));
    const api = new HomeAssistantApi({ enabled: true, url: 'http://ha', token: 't' });
    const ok = await api.setStates([
      { entityId: 'sensor.a', state: '1' },
      { entityId: 'sensor.b', state: '2' },
    ]);
    expect(ok).toBe(1);
  });

  it('slotText marks a working session too', () => {
    // Every occupied slot gets a glyph, so the titles line up down the column.
    // The tile still does not light up for it: a running agent needs nothing.
    expect(slotText({ status: 'active', title: 'agent' })).toBe('> agent');
  });

  it('slotText prefixes the title with an ASCII status glyph', () => {
    // openHASP's built-in font has no ▶/·/×: the panel draws empty squares for
    // them. Icons there are MDI codepoints, not unicode symbols.
    expect(slotText({ status: 'question', title: 'agent' })).toBe('? agent');
    expect(slotText({ status: 'review', title: 'agent' })).toBe('! agent');
  });

  it('slotText clears an empty slot with a dash', () => {
    // Пустой payload / пробел openHASP не стирает — карточка залипала бы.
    expect(slotText({ status: 'empty', title: '' })).toBe('-');
    expect(slotText(undefined)).toBe('-');
    expect(slotText({ status: 'idle', title: '' })).toBe('-');
  });

  it('slotDescription clears empty and blank descriptions with a dash', () => {
    expect(slotDescription({ status: 'empty', description: '' })).toBe('-');
    expect(slotDescription({ status: 'idle', description: '' })).toBe('-');
    expect(slotDescription({ status: 'idle', description: '  ' })).toBe('-');
    expect(slotDescription({ status: 'idle', description: 'Готово' })).toBe('Готово');
    expect(slotDescription(undefined)).toBe('-');
  });

  it('a working session shows what it stopped on last time', () => {
    // Свежей сводки у неё нет, и панель показывала `-`, хотя сказать ей было что.
    const [slot] = buildSessionEntities([s({
      agentState: 'active', agentSummary: '', agentLastSummary: 'Готовлю бриф',
      agentDescription: 'Готовлю бриф',
    })], 1);
    expect(slot.attributes.summary).toBe('Готовлю бриф');
    expect(slot.attributes.last_summary).toBe('Готовлю бриф');
  });

  it('slotUsage keeps only the context in the corner of the row', () => {
    // Стоимость из угла убрана: в 75 px «$12 47%» читалось кашей, а решение по
    // строке принимается по одному проценту. Деньги остались в атрибуте cost_usd.
    expect(slotUsage({ status: 'idle', costUsd: 12, contextPct: 47 })).toBe('47%');
  });

  it('slotUsage says nothing but a dash when the context was never measured', () => {
    // Возраст отсюда уехал в свой блок ниже. Пустую строку сюда класть всё так же
    // нельзя: openHASP не стирает текст пустым payload, HA обрезает пробел из
    // шаблона — угол залипал бы прежней сессией. Прочерк непустой.
    const NOW = 1_000_000;
    expect(
      slotUsage({ status: 'idle', costUsd: 0, contextPct: 0, lastActivity: NOW - 300 }, NOW),
    ).toBe('-');
    expect(
      slotUsage({ status: 'idle', costUsd: 0, contextPct: 47, lastActivity: NOW - 300 }, NOW),
    ).toBe('47%');
    expect(
      slotUsage({ status: 'empty', costUsd: 12, contextPct: 47, lastActivity: NOW }, NOW),
    ).toBe('-');
    expect(slotUsage(undefined, NOW)).toBe('-');
  });

  it('slotTime shows the running turn, and the last activity for everyone else', () => {
    const NOW = 1_000_000;
    // Работающая сессия: сколько идёт ход. lastActivity у неё бесполезен — хук
    // дёргается на каждый вызов инструмента.
    expect(
      slotTime({ status: 'active', turnAt: NOW - 570, lastActivity: NOW - 4 }, NOW),
    ).toBe('9m');
    // Ход кончился: отметка осталась стоять на прошлом промпте, показывать её
    // значило бы врать — блок снова про активность.
    expect(
      slotTime({ status: 'review', turnAt: NOW - 570, lastActivity: NOW - 7200 }, NOW),
    ).toBe('2h');
    // Сессия старше правки в хуке: отметки нет, остаётся активность.
    expect(slotTime({ status: 'active', turnAt: 0, lastActivity: NOW - 31 }, NOW)).toBe('31s');
    // Прочерк вместо пустоты — по тому же правилу, что у slotUsage.
    expect(slotTime({ status: 'empty', turnAt: NOW, lastActivity: NOW }, NOW)).toBe('-');
    expect(slotTime({ status: 'idle', lastActivity: null }, NOW)).toBe('-');
    expect(slotTime(undefined, NOW)).toBe('-');
  });

  it('one slot on its own is the same entity as in the bulk export', () => {
    // Нажатие на переключатель публикует слот поодиночке; разойдись эти два пути,
    // погашенная строка приехала бы в другой форме, чем следующий экспорт.
    const sessions = [s({ id: 'a', title: 'home', agentState: 'review', agentEvent: 'stop' })];
    const [bulk] = buildSessionEntities(sessions, 2);
    expect(sessionEntity(buildSlots(sessions, 2)[0])).toEqual(bulk);
  });

  it('switching a slot off keeps everything the panel reads from it', () => {
    // Состояние и атрибуты приходят из одного топика: нагрузка из одного `state`
    // стёрла бы текст и сводку, и строка на панели опустела бы до следующего тика.
    const sessions = [s({
      id: 'a', title: 'home', agentState: 'review', agentEvent: 'stop',
      agentDescription: 'Готово', agentCostUsd: 12, agentContextPct: 47,
    })];
    const [lit] = buildSessionEntities(sessions, 1);
    expect(lit.state).toBe('on');
    const [message] = stateMessages('base', [{ ...sessionEntity(buildSlots(sessions, 1)[0]), state: 'off' }]);
    const payload = JSON.parse(message.payload);
    expect(message.topic).toBe('base/claude/slot/1');
    expect(payload.state).toBe('off');
    expect(payload.text).toBe('! home');
    expect(payload.summary).toBe('Готово');
    // Только контекст: стоимость в 75 px панели не помещалась и уехала в атрибут.
    expect(payload.usage).toBe('47%');
    expect(payload.cost_usd).toBe(12);
  });

  it('buildSessionEntities pins each entity to a row, not to a session', () => {
    // The panel button is wired to a row; if the entity followed the session,
    // every change of composition would mean rewriting the panel config.
    const entities = buildSessionEntities([s({ id: 'a', title: 'one' })], 3);
    expect(entities.map(e => e.entityId)).toEqual([
      'switch.claude_session_1',
      'switch.claude_session_2',
      'switch.claude_session_3',
    ]);
    expect(entities[0].attributes.session_id).toBe('a');
    expect(entities[2].attributes.session_id).toBe('');
  });

  it('buildSessionEntities carries the details the panel may want', () => {
    const [entity] = buildSessionEntities([s({ id: 'a', title: 'one', desktop: 2, monitor: 5 })], 1);
    expect(entity.attributes.desktop).toBe(2);
    expect(entity.attributes.monitor).toBe(5);
    expect(entity.attributes.cwd).toBe('/p');
  });

  it('buildSummaryEntity counts live sessions and the ones waiting on you', () => {
    const summary = buildSummaryEntity([
      s({ id: 'a', agentState: 'active' }),
      s({ id: 'b', agentState: 'question' }),
      s({ id: 'c', agentState: 'review', agentEvent: 'stop' }),
      s({ id: 'd', agentState: 'review', agentEvent: 'stop', agentSeen: true }),
      s({ id: 'e', open: false }),
    ]);
    expect(summary.state).toBe(4);
    expect(summary.attributes.total).toBe(5);
    expect(summary.attributes.working).toBe(1);
    // b asks a question, c stopped and was not looked at; d was looked at.
    expect(summary.attributes.waiting).toBe(2);
  });

  it('a session turns the entity on only when it wants you', () => {
    // On means "come back to me": the agent asked something, or it stopped and
    // nobody has looked. A working session is off — it needs nothing.
    const on = st => buildSessionEntities([s({ id: 'a', ...st })], 1)[0].state;
    expect(on({ agentState: 'question' })).toBe('on');
    expect(on({ agentState: 'review', agentEvent: 'stop' })).toBe('on');
    expect(on({ agentState: 'idle', agentEvent: 'attention' })).toBe('on');
    expect(on({ agentState: 'active' })).toBe('off');
    expect(on({ agentState: 'idle', agentEvent: 'tool-done' })).toBe('off');
    expect(on({ agentState: 'review', agentEvent: 'stop', agentSeen: true })).toBe('off');
    expect(on({ open: false })).toBe('off');
  });

  it('an empty slot is off and carries dash placeholders for the panel', () => {
    const [, empty] = buildSessionEntities([s({ id: 'a' })], 2);
    expect(empty.state).toBe('off');
    expect(empty.attributes.text).toBe('-');
    expect(empty.attributes.summary).toBe('-');
    expect(empty.attributes.usage).toBe('-');
  });

  it('the display text lives in an attribute, since the state holds the on/off flag', () => {
    const [entity] = buildSessionEntities([s({ id: 'a', title: 'one', agentState: 'question' })], 1);
    expect(entity.attributes.text).toBe('? one');
    expect(entity.state).toBe('on');
  });
});
