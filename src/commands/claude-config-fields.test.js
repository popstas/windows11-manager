import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { CLAUDE_CONFIG_FIELDS, SESSIONS_SORT_MODES, coerceFieldValue } from './claude-config-fields.js';
import { CHILD_PLACEMENTS, normalizeChildPlacement } from '../claude-wt/head-zones-helpers.js';
import { CLAUDE_WT_DEFAULTS } from '../claude-wt/daemon-helpers.js';
import { normalizeSort } from '../claude-wt/ha/session-groups.js';

describe('CLAUDE_CONFIG_FIELDS', () => {
  it('несёт только скаляры — структуры формой не выражаются', () => {
    for (const field of CLAUDE_CONFIG_FIELDS) {
      expect(['boolean', 'number', 'string']).toContain(field.type);
      expect(typeof field.default).toBe(field.type);
    }
  });

  it('имена уникальны и совпадают с парой секция.ключ', () => {
    const names = CLAUDE_CONFIG_FIELDS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    for (const field of CLAUDE_CONFIG_FIELDS) {
      expect(field.name).toBe(`${field.section}.${field.key}`);
    }
  });

  // Подпись поля в форме — это `default` отсюда, а работает умолчание в
  // CLAUDE_WT_DEFAULTS. Разъедутся — форма начнёт врать плейсхолдером, и
  // заметить это глазами нельзя.
  it('умолчания claudeWt совпадают с CLAUDE_WT_DEFAULTS', () => {
    for (const field of CLAUDE_CONFIG_FIELDS.filter((f) => f.section === 'claudeWt')) {
      expect(CLAUDE_WT_DEFAULTS).toHaveProperty(field.key);
      expect(field.default).toBe(CLAUDE_WT_DEFAULTS[field.key]);
    }
  });

  // Переключатель «как ставить ребёнка head» на вкладке Claude.
  it('claudeWt.childPlacement — выбор stack | free | deck, тот же список, что знает нормализация', () => {
    const field = CLAUDE_CONFIG_FIELDS.find((f) => f.name === 'claudeWt.childPlacement');
    expect(field).toMatchObject({ type: 'string', default: 'stack', choices: CHILD_PLACEMENTS });
    expect(CHILD_PLACEMENTS).toEqual(['stack', 'free', 'deck']);
    for (const mode of CHILD_PLACEMENTS) expect(normalizeChildPlacement(mode)).toBe(mode);
  });

  it('список сортировок слотов — тот же, что знает normalizeSort', () => {
    for (const mode of SESSIONS_SORT_MODES) expect(normalizeSort(mode)).toBe(mode);
    expect(normalizeSort('не-режим')).toBe('recent');
  });
});

describe('coerceFieldValue', () => {
  it('пропускает булево как есть', () => {
    expect(coerceFieldValue('claudeWt.debug', true)).toBe(true);
    expect(coerceFieldValue('claudeWt.debug', false)).toBe(false);
  });

  it('отвергает не-булево в булевом поле', () => {
    expect(() => coerceFieldValue('claudeWt.debug', 'true')).toThrow(/true или false/);
  });

  it('приводит число из строки формы', () => {
    expect(coerceFieldValue('claudeWt.interval', '2000')).toBe(2000);
    expect(coerceFieldValue('claudeWt.interval', 2000)).toBe(2000);
  });

  it('отвергает мусор вместо числа', () => {
    expect(() => coerceFieldValue('claudeWt.interval', '12abc')).toThrow(/целое число/);
    expect(() => coerceFieldValue('claudeWt.stableTicks', '2.5')).toThrow(/целое число/);
  });

  it('ноль — законное значение, а не пустота', () => {
    expect(coerceFieldValue('claudeWt.focusSettleMs', '0')).toBe(0);
  });

  // Пустое поле — просьба вернуть умолчание: undefined означает для патчера
  // «убрать ключ». Записанный вместо этого `terminal: ''` затёр бы `wt`.
  it('пустое поле означает удаление ключа', () => {
    expect(coerceFieldValue('claudeWt.terminal', '')).toBeUndefined();
    expect(coerceFieldValue('claudeWt.interval', '')).toBeUndefined();
    expect(coerceFieldValue('claudeWt.profile', '   ')).toBeUndefined();
    expect(coerceFieldValue('claudeWt.profile', null)).toBeUndefined();
  });

  it('обрезает пробелы по краям строки', () => {
    expect(coerceFieldValue('claudeWt.terminal', ' wezterm ')).toBe('wezterm');
  });

  it('отвергает перевод строки в однострочном поле', () => {
    expect(() => coerceFieldValue('claudeWt.statePath', 'a\nb')).toThrow(/перевод строки/);
  });

  it('проверяет список допустимых значений', () => {
    expect(coerceFieldValue('homeassistant.sessionsSort', 'cost')).toBe('cost');
    expect(() => coerceFieldValue('homeassistant.sessionsSort', 'дороже')).toThrow(/ожидается одно из/);
  });

  it('childPlacement: stack и free проходят, прочее — отказ с именем поля', () => {
    expect(coerceFieldValue('claudeWt.childPlacement', 'free')).toBe('free');
    expect(coerceFieldValue('claudeWt.childPlacement', ' stack ')).toBe('stack');
    expect(coerceFieldValue('claudeWt.childPlacement', '')).toBeUndefined();
    for (const bad of ['FREE', 'yolo', 'стопка']) {
      expect(() => coerceFieldValue('claudeWt.childPlacement', bad)).toThrow(/claudeWt\.childPlacement: ожидается одно из stack \| free \| deck/);
    }
  });

  it('отвергает неизвестное поле по имени', () => {
    expect(() => coerceFieldValue('claudeWt.чужое', 1)).toThrow(/неизвестное поле/);
  });
});

// Форма знает поля тем же списком, повторённым разметкой (data-cfg*). Список
// и разметка сверяются здесь: поле, которое есть только с одной стороны,
// либо не показывается, либо отвергается на записи как неизвестное.
describe('разметка вкладки Claude', () => {
  const html = fs.readFileSync(new URL('../../tauri-app/src/index.html', import.meta.url), 'utf8');
  const nodes = [...html.matchAll(/<(input|select)\b([^>]*\bdata-cfg="[^"]+"[^>]*)>/g)].map(([, tag, attrs]) => {
    const attr = (n) => attrs.match(new RegExp(`\\b${n}="([^"]*)"`))?.[1];
    return { tag, name: attr('data-cfg'), type: attr('data-cfg-type'), def: attr('data-cfg-default'), id: attr('id') };
  });

  it('те же поля, что в CLAUDE_CONFIG_FIELDS, с теми же типами и умолчаниями', () => {
    expect(nodes.map((n) => n.name).sort()).toEqual(CLAUDE_CONFIG_FIELDS.map((f) => f.name).sort());
    for (const field of CLAUDE_CONFIG_FIELDS) {
      const node = nodes.find((n) => n.name === field.name);
      expect(node.type).toBe(field.type);
      expect(node.def).toBe(String(field.default));
    }
  });

  it('у поля с выбором — select ровно с этими значениями и пустым «по умолчанию»', () => {
    for (const field of CLAUDE_CONFIG_FIELDS.filter((f) => f.choices)) {
      const node = nodes.find((n) => n.name === field.name);
      expect(node.tag).toBe('select');
      const body = html.slice(html.indexOf(`id="${node.id}"`), html.indexOf('</select>', html.indexOf(`id="${node.id}"`)));
      const values = [...body.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
      expect(values).toEqual(['', ...field.choices]);
    }
  });
});
