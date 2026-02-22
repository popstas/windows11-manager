import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function resolveConfigPath() {
  const candidates = [
    path.join(os.homedir(), '.config', 'windows11-manager.config.js'),
    path.join(process.cwd(), 'windows11-manager.config.js'),
    path.resolve(__dirname, '../config.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.resolve(__dirname, '../config.js');
}

let configPath = resolveConfigPath();

function getConfig() {
  delete require.cache[require.resolve(configPath)];
  const config = require(configPath);
  if (config.debug) console.log('Config loaded from:', configPath);
  return config;
}

function reloadConfigs() {
  const config = getConfig();
  if (config.debug) console.log('Configuration reloaded');
  return config;
}

let lastAppliedLayoutsMtime = 0;
let watcherStarted = false;

function watchAppliedLayouts() {
  if (watcherStarted) return;
  watcherStarted = true;
  setInterval(() => {
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
}

export { getConfig, reloadConfigs, watchAppliedLayouts };
