// Sounds, made on the spot with Web Audio: no files, no third parties. Off by default (the family's
// rule since Stichle, 2026-10-12), switched on per device in Settings (`yksi:sound`). A browser
// only plays sound after a tap, so the context starts on the first pointer or key press. On a call
// each device plays its own. From Würfle's sound.svelte.ts.

const KEY = 'yksi:sound';

function stored() {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export const sound = $state({ on: stored() });

export function setSound(on: boolean) {
  sound.on = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // not kept
  }
}

let ctx: AudioContext | null = null;

function context() {
  if (!sound.on) return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Unlocks audio on the first gesture (browsers start contexts suspended until then). */
export function unlockOnGesture() {
  const go = () => {
    context();
    removeEventListener('pointerdown', go);
    removeEventListener('keydown', go);
  };
  addEventListener('pointerdown', go);
  addEventListener('keydown', go);
}

/** One soft note: a sine with a quick attack and a decay. */
function note(freq: number, at: number, length: number, gain = 0.12, type: OscillatorType = 'sine') {
  const c = context();
  if (!c) return;
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const amp = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(amp).connect(c.destination);
  osc.start(t);
  osc.stop(t + length + 0.05);
}

/** A short burst of noise through a band-pass: glass on glass, a pencil on paper. */
function click(at: number, freq: number, length = 0.05, gain = 0.18, q = 1.2) {
  const c = context();
  if (!c) return;
  const t = c.currentTime + at;
  const frames = Math.max(1, Math.floor(c.sampleRate * length));
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 3;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq;
  band.Q.value = q;
  const amp = c.createGain();
  amp.gain.value = gain;
  src.connect(band).connect(amp).connect(c.destination);
  src.start(t);
}

export const play = {
  /** A card lands on the pile: a soft slap of paper. */
  lay: () => click(0, 1800 + Math.random() * 600, 0.07, 0.16, 0.9),
  /** A card slid off the stock. */
  draw: () => click(0, 3400, 0.09, 0.07, 0.7),
  /** It's your turn. */
  yourTurn: () => {
    note(587.3, 0, 0.14, 0.09, 'triangle');
    note(784, 0.12, 0.24, 0.09, 'triangle');
  },
  /** "Yksi!": somebody called it. */
  call: () => [784, 1046.5].forEach((f, i) => note(f, i * 0.08, 0.3, 0.08, 'triangle')),
  /** Caught without the call: two low notes. */
  caught: () => [392, 311.1].forEach((f, i) => note(f, i * 0.12, 0.28, 0.09, 'square')),
  /** The last seconds. */
  tick: () => note(1200, 0, 0.05, 0.05, 'square'),
  /** A round won. */
  out: () => [659.3, 784, 1046.5].forEach((f, i) => note(f, i * 0.1, 0.32, 0.08, 'triangle')),
  /** The match's winner. */
  fanfare: () => [523.3, 659.3, 784, 1046.5].forEach((f, i) => note(f, i * 0.12, 0.4, 0.09, 'triangle')),
};
