import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configCandidates, formatMissingConfig, parseConfigText, shouldReload } from './config-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// OS settings base dir: %APPDATA% on Windows, ~/Library/Application Support on
// macOS, $XDG_CONFIG_HOME (or ~/.config) on Linux.
function appDataDir() {
  if (process.platform === 'win32') {
    return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support');
  }
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

/** Места поиска для этой машины. Экспортируется ради отказа, который их перечисляет. */
function candidates() {
  return configCandidates({
    appDataDir: appDataDir(),
    homedir: os.homedir(),
    cwd: process.cwd(),
    repoDir: path.resolve(__dirname, '..'),
  });
}

/** Первый существующий кандидат; пусто — конфига нет нигде. */
function resolveConfigPath() {
  for (const candidate of candidates()) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

/** Прочитать названный файл. Без `_configPath`: его добавляет только getConfig. */
function loadConfigFile(filePath) {
  return parseConfigText(fs.readFileSync(filePath, 'utf8'), filePath);
}

let configPath = resolveConfigPath();

// Разобранный конфиг живёт до смены mtime — почему, см. shouldReload().
let cached = null;
let cachedPath = '';
let cachedMtimeMs = null;

function configMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

function getConfig() {
  if (!configPath) throw new Error(formatMissingConfig(candidates()));
  const mtimeMs = configMtimeMs(configPath);
  // `!cached` — не перестраховка: shouldReload() сверяет путь и mtime и ничего не
  // знает про то, наполнен ли кэш. Сбросьте однажды только `cached`, не тронув
  // `cachedPath`, — и ниже будет structuredClone(null) с TypeError на присвоении.
  if (!cached || shouldReload({ cachedPath, cachedMtimeMs, filePath: configPath, mtimeMs })) {
    cached = loadConfigFile(configPath);
    cachedPath = configPath;
    cachedMtimeMs = mtimeMs;
  }
  // Копия обязана быть глубокой: вызывающие пишут прямо в объекты конфига —
  // placement.js ставит rule.pos правилам из config.windows, findWindows()
  // дописывает им titleMatch. Общий кэшированный объект копил бы эти пометки
  // между вызовами. Отката на «неклонируемый конфиг» больше нет: функций в
  // YAML не бывает, и structuredClone на этих данных не спотыкается.
  const config = structuredClone(cached);
  config._configPath = configPath;
  return config;
}

function reloadConfigs() {
  // Явный сброс: «перечитать» должно означать перечитать, а не «сверить mtime».
  cached = null;
  cachedPath = '';
  // Файл могли положить в другое место (или впервые) уже после старта процесса.
  configPath = resolveConfigPath();
  const config = getConfig();
  if (config.debug) console.log('Configuration reloaded');
  return config;
}

let lastAppliedLayoutsMtime = 0;
let watcherStarted = false;

function watchAppliedLayouts() {
  if (watcherStarted) return;
  watcherStarted = true;
  // Ватчер поднимается в index.js до разбора аргументов, то есть для любой
  // команды. Без unref() его таймер держал событийный цикл, и разовые команды
  // без явного process.exit() (`place`) не завершались: работа сделана за
  // 300 мс, а процесс висел часами по 60 МБ, просыпаясь раз в минуту. Трей
  // ждёт такого ребёнка через .output(), так что копился ещё и он.
  // Отказ конфига переживается, а не уносит процесс: ватчер поднимается для
  // любой команды, включая долгоживущую службу `mqtt`, и одна опечатка в YAML
  // на живой машине убивала её через минуту. Home Assistant этого не замечает:
  // availability: offline публикует только штатный stop(), а `online` retained.
  const onConfigFailure = (e) => {
    console.error(`[config] ватчер applied-layouts не смог прочитать конфиг: ${e.message}`);
  };
  const timer = setInterval(() => {
    try {
      const config = getConfig();
      if (!config.fancyZones?.path) return;
      const file = `${config.fancyZones.path}/applied-layouts.json`;
      fs.stat(file, (err, stats) => {
        if (err) return;
        const mtime = stats.mtimeMs;
        if (!lastAppliedLayoutsMtime) {
          lastAppliedLayoutsMtime = mtime;
          return;
        }
        if (mtime !== lastAppliedLayoutsMtime) {
          lastAppliedLayoutsMtime = mtime;
          // Тот же охранник и здесь: этот вызов уже в обратном вызове fs.stat,
          // и его исключение до catch снаружи не долетит.
          try {
            reloadConfigs();
          } catch (e) {
            onConfigFailure(e);
          }
        }
      });
    } catch (e) {
      onConfigFailure(e);
    }
  }, 60000);
  timer.unref();
}

export { getConfig, reloadConfigs, watchAppliedLayouts, loadConfigFile, resolveConfigPath, candidates };
