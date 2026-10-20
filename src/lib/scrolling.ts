// While the page scrolls, rows slide under a resting cursor and each would switch into its hover
// state and back. Pausing pointer events on the content until scrolling settles means none of
// that happens mid-scroll; the root attribute only toggles when scrolling starts and stops.
//
// Measured (tools/scroll-bench.mjs): this keeps input latency at one frame during wheel
// scrolling. A fixed transparent "shield" over the page instead was slower in Chrome.
//
// Two guards, so the pause never costs a click: it only exists for a mouse or trackpad (the CSS
// in app.css is behind `(hover: hover) and (pointer: fine)`, since touch has no hover to protect),
// and it ends the moment the mouse really moves, which it does on the way to anything clickable.

const root = document.documentElement;
let settle = 0;

function resume() {
  clearTimeout(settle);
  settle = 0;
  delete root.dataset.scrolling;
}

addEventListener(
  'scroll',
  () => {
    if (!settle) root.dataset.scrolling = '';
    clearTimeout(settle);
    settle = window.setTimeout(resume, 140);
  },
  { passive: true },
);

addEventListener(
  'pointermove',
  (event) => {
    // Browsers send movement-less moves after a scroll to refresh hover; only a real one counts.
    if (settle && (event.movementX || event.movementY)) resume();
  },
  { passive: true },
);
