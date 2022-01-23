// test file

const winMan = require('./actions');

const place = true;
// const place = false;
// const stats = true;
const stats = false;

start();

async function start() {

  if (place) {
    const placed = await winMan.placeWindows();
    console.log(`Placed windows: ${placed.length}`);
  }

  if (stats) {
    const stats = winMan.getStats();
    console.log(stats);
  }
}
module.exports = {}