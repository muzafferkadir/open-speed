import { hideLoadingScreen } from './core/dom.js';
import { Game } from './core/Game.js';

new Game().start().catch(error => {
 console.error(error);
 hideLoadingScreen();
 document.getElementById('message')!.textContent =
  'Prototype failed to load. Reload the page; if it persists, check the console output.';
});
