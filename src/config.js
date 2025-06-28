const path = '../config.js';
function getConfig() {
  delete require.cache[require.resolve(path)];
  return require(path);
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
module.exports = { getConfig, reloadConfigs };
