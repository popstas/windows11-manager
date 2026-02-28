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
  program
    .command('store')
    .action(() => {
      winMan.storeWindows();
      process.exit(0);
    });
  program
    .command('restore')
    .option('-v, --verbose', 'verbose logging')
    .action(async () => {
      await winMan.restoreWindows();
      process.exit(0);
    });

  program.command('clear').action(() => {
    winMan.clearWindows();
    process.exit(0);
  });

  program.command('reload').action(() => {
    winMan.reloadConfigs();
    process.exit(0);
  });

  program.command('open-default').action(() => {
    const config = winMan.getConfig();
    const stored = config?.store?.default;
    if (stored) {
      if (stored.apps) stored.windows = stored.apps.map(p => ({ path: p }));
      winMan.openStore(stored);
    }
    process.exit(0);
  });

  program
    .command('place-window')
    .option('--window <window>', 'window title or "current"', 'current')
    .option('--monitor <monitor>', 'monitor number', '1')
    .option('--position <position>', 'zone position number', '1')
    .action(async (options) => {
      const rule = {
        window: options.window,
        fancyZones: { monitor: options.monitor, position: options.position },
      };
      await winMan.placeWindowByConfig(rule);
    });

  program
    .command('http-server')
    .option('--port <port>', 'HTTP server port', '9722')
    .action(async (options) => {
      const { startHttpServer } = await import('./http-server.js');
      startHttpServer(Number(options.port));
    });

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

  program.allowExcessArguments();
  program.parse();
}
