// Autoplace new windows after open
const { placeWindowOnOpen } = require('windows11-manager');

async function start() {
  await placeWindowOnOpen();
}

start();

