// Autoplace new windows after open
import { placeWindowOnOpen } from 'windows11-manager';

async function start() {
  await placeWindowOnOpen();
}

start();
