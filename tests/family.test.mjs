import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
// What Yksi hands Dashboard (public/ewo.config.json), checked with Folio's own rules, and the order
// a setting is decided in: this device's own choice, then Dashboard's default, then the built-in one
// (src/lib/defaults.ts, and public/boot.js before first paint).
import { checkManifest, resolve } from '../vendor/ewo/elements/config-core.js';
import { choiceFor, languageFor, soundsOn, themeFor } from '../src/lib/defaults.ts';

const manifest = JSON.parse(readFileSync(new URL('../public/ewo.config.json', import.meta.url), 'utf8'));

test('the manifest is one Dashboard takes: the family’s language (German here), theme and sounds', () => {
  const { ok, problems, manifest: checked } = checkManifest(manifest);
  assert.deepEqual(problems, []);
  assert.ok(ok);
  assert.equal(checked.app, 'yksi');
  assert.deepEqual(Object.keys(checked.settings), ['lang', 'theme', 'sounds']);
});

test('with nothing set in Dashboard: German, the system’s theme, no sounds, the page as it ships', () => {
  const { values, sources } = resolve(manifest, {});
  assert.deepEqual(values, { lang: 'de', theme: 'system', sounds: false });
  assert.deepEqual(sources, { lang: 'own', theme: 'built-in', sounds: 'built-in' });
  assert.equal(choiceFor(null, () => 'en'), 'system');
  assert.equal(languageFor(null, values.lang, () => 'en'), 'de');
  assert.equal(themeFor('system', values.theme), 'system');
  assert.equal(soundsOn(null, values.sounds), false);
});

test('Dashboard’s values reach the page: one set for Yksi, the family’s theme and sounds; the family’s language doesn’t', () => {
  // Yksi speaks German first: its own default comes before the family's language.
  assert.deepEqual(resolve(manifest, { family: { lang: 'en', theme: 'dark', sounds: true } }).values, { lang: 'de', theme: 'dark', sounds: true });
  assert.deepEqual(resolve(manifest, { family: { theme: 'dark' }, app: { lang: 'en', theme: 'light' } }).values, { lang: 'en', theme: 'light', sounds: false });
});

test('the device’s own choice beats Dashboard’s default, which beats the built-in one', () => {
  // QA's `ewo:lang` = `en` is this device's own choice, so it keeps winning.
  const browser = () => 'en';
  assert.equal(languageFor('en', 'de', browser), 'en');
  assert.equal(languageFor('de', 'en', browser), 'de');
  // Default saves nothing: Dashboard's, else German.
  assert.equal(languageFor(null, 'en', () => 'de'), 'en');
  // An older pick of System, saved as 'system', follows the browser as before, whatever Dashboard says.
  assert.equal(choiceFor('system', browser), 'en');
  assert.equal(languageFor('system', 'de', browser), 'en');
  // Dashboard's `system` is no default: German, as built in.
  assert.equal(languageFor(null, 'system', browser), 'de');
  assert.equal(languageFor(null, undefined, browser), 'de');
  assert.equal(themeFor('light', 'dark'), 'light');
  assert.equal(themeFor('system', 'dark'), 'dark');
  assert.equal(themeFor(null, 'light'), 'light');
  assert.equal(themeFor('system', 'system'), 'system');
  assert.equal(themeFor('system', 'purple'), 'system');
  assert.equal(soundsOn('off', true), false);
  assert.equal(soundsOn('on', false), true);
  assert.equal(soundsOn(null, true), true);
  assert.equal(soundsOn(null, undefined), false);
});

/** public/boot.js against a stub page: the language and theme it applies before first paint. */
function boot({ saved = {}, config, languages = ['de-DE'] }) {
  const root = { lang: 'de', dataset: {}, classList: { add() {}, remove() {} }, style: { setProperty() {} } };
  const metas = [{ content: '#f6f7f4', media: '(prefers-color-scheme: light)' }, { content: '#19221f', media: '(prefers-color-scheme: dark)' }];
  const document = {
    documentElement: root,
    getElementById: (id) => (id === 'ewo-config' && config ? { textContent: JSON.stringify(config) } : null),
    querySelectorAll: () => metas,
    addEventListener() {},
  };
  const localStorage = { getItem: (key) => saved[key] ?? null };
  vm.runInNewContext(readFileSync(new URL('../public/boot.js', import.meta.url), 'utf8'), {
    document,
    localStorage,
    matchMedia: () => ({ matches: false }),
    navigator: { languages, language: languages[0] },
    location: { search: '' },
    screen: {},
    innerHeight: 800,
    innerWidth: 400,
    addEventListener() {},
    setTimeout() {},
  });
  return { lang: root.lang, theme: root.dataset.theme, colors: metas.map((m) => m.content) };
}

test('before first paint: the saved language and theme, else Dashboard’s, else German and the system’s', () => {
  const system = ['#f6f7f4', '#19221f'];
  const dark = ['#19221f', '#19221f'];
  const light = ['#f6f7f4', '#f6f7f4'];
  assert.deepEqual(boot({}), { lang: 'de', theme: undefined, colors: system });
  assert.deepEqual(boot({ languages: ['en-US'] }), { lang: 'de', theme: undefined, colors: system });
  assert.deepEqual(boot({ config: { lang: 'de', theme: 'system', sounds: false } }), { lang: 'de', theme: undefined, colors: system });
  assert.deepEqual(boot({ config: { lang: 'en', theme: 'dark' } }), { lang: 'en', theme: 'dark', colors: dark });
  assert.deepEqual(boot({ config: { lang: 'system' }, languages: ['en-US'] }), { lang: 'de', theme: undefined, colors: system });
  assert.deepEqual(boot({ saved: { 'ewo:lang': 'en', 'ewo:theme': 'light' }, config: { lang: 'de', theme: 'dark' } }), { lang: 'en', theme: 'light', colors: light });
  assert.deepEqual(boot({ saved: { 'ewo:lang': 'system' }, config: { lang: 'de', theme: 'light' }, languages: ['en-US'] }), { lang: 'en', theme: 'light', colors: light });
});
