import { describe, it, expect } from 'vitest';
import { CLAUDE_CONFIG_FIELDS, SESSIONS_SORT_MODES, coerceFieldValue } from './claude-config-fields.js';
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

  it('отвергает неизвестное поле по имени', () => {
    expect(() => coerceFieldValue('claudeWt.чужое', 1)).toThrow(/неизвестное поле/);
  });
});
