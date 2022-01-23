// Place windows by config rules
const { placeWindows } = require('windows11-manager');

async function start() {
  await placeWindows();
}

start();
