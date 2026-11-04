// Applies the theme and language before first paint, so there's no flash of the wrong one, and pins
// theme-color to the theme (it colours an installed app's status bar): the ones saved on this device
// (the family's keys `ewo:theme`, `ewo:lang`; Default saves no key; an older pick of System, saved as
// 'system', follows the browser), else Dashboard's (#ewo-config, which the server puts first in <head>), else
// the built-in ones: the system's theme, and Deutsch, since Yksi speaks German first. Keep in step
// with src/lib/i18n.svelte.ts (systemLang), src/lib/theme.ts and src/lib/defaults.ts.
var ewoConfig = {};
try {
  ewoConfig = JSON.parse(document.getElementById('ewo-config').textContent) || {};
} catch (e) {}
try {
  var theme, lang;
  try {
    theme = localStorage.getItem('ewo:theme');
    lang = localStorage.getItem('ewo:lang');
  } catch (e) {}
  if (theme !== 'light' && theme !== 'dark') theme = ewoConfig.theme;
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.dataset.theme = theme;
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].content = theme === 'light' ? '#f6f7f4' : '#19221f';
  }
  if (lang !== 'en' && lang !== 'de' && lang !== 'system') lang = ewoConfig.lang === 'en' || ewoConfig.lang === 'de' ? ewoConfig.lang : 'de';
  if (lang === 'system') {
    // An older System: the first of the browser's languages the game speaks, English otherwise.
    var tags = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    lang = 'en';
    for (var j = 0; j < tags.length; j++) {
      var base = String(tags[j]).toLowerCase().slice(0, 2);
      if (base === 'de' || base === 'en') {
        lang = base;
        break;
      }
    }
  }
  document.documentElement.lang = lang;
} catch (e) {}

// The splash screen's switch (#splash, written into index.html by plans/splash-rollout/launch.mjs).
// Copy this block to the end of the app's pre-paint script (public/boot.js or its equivalent, a
// classic script in <head>: the CSP allows no inline script). TCGSL's public/boot.js is the original.
//
// The splash shows in the installed app only, or with ?splash for a look in a browser tab. It starts
// where the iOS launch image left the mark, plays once, then fades into the app once the first screen
// is in (the app dispatches `splash:ready`), and it never stays past 1.5 s: on a slow connection the
// app's skeletons take over. Once faded it leaves the DOM, which keeps it out of every view transition.
try {
  var standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone || /[?&]splash\b/.test(location.search)) {
    var root = document.documentElement;
    root.classList.add('splash');
    // The launch image centres the mark on the whole screen. Should the page start below the
    // status bar (with viewport-fit=cover it doesn't), lift the mark by half the bar.
    var lift = (screen.height - innerHeight) / 2;
    if (standalone && innerHeight > innerWidth && lift > 0 && lift < 60) root.style.setProperty('--splash-lift', lift + 'px');
    // Clinch keeps its own motion setting on <html data-motion> (set just before this runs).
    var still = matchMedia('(prefers-reduced-motion: reduce)').matches || root.dataset.motion === 'reduced';
    var played = still;
    var ready = false;
    var gone = false;
    var leave = function () {
      if (gone) return;
      gone = true;
      root.classList.add('splash-out');
      setTimeout(function () {
        var splash = document.getElementById('splash');
        if (splash) splash.remove();
        root.classList.remove('splash', 'splash-out');
      }, still ? 220 : 340);
    };
    document.addEventListener('animationend', function (e) {
      if (e.animationName !== 'splash-glint') return;
      played = true;
      if (ready) leave();
    });
    addEventListener('splash:ready', function () {
      ready = true;
      if (played) leave();
    });
    setTimeout(leave, 1500);
  } else {
    addEventListener('DOMContentLoaded', function () {
      var splash = document.getElementById('splash');
      if (splash) splash.remove();
    });
  }
} catch (e) {}
