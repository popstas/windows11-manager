import { describe, it, expect } from 'vitest';
import { stripTitleDecoration } from './title-helpers.js';

describe('stripTitleDecoration', () => {
  it('strips the Claude Code status glyph', () => {
    // Реальный заголовок окна: "✳ Check branch commit count" (U+2733),
    // в дампе ccfzf та же сессия лежит как "Check branch commit count".
    expect(stripTitleDecoration('✳ Check branch commit count')).toBe('Check branch commit count');
  });

  it('makes the decorated and the bare title compare equal', () => {
    // Ровно то, ради чего функция существует: глиф то появляется, то исчезает,
    // и без нормализации заголовок считался бы новым при каждом мигании.
    expect(stripTitleDecoration('✳ ccfzf')).toBe(stripTitleDecoration('ccfzf'));
  });

  it('leaves an undecorated title alone', () => {
    expect(stripTitleDecoration('popstas@pc-virt: ~/projects')).toBe('popstas@pc-virt: ~/projects');
  });

  it('keeps punctuation that opens a title', () => {
    // Кавычка — не украшение, а часть заголовка: снять её с одной стороны
    // сравнения значило бы сломать сопоставление вместо того, чтобы починить.
    expect(stripTitleDecoration('"Fix the parser" task')).toBe('"Fix the parser" task');
    expect(stripTitleDecoration('-- draft --')).toBe('-- draft --');
  });

  it('does not eat a symbol that is part of the text', () => {
    expect(stripTitleDecoration('C++ build fails')).toBe('C++ build fails');
    expect(stripTitleDecoration('$PATH is empty')).toBe('$PATH is empty');
  });

  it('trims surrounding whitespace on both sides of the comparison', () => {
    expect(stripTitleDecoration('  ccfzf  ')).toBe('ccfzf');
  });

  it('strips the zellij session prefix before the status glyph', () => {
    // Реальный заголовок окна на ноутбуке 2026-10-23: zellij ставит терминалу
    // заголовок «<сессия zellij> | <заголовок панели>», и глиф статуса Claude
    // оказывается уже после приставки. В дампе ccfzf сессия — «budva-day-5».
    expect(stripTitleDecoration('popstas | ✳ budva-day-5')).toBe('budva-day-5');
    expect(stripTitleDecoration('popstas | budva-day-5')).toBe('budva-day-5');
  });

  it('keeps a title whose prefix before " | " is several words', () => {
    // Имя сессии zellij — одно слово без пробелов; приставка из нескольких
    // слов — уже часть чужого заголовка, и срезать её нельзя.
    expect(stripTitleDecoration('Some App | thing')).toBe('Some App | thing');
  });

  it('returns an empty string for anything that is not a string', () => {
    expect(stripTitleDecoration(undefined)).toBe('');
    expect(stripTitleDecoration(null)).toBe('');
    expect(stripTitleDecoration(42)).toBe('');
  });
});
