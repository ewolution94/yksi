// Simulated games for bots: whole matches and positions played out by bots or random players.
// Not in CI (the user, 2026-10-20: "rely on simpler (unit) tests there"); run them with `npm run test:sim`.
// Yksi's bots (server/bots.mjs): every rank's move is one the rules list; the same position always
// gives the same move; none reads a hand but its own (everything a seat can't see shuffled, the same
// view and the same move); each rank's habits show on hand-picked deals; the master decides within
// 150 ms; and on duplicate deals the journeyman beats the apprentice.

import { test } from 'node:test';
import { COLOURS, act, createGame, handPoints, makeDeck, moves, parseCard, view } from '../server/rules.mjs';
import { assert, checkState, isListed, reflexes, seeded } from './helpers.mjs';

// The master's trials bound by count, not by the clock: repeatable, and quick.
process.env.YKSI_MASTER_MS = '100000';
process.env.YKSI_MASTER_PLAYS = '800';
const { LEVELS, botMove, botReflex } = await import('../server/bots.mjs');

const DECK = makeDeck();
const RULESETS = [{}, { stack: true }, { jumpIn: true }, { sevenZero: true }, { drawToPlay: true }, { stack: true, jumpIn: true, sevenZero: true, drawToPlay: true }];

/** A fixed deal of all 108 cards (these hands, this upcard, `front` drawn first, the rest in box order). */
function game(hands, top, { front = [], dealer = 0, rules = {} } = {}) {
  const used = new Set([...hands.flat(), top, ...front]);
  const stock = [...front, ...DECK.filter((id) => !used.has(id))];
  return createGame({ players: hands.length, hands, top, stock, dealer, rules, randomInt: seeded(1) });
}

/** Positions part-way through rounds (journeymen and apprentices play up to them, reflexes too). */
function positions(count, seed) {
  const randomInt = seeded(seed);
  const out = [];
  for (let g = 0; out.length < count && g < count * 4; g++) {
    const players = 2 + (g % 6);
    const s = createGame({ players, dealer: g % players, rules: { ...RULESETS[g % RULESETS.length], target: 0 }, randomInt });
    const stop = randomInt(60);
    const level = (seat) => (seat % 2 ? 'apprentice' : 'journeyman');
    for (let k = 0; k < stop && s.phase === 'play'; k++) {
      const seat = s.turn;
      act(s, seat, /** @type {any} */ (botMove(s, seat, { level: level(seat) })), { randomInt });
      if (s.phase === 'play' && randomInt(2)) reflexes(s, seat, (t, o) => botReflex(t, o, { level: level(o) }), randomInt);
    }
    if (s.phase === 'play') out.push(s);
  }
  return out;
}

/**
 * The same position with everything `seat` can't see shuffled: the others' cards among the others
 * (each keeping its count; a card the turn's player drew to choose on stays theirs), the stock, and
 * whether a waiting Four was a bluff. Null when the shuffle changed what the seat sees.
 */
function scramble(s, seat, randomInt) {
  const t = structuredClone(s);
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const kept = t.drawn && t.turn !== seat ? t.drawn : null;
  const places = [...t.hands.keys()].filter((p) => p !== seat);
  const pool = shuffle([...places.flatMap((p) => t.hands[p]), ...t.stock].filter((id) => id !== kept));
  for (const p of places) {
    const want = t.hands[p].length - (kept && p === t.turn ? 1 : 0);
    t.hands[p] = pool.splice(0, want);
    if (kept && p === t.turn) t.hands[p].push(kept);
  }
  t.stock = pool;
  if (t.pending?.kind === 'd4') t.pending.guilty = randomInt(2) === 1;
  return JSON.stringify(view(t, seat)) === JSON.stringify(view(s, seat)) ? t : null;
}

