import './app.css';
// The faces, Latin only (German included): Unbounded for the name, the buttons and the numbers,
// Familjen Grotesk for everything else (look A, Kangas, the user's pick of 2026-10-20).
import '@fontsource/unbounded/latin-600.css';
import '@fontsource/unbounded/latin-800.css';
import '@fontsource/familjen-grotesk/latin-400.css';
import '@fontsource/familjen-grotesk/latin-500.css';
import '@fontsource/familjen-grotesk/latin-600.css';
import '@fontsource/familjen-grotesk/latin-700.css';
import './lib/scrolling';
// Folio's shared elements (vendor/ewo); each defines itself once.
import '../vendor/ewo/elements/settings-button.js';
import '../vendor/ewo/elements/settings-basics.js';
import '../vendor/ewo/elements/sheet.js';
import '../vendor/ewo/elements/guide.js';
import '../vendor/ewo/elements/segmented.js';
import '../vendor/ewo/elements/switch.js';
import '../vendor/ewo/elements/emblem.js';
import '../vendor/ewo/elements/emblem-maker.js';
import '../vendor/ewo/elements/connection.js';

import { mount } from 'svelte';
import App from './App.svelte';
// Every tap answers on a phone, the games' lively way (Folio's pressFeedback,
// development/plans/mobile-touch.md).
import { pressFeedback } from '../vendor/ewo/elements/press.js';
// A wait for the server shows at the control that asked (Folio's track() via src/lib/waits.ts):
// Yksi's working mark is a little card turning over (app.css).
import { configureWaiting } from '../vendor/ewo/elements/waiting.js';
// The paper's grain on every card (Folio's card kit): made once, as --grain.
import { paperGrain } from '../vendor/ewo/elements/card-paper.js';

pressFeedback({ preset: 'lively' });
configureWaiting({
  mark: '<svg class="flip" viewBox="0 0 16 22" aria-hidden="true"><rect x="1" y="1" width="14" height="20" rx="3" /><circle cx="8" cy="11" r="2.6" /></svg>',
});
paperGrain();

function start() {
  mount(App, { target: document.getElementById('app')! });
  requestAnimationFrame(() => dispatchEvent(new Event('splash:ready')));
}

// Installed, the app opens on the splash screen (index.html, switched on by public/boot.js; written by
// development/plans/splash-rollout). iOS fades its launch image into the page as soon as the page has
// laid out, so the splash has to be on screen before the app's first render takes the main thread, or
// the fade goes through a blank white web view. It lifts a frame after the app has mounted.
if (document.documentElement.classList.contains('splash')) {
  let started = false;
  const once = () => {
    if (started) return;
    started = true;
    start();
  };
  requestAnimationFrame(() => setTimeout(once));
  setTimeout(once, 100);
} else {
  start();
}

/**
 * The offline shell (see public/sw.js). Production only: a worker in front of the dev server would
 * cache the modules Vite is trying to hot-replace.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
