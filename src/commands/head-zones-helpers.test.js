import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { formatHeadZonesText, parseHeadZonesText, renderHeadZonesFlow } from './head-zones-helpers.js';
import { patchConfigScalar } from './config-scalar-patch.js';

const patch = (raw, zones) =>
  patchConfigScalar(raw, 'claudeWt', 'headZones', zones, { render: renderHeadZonesFlow });

describe('formatHeadZonesText / parseHeadZonesText', () => {
  it('туда и обратно, мониторы по возрастанию', () => {
    const text = formatHeadZonesText({ 2: [5, 6], 1: [3, 4] });
    expect(text).toBe('1: 3,4\n2: 5,6');
    expect(parseHeadZonesText(text)).toEqual({ zones: { 1: [3, 4], 2: [5, 6] }, error: null });
  });

  it('принимает запятую вместо двоеточия и пробелы, пропускает пустые строки', () => {
    expect(parseHeadZonesText(' 2,5, 6 \n\n1 : 3 ,4\n').zones).toEqual({ 1: [3, 4], 2: [5, 6] });
  });

  it('пустой текст — пустая карта', () => {
    expect(parseHeadZonesText('  \n')).toEqual({ zones: {}, error: null });
  });

  it('неразборчивая строка — ошибка с номером', () => {
    expect(parseHeadZonesText('1: 3,4\n2: 5').error).toMatch(/строка 2/);
  });

  it('повтор монитора — ошибка, а не тихая перезапись', () => {
    expect(parseHeadZonesText('2: 1,2\n2: 5,6').error).toMatch(/монитор 2 уже задан в строке 1/);
  });

  it('совпавшие зоны и нулевой номер отвергает тот же разбор, что у демона', () => {
    expect(parseHeadZonesText('2: 5,5').error).toMatch(/claudeWt\.headZones\.2: зоны пары совпадают/);
    expect(parseHeadZonesText('0: 1,2').error).toMatch(/claudeWt\.headZones\.0/);
  });

  it('рендер — однострочная flow-карта', () => {
    expect(renderHeadZonesFlow({ 2: [5, 6], 1: [3, 4] })).toBe('{ 1: [3, 4], 2: [5, 6] }');
  });
});

describe('patchConfigScalar с headZones', () => {
  const zones = { 1: [3, 4], 2: [5, 6] };

  it('ключа нет — дописывается в конец claudeWt', () => {
    const raw = 'claudeWt:\n  enabled: true\n# tail\nother: 1\n';
    const out = patch(raw, zones);
    expect(out).toBe('claudeWt:\n  enabled: true\n  headZones: { 1: [3, 4], 2: [5, 6] }\n# tail\nother: 1\n');
  });

  it('однострочная flow-карта — меняется только значение, комментарий остаётся', () => {
    const raw = 'claudeWt:\n  headZones: { 1: [3, 4], 2: [1, 2] }  # зоны\n  childPlacement: deck\n';
    expect(patch(raw, zones)).toBe(raw.replace('2: [1, 2]', '2: [5, 6]'));
  });

  it('блочная карта, за ней другой ключ — ключ не склеивается и не теряется', () => {
    const raw = 'claudeWt:\n  headZones: # руками\n    1: [3, 4]\n    # второй\n    2: [1, 2]\n  childPlacement: deck\n';
    const out = patch(raw, zones);
    expect(out).toBe('claudeWt:\n  headZones: { 1: [3, 4], 2: [5, 6] } # руками\n  childPlacement: deck\n');
    expect(parse(out).claudeWt.childPlacement).toBe('deck');
  });

  it('блочная карта последним ключом файла', () => {
    const raw = 'claudeWt:\n  enabled: true\n  headZones:\n    2: [1, 2]\n';
    expect(patch(raw, { 2: [5, 6] })).toBe('claudeWt:\n  enabled: true\n  headZones: { 2: [5, 6] }\n');
  });

  it('CRLF сохраняется', () => {
    const raw = 'claudeWt:\r\n  headZones:\r\n    2: [1, 2]\r\n  childPlacement: deck\r\n';
    expect(patch(raw, { 2: [5, 6] })).toBe('claudeWt:\r\n  headZones: { 2: [5, 6] }\r\n  childPlacement: deck\r\n');
  });

  it('пустое поле убирает блочный ключ, не задевая следующий', () => {
    const raw = 'claudeWt:\n  headZones:\n    2: [1, 2]\n  childPlacement: deck\n';
    expect(patch(raw, undefined)).toBe('claudeWt:\n  childPlacement: deck\n');
  });

  it('пустое поле убирает однострочный ключ', () => {
    const raw = 'claudeWt:\n  headZones: { 2: [1, 2] }\n  childPlacement: deck\n';
    expect(patch(raw, undefined)).toBe('claudeWt:\n  childPlacement: deck\n');
  });
});
