// Show window by title
const { focusWindow } = require('windows11-manager');

async function start() {
  focusWindow({ titleMatch: 'Trello.*popstas'});
}

start();
