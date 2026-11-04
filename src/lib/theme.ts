// Light, dark or Default, picked in Settings. Folio's setTheme keeps a pick on this device under
// `ewo:theme` and Default removes it; then the page shows Dashboard's theme when one is set
// (#ewo-config, src/lib/defaults.ts), as public/boot.js does before first paint, else the system's.

import { readConfig } from '../../vendor/ewo/elements/config-client.js';
import { setTheme, type ThemeChoice } from '../../vendor/ewo/elements/theme-toggle.js';
import { themeFor, type Theme } from './defaults';

/** What a pick shows: light or dark, or `system` to follow the device's own setting. */
export const themeShown = (choice: ThemeChoice): Theme => themeFor(choice, readConfig().theme);

/** Applies a pick and keeps it on this device; Default goes back to Dashboard's theme. */
export function applyTheme(choice: ThemeChoice) {
  setTheme(choice);
  const shown = themeShown(choice);
  if (choice !== 'system' || shown === 'system') return;
  document.documentElement.dataset.theme = shown;
  // As public/boot.js: theme-color in the theme's own panel colour.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = shown === 'light' ? '#f6f7f4' : '#19221f';
}
