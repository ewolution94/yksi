// Shared by the tests: a seeded random, error matching, and the checks every move of a whole game
// must pass (the cards conserved, no view showing a hand it shouldn't, the totals adding up).

import assert from 'node:assert/strict';
import { RuleError, act, makeDeck, moves, view } from '../server/rules.mjs';

/** mulberry32: a repeatable random integer below n. */
export function seeded(seed = 1) {
  let a = seed >>> 0;
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

/** Asserts that fn throws a RuleError with this code. */
export const throws = (fn, code) => assert.throws(fn, (e) => e instanceof RuleError && e.code === code, code);

/** Every card id in a JSON text. */
const ID = /[rygbw]-(?:[0-9]|skip|rev|d2|wild|d4)-[0-3]/g;
const DECK = new Set(makeDeck());

/**
 * What must hold after every move: all 108 cards somewhere and each in one place only; every seat's
 * view (and a watcher's) carries no card but its own hand's, the pile's and a peek it was given,
 * until the round is scored; the totals are the history's sums.
 * @param {import('../server/rules.mjs').State} s
 */
export function checkState(s) {
  const all = [...s.hands.flat(), ...s.stock, ...s.pile];
  assert.equal(all.length, 108, 'cards conserved');
  assert.equal(new Set(all).size, 108, 'no card in two places');
  for (const id of all) assert.ok(DECK.has(id), id);
  for (let seat = 0; seat < s.players; seat++) {
    assert.equal(s.totals[seat], s.history.reduce((sum, h) => sum + h.points[seat], 0), 'totals are the history');
  }
  if (s.phase !== 'play') return;
  const pile = new Set(s.pile);
  for (const seat of [null, ...s.hands.keys()]) {
    const v = view(s, seat);
    const own = new Set(seat === null ? [] : s.hands[seat]);
    const peek = new Set(v.peek ? v.peek.hand : []);
    for (const id of JSON.stringify(v).match(ID) ?? []) {
      assert.ok(own.has(id) || pile.has(id) || peek.has(id), `seat ${seat}'s view shows ${id}`);
    }
    assert.ok(!v.pending || !('guilty' in v.pending), 'no Four’s guilt in a view');
    if (seat !== null && seat !== s.turn) assert.equal(v.drawn, null, 'a drawn card only for the seat that drew it');
  }
}

/** A move the rules list for this seat now (deep equality). */
export function isListed(s, seat, move) {
  const text = JSON.stringify(canon(move));
  return moves(s, seat).some((m) => JSON.stringify(canon(m)) === text);
}
const canon = (m) => Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)));

/**
 * Plays out what every seat's out-of-turn reflex wants after a move, starting left of `from` (the
 * mover last, so the others catch before a late call). Returns how many reflexes were played.
 */
export function reflexes(s, from, reflex, randomInt, check = () => {}) {
  let played = 0;
  for (let round = 0; round < 4 && s.phase === 'play'; round++) {
    let any = false;
    for (let k = 1; k <= s.players && s.phase === 'play'; k++) {
      const seat = (from + k) % s.players;
      const m = reflex(s, seat);
      if (!m) continue;
      assert.ok(isListed(s, seat, m), `reflex ${JSON.stringify(m)} for seat ${seat} isn't legal`);
      act(s, seat, m, { randomInt });
      check(s);
      played += 1;
      any = true;
    }
    if (!any) break;
  }
  return played;
}

export { assert };
