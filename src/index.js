import fs from 'node:fs';
import path from 'node:path';
import { program } from 'commander';
import * as winMan from './lib/index.js';
winMan.watchAppliedLayouts();

start();

async function start() {
  program.option('--first');

  program
    .command('place')
    .option('-v, --verbose', 'verbose placement logging')
    .action((options) => winMan.placeWindows({ verbose: options.verbose }));
  program.command('store').action(winMan.storeWindows);
  program.command('restore').action(winMan.restoreWindows);

  program.command('stats').action(() => {
    const stats = winMan.getStats();
    console.log(stats);
  });

  program.command('dashboard').action(() => {
    const config = winMan.getConfig();

    let stats = {};
    try {
      stats = winMan.getStats();
    } catch (e) {
      stats = { error: e.message };
    }

    let store = {};
    try {
      if (config.store?.path && fs.existsSync(config.store.path)) {
        store = JSON.parse(fs.readFileSync(config.store.path, 'utf8'));
      }
    } catch (e) {
      store = { error: e.message };
    }

    const cfgPath = config._configPath || '';
    let configContent = '';
    try {
      if (cfgPath && fs.existsSync(cfgPath)) {
        configContent = fs.readFileSync(cfgPath, 'utf8');
      }
    } catch (e) {
      configContent = 'Error reading config: ' + e.message;
    }

    const logPath = path.resolve(process.cwd(), 'data/windows11-manager.log');
    let logTail = [];
    try {
      if (fs.existsSync(logPath)) {
        const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
        logTail = lines.slice(-5);
      }
    } catch (e) {
      logTail = ['Error reading log: ' + e.message];
    }

    console.log(JSON.stringify({ stats, store, configPath: cfgPath, configContent, logTail }));
    process.exit(0);
  });

  program.parse();
}
