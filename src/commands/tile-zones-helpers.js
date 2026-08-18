/**
 * Чистые помощники поля `tileZones` в окне настроек: разбор и форматирование
 * текстовой формы textarea. Без I/O — тот же приём, что у config-helpers.js.
 *
 * Формат строки — `monitor,position`, по паре на строку (тот же приём, что у
 * соседнего поля `store_match_list`: textarea, склейка через `\n`). Форма пары
 * та же, что у `rule.fancyZones` и у `claudeWt.tileZones` в config.example.yaml.
 */

const LINE_RE = /^(\d+)\s*,\s*(\d+)$/;

/** Зоны -> текст textarea: по паре `monitor,position` на строку. */
function formatTileZonesText(zones = []) {
  return zones.map((z) => `${z.monitor},${z.position}`).join('\n');
}

/**
 * Текст textarea -> список зон.
 *
 * Пустые строки (и строки из одних пробелов) пропускаются молча — это обычный
 * итог редактирования вручную. Первая же неразборчивая строка возвращается
 * как ошибка с номером строки и её содержимым: тихо отбрасывать её нельзя,
 * человек должен увидеть причину в статусе окна настроек.
 */
function parseTileZonesText(text = '') {
  const zones = [];
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;
    const m = LINE_RE.exec(line);
    if (!m) {
      return {
        zones: null,
        error: `строка ${i + 1} не разбирается: "${line}" (ожидается "monitor,position", например "1,6")`,
      };
    }
    zones.push({ monitor: Number(m[1]), position: Number(m[2]) });
  }
  return { zones, error: null };
}

export { formatTileZonesText, parseTileZonesText };
