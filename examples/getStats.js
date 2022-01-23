// Opened windows stats
const { getStats } = require('windows11-manager');

async function start() {
  console.log(getStats());
}

start();
