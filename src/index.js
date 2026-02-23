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

  program.parse();
}
