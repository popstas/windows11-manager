// Show window by title
import { focusWindow } from 'windows11-manager';

async function start() {
  focusWindow({ titleMatch: 'Trello.*popstas'});
}

start();
