const fs = require('fs');
const os = require('os');
const pathModule = require('path');

function resolveConfigPath() {
  const candidates = [
    pathModule.join(os.homedir(), '.config', 'windows11-manager.config.js'),
    pathModule.join(process.cwd(), 'windows11-manager.config.js'),
    pathModule.resolve(__dirname, '../config.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return pathModule.resolve(__dirname, '../config.js');
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
  if (config.fancyZones?.path) {
    try {
      const files = ['applied-layouts.json','custom-layouts.json','app-zone-history.json'];
      for (const file of files) {
        const fp = require.resolve(`${config.fancyZones.path}/${file}`);
        delete require.cache[fp];
      }
      require(`${config.fancyZones.path}/applied-layouts.json`);
      require(`${config.fancyZones.path}/custom-layouts.json`);
      require(`${config.fancyZones.path}/app-zone-history.json`);
      if (config.debug) console.log('Reloaded FancyZones configuration files');
    } catch(err) {
      console.error(`Error reloading FancyZones configs: ${err.message}`);
    }
  }
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

module.exports = { getConfig, reloadConfigs, watchAppliedLayouts };
