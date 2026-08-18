import { describe, it, expect } from 'vitest';
import { formatTileZonesText, parseTileZonesText } from './tile-zones-helpers.js';

describe('formatTileZonesText', () => {
  it('по паре на строку, monitor,position', () => {
    expect(formatTileZonesText([
      { monitor: 1, position: 6 },
      { monitor: 1, position: 7 },
    ])).toBe('1,6\n1,7');
  });

  it('пустой список -> пустая строка', () => {
    expect(formatTileZonesText([])).toBe('');
    expect(formatTileZonesText()).toBe('');
  });
});

describe('parseTileZonesText', () => {
  it('разбирает пары построчно', () => {
    expect(parseTileZonesText('1,6\n1,7\n2,1')).toEqual({
      zones: [
        { monitor: 1, position: 6 },
        { monitor: 1, position: 7 },
        { monitor: 2, position: 1 },
      ],
      error: null,
    });
  });

  it('пропускает пустые строки и обрезает пробелы вокруг запятой', () => {
    expect(parseTileZonesText('\n 1 , 6 \n\n  \n2,1\n')).toEqual({
      zones: [
        { monitor: 1, position: 6 },
        { monitor: 2, position: 1 },
      ],
      error: null,
    });
  });

  it('пустой текст -> пустой список без ошибки', () => {
    expect(parseTileZonesText('')).toEqual({ zones: [], error: null });
  });

  it('неразборчивая строка возвращается как ошибка с номером и содержимым', () => {
    const res = parseTileZonesText('1,6\nnot a zone\n2,1');
    expect(res.zones).toBeNull();
    expect(res.error).toContain('строка 2');
    expect(res.error).toContain('not a zone');
  });

  it('формат { monitor } без position — тоже ошибка, а не тихое отбрасывание', () => {
    const res = parseTileZonesText('1');
    expect(res.zones).toBeNull();
    expect(res.error).toContain('строка 1');
  });
});
