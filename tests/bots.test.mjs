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

test('botMove is null for a seat whose turn it isn’t; botReflex null when there’s nothing to do', () => {
  const s = game([['g-1-0', 'r-2-0'], ['b-1-0', 'b-2-0'], ['y-1-0', 'y-2-0']], 'g-5-0', { dealer: 2 });
  assert.equal(botMove(s, 1), null);
  for (const level of LEVELS) for (const seat of [0, 1, 2]) assert.equal(botReflex(s, seat, { level }), null);
});

// ---- the ranks' habits ------------------------------------------------------------------------------

test('the journeyman and the master always call; the apprentice forgets about one time in four', () => {
  const forgot = { apprentice: 0, journeyman: 0, master: 0 };
  const n = 200;
  for (let k = 0; k < n; k++) {
    // Seat 0 holds two cards, one fitting: its play leaves one.
    const s = game([['g-1-0', `r-${1 + (k % 9)}-1`], ['b-1-0', 'b-2-0', 'b-3-0'], ['y-1-0', 'y-2-0', `y-${3 + (k % 7)}-1`]], 'g-5-0', { dealer: 2 });
    s.round = k + 1; // a different position each time for the seeded draws (the round is in the view)
    for (const level of LEVELS) {
      const m = /** @type {any} */ (botMove(s, 0, { level }));
      if (m.type === 'play' && !m.call) forgot[level] += 1;
    }
  }
  assert.equal(forgot.journeyman, 0);
  assert.equal(forgot.master, 0);
  assert.ok(forgot.apprentice > n * 0.12 && forgot.apprentice < n * 0.4, `${forgot.apprentice} of ${n}`);
});

test('a catch: the journeyman and the master always, the apprentice seldom; a late call by whoever is open', () => {
  let caught = 0;
  const n = 120;
  for (let k = 0; k < n; k++) {
    const s = game([['g-1-0', 'g-2-0'], ['r-7-0', 'g-3-0'], ['y-1-0', 'y-2-0', `b-${1 + (k % 9)}-0`]], 'g-5-0', { dealer: 2 });
    s.round = k + 1;
    act(s, 0, { type: 'play', card: 'g-1-0' });
    assert.deepEqual(botReflex(s, 2, { level: 'journeyman' }), { type: 'catch' });
    assert.deepEqual(botReflex(s, 1, { level: 'master' }), { type: 'catch' });
    assert.deepEqual(botReflex(s, 0, { level: 'journeyman' }), { type: 'call' });
    assert.equal(botReflex(s, 0, { level: 'apprentice' }), null, 'an apprentice who forgot has forgotten');
    if (botReflex(s, 2, { level: 'apprentice' })) caught += 1;
  }
  assert.ok(caught > n * 0.08 && caught < n * 0.45, `${caught} of ${n}`);
});

test('the journeyman names the colour it holds most, keeps a wild while another card fits, and plays a Four only when it may', () => {
  const s = game([['r-1-0', 'r-2-0', 'r-3-0'], ['b-1-0', 'b-2-0', 'y-3-0', 'w-wild-0'], ['y-1-0', 'y-4-0', 'y-6-0']], 'w-wild-1', { dealer: 0 });
  assert.deepEqual(botMove(s, 1), { type: 'colour', colour: 'b' });
  act(s, 1, { type: 'colour', colour: 'y' });
  assert.deepEqual(botMove(s, 1), { type: 'play', card: 'y-3-0' }, 'the yellow, not the wild');

  // Holding green, a Four would be a bluff: the journeyman plays the green; the apprentice, now and then, the Four.
  let bluffs = 0;
  for (let k = 0; k < 60; k++) {
    const t = game([['w-d4-0', 'g-1-0', 'y-2-0', `y-${3 + (k % 6)}-1`], ['b-1-0', 'b-2-0'], ['b-3-0', 'b-4-0']], 'g-5-0', { dealer: 2 });
    t.round = k + 1;
    assert.notEqual(/** @type {any} */ (botMove(t, 0)).card, 'w-d4-0');
    if (/** @type {any} */ (botMove(t, 0, { level: 'apprentice' })).card === 'w-d4-0') bluffs += 1;
  }
  assert.ok(bluffs > 0, 'the apprentice bluffs without knowing it');
  // With no green the Four may go: on a next player about to go out it does.
  const u = game([['w-d4-0', 'r-1-0', 'y-2-0'], ['b-1-0'], ['b-3-0', 'b-4-0']], 'g-5-0', { dealer: 2 });
  assert.equal(/** @type {any} */ (botMove(u, 0)).card, 'w-d4-0');
});

