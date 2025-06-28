const { program } = require('commander');
const winMan = require('./lib');

start();

async function start() {
  program.option('--first');

  program.command('place').action(winMan.placeWindows);
  program.command('store').action(winMan.storeWindows);
  program.command('restore').action(winMan.restoreWindows);

  program.command('stats').action(() => {
    const stats = winMan.getStats();
    console.log(stats);
  });

  program.parse();
}
