import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { patchConfigScalar, renderScalar, verifyPatch } from './config-scalar-patch.js';

// Кусок, снятый с живого config.example.yaml: комментарии над ключами,
// хвостовой комментарий на строке, флоу-массив и фолдед-скаляр рядом. Всё это
// обязано пережить правку соседнего ключа байт в байт.
const SAMPLE = `# top comment
placeWindowOnOpen: true

homeassistant:
  slots: 9
  interval: 15
  openOnly: true

claudeWt:
  enabled: true
  interval: 1000
  # How long to wait between a new session's window showing up and focusing it.
  focusSettleMs: 0
  sessionsFile: 'V:\\.ccfzf.sessions.json'
  desktop: true  # return the window to its virtual desktop too
  terminals:
    wt: { command: wt.exe, args: ['-w', '-1'] }
  launchNew:
    args:
      - ssh
      - >-
        exec $SHELL -ic 'cd -- "$1"' claude-wt '{cwd}'
`;

describe('patchConfigScalar', () => {
  it('меняет только значение существующего ключа, остального текста не касается', () => {
    const out = patchConfigScalar(SAMPLE, 'claudeWt', 'interval', 2000);
    expect(parse(out).claudeWt.interval).toBe(2000);
    expect(out).toBe(SAMPLE.replace('interval: 1000', 'interval: 2000'));
  });

  it('сохраняет хвостовой комментарий на строке ключа', () => {
    const out = patchConfigScalar(SAMPLE, 'claudeWt', 'desktop', false);
    expect(out).toContain('desktop: false  # return the window to its virtual desktop too');
    expect(parse(out).claudeWt.desktop).toBe(false);
  });

  it('не портит соседние флоу-массив и фолдед-скаляр', () => {
    const out = patchConfigScalar(SAMPLE, 'claudeWt', 'enabled', false);
    expect(out).toContain("args: ['-w', '-1']");
    expect(out).toContain('      - >-');
    expect(parse(out).claudeWt.launchNew.args[1]).toBe(parse(SAMPLE).claudeWt.launchNew.args[1]);
  });

  it('пишет строку с обратными слэшами так, что она читается обратно как есть', () => {
    const value = 'C:\\Users\\popstas\\AppData\\claude-wt.json';
    const out = patchConfigScalar(SAMPLE, 'claudeWt', 'sessionsFile', value);
    expect(parse(out).claudeWt.sessionsFile).toBe(value);
  });

  it('сохраняет CRLF файла', () => {
    const crlf = SAMPLE.replace(/\n/g, '\r\n');
    const out = patchConfigScalar(crlf, 'claudeWt', 'statePath', 'C:\\state.json');
    expect(out).not.toMatch(/[^\r]\n/);
    expect(parse(out).claudeWt.statePath).toBe('C:\\state.json');
  });

  it('дописывает отсутствующий ключ после последнего поля секции, с её отступом', () => {
    const out = patchConfigScalar(SAMPLE, 'claudeWt', 'progressDir', '/tmp/progress');
    expect(parse(out).claudeWt.progressDir).toBe('/tmp/progress');
    expect(out).toContain('  progressDir: /tmp/progress');
    // Вставка идёт после ВСЕГО блочного значения последней пары, а не после её
    // первой строки — иначе ключ уехал бы внутрь launchNew.
    expect(parse(out).claudeWt.launchNew.args).toHaveLength(2);
  });

  it('дописывает отсутствующую секцию в конец файла', () => {
    const raw = 'placeWindowOnOpen: true\n';
    const out = patchConfigScalar(raw, 'homeassistant', 'slots', 9);
    expect(out).toBe('placeWindowOnOpen: true\nhomeassistant:\n  slots: 9\n');
  });

  it('дописывает секцию файлу без завершающего перевода строки', () => {
    const out = patchConfigScalar('placeWindowOnOpen: true', 'homeassistant', 'slots', 9);
    expect(parse(out).homeassistant.slots).toBe(9);
    expect(out).toContain('true\nhomeassistant:');
  });

  it('наполняет пустую флоу-карту секции', () => {
    const raw = 'claudeWt: {}\n';
    const out = patchConfigScalar(raw, 'claudeWt', 'terminal', 'wezterm');
    expect(parse(out).claudeWt.terminal).toBe('wezterm');
  });

  it('меняет значение внутри флоу-карты, если ключ там уже есть', () => {
    const raw = 'claudeWt: { terminal: wt, debug: false }\n';
    const out = patchConfigScalar(raw, 'claudeWt', 'terminal', 'wezterm');
    expect(out).toBe('claudeWt: { terminal: wezterm, debug: false }\n');
  });

  it('отказывается вставлять ключ в непустую флоу-карту', () => {
    const raw = 'claudeWt: { terminal: wt }\n';
    expect(() => patchConfigScalar(raw, 'claudeWt', 'debug', true)).toThrow(/flow-стиль/);
  });

  it('отказывается править секцию, которая не отображение ключей', () => {
    const raw = 'claudeWt:\n  - one\n  - two\n';
    expect(() => patchConfigScalar(raw, 'claudeWt', 'debug', true)).toThrow(/не отображение ключей/);
  });

  it('отказывается на неразбираемом конфиге, называя строку', () => {
    const raw = 'claudeWt:\n  a: 1\n :\n\t- broken\n';
    expect(() => patchConfigScalar(raw, 'claudeWt', 'debug', true)).toThrow(/не разбирается/);
  });
});