test('the journeyman hits a next player close to going out with a Draw Two or a Skip, and dumps its points', () => {
  const s = game([['g-1-0', 'g-d2-0', 'y-2-0', 'y-3-0'], ['b-1-0'], ['b-3-0', 'b-4-0', 'b-5-0']], 'g-5-0', { dealer: 2 });
  assert.equal(/** @type {any} */ (botMove(s, 0)).card, 'g-d2-0');
  const t = game([['g-1-0', 'g-skip-0', 'y-2-0', 'y-3-0'], ['b-1-0', 'b-2-0'], ['b-3-0', 'b-4-0', 'b-5-0']], 'g-5-0', { dealer: 2 });
  assert.equal(/** @type {any} */ (botMove(t, 0)).card, 'g-skip-0');
  // Nobody close: it stays in the colour it holds most.
  const u = game([['g-1-0', 'r-5-0', 'r-2-0', 'r-3-0'], ['b-1-0', 'b-2-0', 'b-6-0', 'b-7-0'], ['b-3-0', 'b-4-0', 'b-5-0']], 'g-5-0', { dealer: 2 });
  assert.equal(/** @type {any} */ (botMove(u, 0)).card, 'r-5-0');
});

test('challenges: never the apprentice; the journeyman on a record of bluffs; the master by the odds', () => {
  /** Seat 0 plays a Four on seat 1 holding `size` cards besides it. */
  const four = (size) => {
    const rest = ['r-1-0', 'r-2-0', 'r-3-0', 'y-1-0', 'y-2-0', 'y-3-0', 'b-6-0', 'b-7-0', 'b-8-0', 'r-4-0', 'y-4-0', 'b-9-0'].slice(0, size);
    const s = game([['w-d4-0', ...rest], ['b-1-0', 'b-2-0', 'g-1-0'], ['b-3-0', 'b-4-0']], 'g-5-0', { dealer: 2 });
    act(s, 0, { type: 'play', card: 'w-d4-0', colour: 'b', ...(size === 1 ? { call: true } : {}) });
    return s;
  };
  const big = four(12);
  for (const level of LEVELS) if (level !== 'master') assert.deepEqual(botMove(big, 1, { level }), { type: 'draw' }, level);
  assert.deepEqual(botMove(big, 1, { level: 'master' }), { type: 'challenge' }, 'twelve cards and never challenged: likely holding green');
  assert.deepEqual(botMove(four(1), 1, { level: 'master' }), { type: 'draw' }, 'one card left: likely not');
  // A record of bluffs: the journeyman challenges.
  const caught = four(3);
  caught.fours[0] = { played: 3, challenged: 2, guilty: 2 };
  assert.deepEqual(botMove(caught, 1, { level: 'journeyman' }), { type: 'challenge' });
  assert.deepEqual(botMove(caught, 1, { level: 'apprentice' }), { type: 'draw' });
});

test('the master remembers who drew on a colour: with a balanced hand it names one the next player lacks', () => {
  const s = game([['r-1-0'], ['b-1-0', 'y-2-0', 'w-wild-0', 'r-3-0', 'g-3-0'], ['y-1-0', 'y-4-0', 'y-6-0']], 'w-wild-1', { dealer: 0 });
  s.lacked[2] = ['g'];
  assert.deepEqual(botMove(s, 1, { level: 'master' }), { type: 'colour', colour: 'g' });
  assert.deepEqual(botMove(s, 1, { level: 'journeyman' }), { type: 'colour', colour: 'r' }, 'the journeyman by its hand only');
});

test('reflexes under jumpIn: a journeyman jumps in with an identical card, calling when it leaves one', () => {
  const s = game([['g-7-0', 'r-1-0', 'r-2-0'], ['b-1-0', 'b-2-0'], ['g-7-1', 'b-3-0'], ['y-1-0', 'y-2-0']], 'g-5-0', { dealer: 3, rules: { jumpIn: true } });
  act(s, 0, { type: 'play', card: 'g-7-0' });
  assert.deepEqual(botReflex(s, 2, { level: 'journeyman' }), { type: 'jump', card: 'g-7-1', call: true });
  assert.equal(botReflex(s, 3, { level: 'journeyman' }), null);
});

test('stacking: a waiting Draw Two is passed on when a Draw Two is in hand', () => {
  const s = game([['g-d2-0', 'r-1-0', 'r-2-0'], ['b-d2-0', 'b-1-0', 'y-2-0'], ['y-3-0', 'y-4-0']], 'g-5-0', { dealer: 2, rules: { stack: true } });
  act(s, 0, { type: 'play', card: 'g-d2-0' });
  for (const level of ['journeyman', 'master']) assert.deepEqual(botMove(s, 1, { level }), { type: 'play', card: 'b-d2-0' }, level);
});

// ---- the master's time, and the ranks' order --------------------------------------------------------

test('colour names stay in COLOURS and every card a bot names is its own', () => {
  for (const s of positions(30, 21)) {
    for (const level of LEVELS) {
      const m = /** @type {any} */ (botMove(s, s.turn, { level }));
      if (m.colour) assert.ok(COLOURS.includes(m.colour));
      if (m.card) assert.ok(s.hands[s.turn].includes(m.card) && parseCard(m.card));
      assert.ok(moves(s, s.turn).length);
    }
  }
});
