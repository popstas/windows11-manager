import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

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

function resolveConfigPath() {
  const candidates = [
    path.join(appDataDir(), 'windows-mqtt', 'windows11-manager.config.js'),
    path.join(appDataDir(), 'windows11-manager', 'config.js'),
    path.join(os.homedir(), '.config', 'windows11-manager.config.js'),
    path.join(process.cwd(), 'windows11-manager.config.js'),
    path.resolve(__dirname, '../config.cjs'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.resolve(__dirname, '../config.cjs');
}

let configPath = resolveConfigPath();

// Разобранный модуль конфига. Раньше getConfig() сбрасывал кэш require на
// каждый вызов, то есть заново читал и компилировал файл — а зовут его из
// горячих циклов: тик демона claude-wt ходит сюда раз в секунду. Замерено на
// живом конфиге (16 КБ): 7200 вызовов подряд — 234 МБ RSS и 189 МБ heapTotal,
// 0.32 мс на вызов; с кэшем по mtime — 49 МБ и 9 МБ, 0.13 мс. Основной вес —
// не сами объекты, а скомпилированный код, который оседает в code space и
// тянет за собой всю кучу: демон за четыре часа набирал 300 МБ.
//
// Перечитывание осталось: конфиг правят на живой машине и ждут, что изменения
// подхватятся без перезапуска. Сторожем работает mtime — файл локальный
// (%APPDATA%), statSync на нём стоит микросекунды. Оговорка про SMB
// (см. sessions.js) сюда не относится: там сетевой диск, здесь свой.
let cachedModule = null;
let cachedModulePath = '';
let cachedModuleMtimeMs = null;
// structuredClone бросает DataCloneError на функциях. В конфигах их сейчас нет,
// но появиться могут, и тогда возвращаемся к прежнему поведению навсегда, а не
// платим исключением на каждый вызов.
let cloneable = true;

function configMtimeMs() {
  try {
    return fs.statSync(configPath).mtimeMs;
  } catch {
    // Файла нет — пусть require упадёт ровно так же, как падал раньше.
    return null;
  }
}

/** Свежий require мимо кэша: и первое чтение, и откат для неклонируемого конфига. */
function requireConfigModule() {
  delete require.cache[require.resolve(configPath)];
  const loaded = require(configPath);
  // require(esm) returns a frozen namespace: unwrap default so _configPath can
  // be attached regardless of the config's module format
  return loaded && loaded.default ? loaded.default : loaded;
}

function getConfig() {
  if (!cloneable) {
    // Свежий граф объектов на каждый вызов — как было до кэша.
    const config = { ...requireConfigModule() };
    config._configPath = configPath;
    return config;
  }
  const mtimeMs = configMtimeMs();
  if (!cachedModule || cachedModulePath !== configPath || mtimeMs === null
      || cachedModuleMtimeMs !== mtimeMs) {
    cachedModule = requireConfigModule();
    cachedModulePath = configPath;
    cachedModuleMtimeMs = mtimeMs;
  }
  let config;
  try {
    // Копия обязана быть глубокой: вызывающие пишут прямо в объекты конфига —
    // placement.js ставит rule.pos правилам из config.windows, findWindows()
    // дописывает им titleMatch. Со свежим require каждый вызов получал свой
    // граф, и пометки умирали вместе с ним; общий кэшированный объект копил бы
    // их между вызовами.
    config = structuredClone(cachedModule);
  } catch (e) {
    console.error(`Config is not cloneable, falling back to re-require: ${e.message}`);
    cloneable = false;
    cachedModule = null;
    config = { ...requireConfigModule() };
  }
  config._configPath = configPath;
  return config;
}

function reloadConfigs() {
  // Явный сброс: «перечитать» должно означать перечитать, а не «сверить mtime».
  cachedModule = null;
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
  const timer = setInterval(() => {
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
        reloadConfigs();
      }
    });
  }, 60000);
  timer.unref();
}

export { getConfig, reloadConfigs, watchAppliedLayouts };