describe('patchConfigScalar: удаление ключа', () => {
  it('вырезает строку ключа целиком, не трогая соседей', () => {
    const out = patchConfigScalar(SAMPLE, 'claudeWt', 'interval', undefined);
    expect(parse(out).claudeWt.interval).toBeUndefined();
    expect(out).toBe(SAMPLE.replace('  interval: 1000\n', ''));
  });

  it('вырезает и хвостовой комментарий этой строки', () => {
    const out = patchConfigScalar(SAMPLE, 'claudeWt', 'desktop', undefined);
    expect(out).not.toContain('return the window to its virtual desktop');
    expect(parse(out).claudeWt.desktop).toBeUndefined();
  });

  it('молчит, если ключа и так не было', () => {
    expect(patchConfigScalar(SAMPLE, 'claudeWt', 'progressDir', undefined)).toBe(SAMPLE);
  });

  it('молчит, если и секции не было', () => {
    const raw = 'placeWindowOnOpen: true\n';
    expect(patchConfigScalar(raw, 'homeassistant', 'slots', undefined)).toBe(raw);
  });

  it('отказывается удалять из флоу-карты', () => {
    const raw = 'claudeWt: { terminal: wt, debug: false }\n';
    expect(() => patchConfigScalar(raw, 'claudeWt', 'debug', undefined)).toThrow(/flow-стиль/);
  });
});

describe('renderScalar', () => {
  it('отвергает значение с переводом строки', () => {
    expect(() => renderScalar('a\nb')).toThrow(/несколько строк/);
  });

  it('пустую строку пишет кавычками, а не пустотой', () => {
    expect(renderScalar('')).toBe('""');
  });
});

describe('verifyPatch', () => {
  it('ловит расхождение между записанным и запрошенным', () => {
    const text = 'claudeWt:\n  interval: 1000\n';
    expect(() => verifyPatch(text, 'claudeWt', 'interval', 2000)).toThrow(/не совпадает/);
  });

  it('ловит неразбираемый результат', () => {
    expect(() => verifyPatch('claudeWt:\n  a: 1\n :\n\t- x\n', 'claudeWt', 'a', 1)).toThrow(/не разбирается/);
  });

  it('молчит, когда всё верно', () => {
    expect(() => verifyPatch('claudeWt:\n  interval: 1000\n', 'claudeWt', 'interval', 1000)).not.toThrow();
  });
});