test('no rank reads a hand but its own: everything hidden shuffled, the same view and the same move', () => {
  const randomInt = seeded(7);
  let checked = 0;
  for (const s of positions(40, 11)) {
    const seat = s.turn;
    for (const level of LEVELS) {
      const before = botMove(s, seat, { level });
      for (let k = 0; k < 2; k++) {
        const t = scramble(s, seat, randomInt);
        if (!t) continue;
        assert.deepEqual(botMove(t, seat, { level }), before, `${level}, ${s.players} players`);
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 200, `only ${checked} positions checked`);
});

test('no reflex reads a hand but its own either', () => {
  const randomInt = seeded(8);
  let checked = 0;
  let some = 0;
  for (const s of positions(80, 12)) {
    for (let seat = 0; seat < s.players; seat++) {
      for (const level of LEVELS) {
        const before = botReflex(s, seat, { level });
        if (before) some += 1;
        const t = scramble(s, seat, randomInt);
        if (!t) continue;
        assert.deepEqual(botReflex(t, seat, { level }), before, `${level} at seat ${seat}`);
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 300, `only ${checked} checked`);
  assert.ok(some >= 1, 'some reflexes among them');
});

test('every rank’s move is one the rules list, and a position always gives the same move', () => {
  const randomInt = seeded(3);
  let checked = 0;
  for (let g = 0; g < 24; g++) {
    const players = 2 + (g % 7);
    const s = createGame({ players, dealer: g % players, rules: { ...RULESETS[g % RULESETS.length], target: 0 }, randomInt });
    for (let steps = 0; s.phase === 'play'; steps++) {
      assert.ok(steps < 3000, 'the round ends');
      const seat = s.turn;
      const level = LEVELS[(seat + g) % 3];
      const move = botMove(s, seat, { level });
      assert.ok(move && isListed(s, seat, move), `${level}: ${JSON.stringify(move)}`);
      if (steps % 5 === 0) {
        assert.deepEqual(botMove(s, seat, { level }), move, 'again');
        assert.deepEqual(botMove(structuredClone(s), seat, { level }), move, 'on a copy');
      }
      act(s, seat, /** @type {any} */ (move), { randomInt });
      checkState(s);
      checked += reflexes(s, seat, (t, o) => botReflex(t, o, { level: LEVELS[(o + g) % 3] }), randomInt, checkState);
    }
    assert.deepEqual(botMove(s, 0), s.phase === 'scored' ? { type: 'next' } : null);
  }
  assert.ok(checked > 0, 'reflexes played');
});

test('the master decides within 150 ms at its real budget: median and slowest over many moves', async (t) => {
  delete process.env.YKSI_MASTER_MS;
  delete process.env.YKSI_MASTER_PLAYS;
  const real = await import('../server/bots.mjs?timed');
  const randomInt = seeded(31);
  /** @type {number[]} */
  const times = [];
  for (let g = 0; times.length < 120 && g < 40; g++) {
    const players = [2, 4, 6, 10][g % 4];
    const s = createGame({ players, dealer: 0, rules: { ...RULESETS[g % RULESETS.length], target: 0 }, randomInt });
    while (s.phase === 'play') {
      const seat = s.turn;
      const level = seat % 2 ? 'master' : 'journeyman';
      const t0 = performance.now();
      const move = real.botMove(s, seat, { level });
      if (level === 'master') times.push(performance.now() - t0);
      act(s, seat, /** @type {any} */ (move), { randomInt });
    }
  }
  times.sort((a, b) => a - b);
  const median = times[times.length >> 1];
  const slowest = times[times.length - 1];
  t.diagnostic(`master: ${times.length} moves, median ${median.toFixed(1)} ms, slowest ${slowest.toFixed(1)} ms`);
  assert.ok(times.length >= 120, `${times.length} moves`);
  // A slower machine (CI's runner, the NAS) reaches the clock's stop before the count of plays: the
  // median then sits at the stop, plus the trial running when it struck. Never over the 150 ms a move.
  assert.ok(median < real.MASTER_MS + 15, `median ${median.toFixed(1)} ms (stop ${real.MASTER_MS} ms)`);
  assert.ok(slowest < 150, `slowest ${slowest.toFixed(1)} ms`);
});

test('on duplicate deals the journeyman beats the apprentice', () => {
  let edge = 0;
  const pairs = 150;
  for (let d = 0; d < pairs; d++) {
    for (const flip of [0, 1]) {
      const randomInt = seeded(9000 + d);
      const level = (seat) => ((seat + flip) % 2 ? 'journeyman' : 'apprentice');
      const s = createGame({ players: 4, dealer: d % 4, rules: { target: 0 }, randomInt });
      while (s.phase === 'play') {
        const seat = s.turn;
        act(s, seat, /** @type {any} */ (botMove(s, seat, { level: level(seat) })), { randomInt });
        reflexes(s, seat, (t, o) => botReflex(t, o, { level: level(o) }), randomInt);
      }
      for (let seat = 0; seat < 4; seat++) {
        const net = s.result.points[seat] - (s.winner === seat ? 0 : handPoints(s.hands[seat]) / 3);
        edge += level(seat) === 'journeyman' ? net : -net;
      }
    }
  }
  assert.ok(edge / pairs / 4 > 2, `edge ${(edge / pairs / 4).toFixed(2)} a seat and round`);
});
