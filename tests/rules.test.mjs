// Yksi's rules (server/rules.mjs): the deck, each rule on a fixed deal (every upcard, the two-player
// Reverse, drawing and playing the drawn card, the Wild Draw Four legal, bluffed and challenged both
// ways, the call and its catch, going out on a Draw, the reshuffle, the scoring and the target), each
// house rule, and whole matches by random legal players and by bots, checked after every move.

import { test } from 'node:test';
import {
  COLOURS, PLAYERS, RULES, TARGETS, act, cleanRules, createGame, fits, handPoints, isCard, jumpable, makeDeck, moves,
  nextSeat, parseCard, playable, points, shuffled, sortHand, standings, totals, view,
} from '../server/rules.mjs';
import { assert, checkState, isListed, reflexes, seeded, throws } from './helpers.mjs';

// The master's trials bound by count, not the clock, and few: repeatable, and quick.
process.env.YKSI_MASTER_MS = '100000';
process.env.YKSI_MASTER_PLAYS = '600';
const { botMove, botReflex } = await import('../server/bots.mjs');

const DECK = makeDeck();

/**
 * A fixed deal of all 108 cards: these hands, this upcard, `front` drawn first, then the rest of the
 * deck in box order.
 */
function game(hands, top, { front = [], dealer = 0, rules = {}, randomInt = seeded(1) } = {}) {
  const used = new Set([...hands.flat(), top, ...front]);
  const stock = [...front, ...DECK.filter((id) => !used.has(id))];
  return createGame({ players: hands.length, hands, top, stock, dealer, rules, randomInt });
}
const types = (events) => events.map((e) => e.type);

// ---- the deck ---------------------------------------------------------------------------------------

test('the deck: 108 cards in box order, each once, 1240 points in all', () => {
  assert.equal(DECK.length, 108);
  assert.equal(new Set(DECK).size, 108);
  assert.equal(DECK[0], 'r-0-0');
  assert.equal(DECK.at(-1), 'w-d4-3');
  for (const c of COLOURS) {
    const mine = DECK.filter((id) => parseCard(id).c === c);
    assert.equal(mine.length, 25, c);
    assert.equal(mine.filter((id) => parseCard(id).f === '0').length, 1);
    for (const f of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'rev', 'd2']) assert.equal(mine.filter((id) => parseCard(id).f === f).length, 2, `${c} ${f}`);
  }
  assert.equal(DECK.filter((id) => parseCard(id).f === 'wild').length, 4);
  assert.equal(DECK.filter((id) => parseCard(id).f === 'd4').length, 4);
  assert.equal(handPoints(DECK), 4 * (90 + 6 * 20) + 8 * 50);
  assert.deepEqual([points('g-9-0'), points('r-0-0'), points('b-skip-1'), points('y-rev-0'), points('r-d2-1'), points('w-wild-0'), points('w-d4-2')], [9, 0, 20, 20, 20, 50, 50]);
});

test('card ids: one per physical card; a malformed id is refused', () => {
  assert.deepEqual(parseCard('r-7-1'), { c: 'r', f: '7', k: 1 });
  assert.deepEqual(parseCard('w-d4-3'), { c: 'w', f: 'd4', k: 3 });
  assert.deepEqual(parseCard('b-skip-0'), { c: 'b', f: 'skip', k: 0 });
  for (const bad of ['r-0-1', 'r-7-2', 'w-wild-4', 'r-wild-0', 'w-7-0', 'x-1-0', 'r-10-0', 'r-7', '', null, 7]) {
    assert.equal(isCard(bad), false, String(bad));
    throws(() => parseCard(bad), 'card');
  }
});

test('a hand sorts by colour (red, yellow, green, blue), 0 to 9, Skip, Reverse, Draw Two; the wilds last', () => {
  const hand = ['w-d4-0', 'b-0-0', 'r-d2-1', 'r-skip-0', 'y-3-0', 'r-9-0', 'w-wild-1', 'r-0-0', 'r-rev-1', 'r-9-1'];
  assert.deepEqual(sortHand(hand), ['r-0-0', 'r-9-0', 'r-9-1', 'r-skip-0', 'r-rev-1', 'r-d2-1', 'y-3-0', 'b-0-0', 'w-wild-1', 'w-d4-0']);
  assert.notEqual(sortHand(hand), hand);
});

test('the house rules: the defaults, booleans and the targets; anything else is refused', () => {
  assert.deepEqual(cleanRules(), RULES);
  assert.deepEqual(cleanRules(null), RULES);
  assert.deepEqual(RULES, { stack: false, jumpIn: false, sevenZero: false, drawToPlay: false, target: 500 });
  assert.deepEqual(cleanRules({ stack: true, target: 0, nonsense: 1 }), { ...RULES, stack: true, target: 0 });
  assert.deepEqual(TARGETS, [0, 200, 500]);
  for (const bad of [{ stack: 'yes' }, { target: 300 }, { target: '500' }, [], 'x']) throws(() => cleanRules(/** @type {any} */ (bad)), 'rules');
  assert.ok(Object.isFrozen(cleanRules({ jumpIn: true })));
});

// ---- the deal and the upcard ------------------------------------------------------------------------

test('the deal: seven each, one at a time from the dealer’s left; the next card turns up; the rest is the stock', () => {
  for (const players of [2, 3, 10]) {
    const s = createGame({ players, dealer: 1, randomInt: seeded(4 + players) });
    const deck = shuffled(makeDeck(), seeded(4 + players));
    for (let i = 0; i < players * 7; i++) assert.ok(s.hands[nextSeat(1, players, 1 + (i % players))].includes(deck[i]));
    assert.ok(s.hands.every((h) => h.length === 7));
    assert.equal(s.pile.length, 1);
    assert.equal(s.stock.length, 108 - players * 7 - 1);
    assert.equal(s.round, 1);
    assert.deepEqual(s.totals, Array(players).fill(0));
    checkState(s);
  }
  throws(() => createGame({ players: 1, randomInt: seeded(1) }), 'players');
  throws(() => createGame({ players: PLAYERS.max + 1, randomInt: seeded(1) }), 'players');
  throws(() => createGame({ players: 3, dealer: 3, randomInt: seeded(1) }), 'players');
  throws(() => game([['r-1-0'], ['r-1-0']], 'g-5-0'), 'deal');
});

test('a number upcard: its colour is in play, the dealer’s left plays first, clockwise', () => {
  const s = game([['r-1-0'], ['y-1-0'], ['b-1-0']], 'g-5-0', { dealer: 2 });
  assert.equal(s.colour, 'g');
  assert.equal(s.turn, 0);
  assert.equal(s.dir, 1);
  assert.deepEqual(s.opening, [{ type: 'upcard', card: 'g-5-0' }]);
});

test('a Skip upcard: the first player is skipped', () => {
  const s = game([['r-1-0'], ['y-1-0'], ['b-1-0']], 'g-skip-0', { dealer: 0 });
  assert.equal(s.turn, 2);
  assert.deepEqual(s.opening.at(-1), { type: 'skip', seat: 1 });
});

test('a Reverse upcard: play goes the other way and the dealer starts; with two the dealer starts too', () => {
  const s = game([['g-1-0'], ['y-1-0'], ['b-1-0'], ['r-1-0', 'g-2-0']], 'g-rev-0', { dealer: 3 });
  assert.equal(s.dir, -1);
  assert.equal(s.turn, 3);
  act(s, 3, { type: 'play', card: 'g-2-0', call: true });
  assert.equal(s.turn, 2, 'then to the dealer’s right');

  const two = game([['g-1-0', 'g-3-0'], ['y-1-0', 'g-2-0']], 'g-rev-0', { dealer: 1 });
  assert.equal(two.turn, 1);
  act(two, 1, { type: 'play', card: 'g-2-0', call: true });
  assert.equal(two.turn, 0);
});

test('a Draw Two upcard: the first player draws two and misses the turn', () => {
  const s = game([['r-1-0'], ['y-1-0'], ['b-1-0']], 'g-d2-0', { dealer: 0, front: ['r-3-0', 'r-4-0'] });
  assert.deepEqual(s.hands[1], ['y-1-0', 'r-3-0', 'r-4-0']);
  assert.equal(s.turn, 2);
  assert.deepEqual(types(s.opening), ['upcard', 'draw', 'skip']);
  assert.deepEqual(s.opening[1], { type: 'draw', seat: 1, count: 2, penalty: true });
});

test('a Wild upcard: the first player names the colour, then plays their turn', () => {
  const s = game([['r-1-0'], ['b-1-0', 'y-2-0'], ['y-1-0']], 'w-wild-0', { dealer: 0 });
  assert.equal(s.colour, null);
  assert.equal(s.turn, 1);
  assert.deepEqual(moves(s, 1), COLOURS.map((colour) => ({ type: 'colour', colour })));
  assert.deepEqual(playable(s, 1), []);
  throws(() => act(s, 1, { type: 'play', card: 'b-1-0' }), 'colour');
  throws(() => act(s, 1, { type: 'draw' }), 'colour');
  throws(() => act(s, 2, { type: 'colour', colour: 'b' }), 'turn');
  throws(() => act(s, 1, { type: 'colour', colour: 'w' }), 'colour');
  assert.deepEqual(act(s, 1, { type: 'colour', colour: 'b' }), [{ type: 'colour', seat: 1, colour: 'b' }]);
  assert.equal(s.turn, 1);
  throws(() => act(s, 1, { type: 'colour', colour: 'y' }), 'colour');
  throws(() => act(s, 1, { type: 'play', card: 'y-2-0' }), 'fits');
  act(s, 1, { type: 'play', card: 'b-1-0', call: true });
  assert.equal(s.turn, 2);
});

test('a Wild Draw Four upcard goes back into the stock, which is shuffled, and another turns up', () => {
  const s = game([['r-1-0'], ['y-1-0']], 'w-d4-0', { front: ['w-d4-1', 'r-3-0'], randomInt: seeded(9) });
  assert.notEqual(parseCard(s.pile[0]).f, 'd4');
  assert.equal(s.pile.length, 1);
  assert.deepEqual(s.opening[0], { type: 'upcard', card: 'w-d4-0', back: true });
  assert.ok(s.stock.includes('w-d4-0'));
  checkState(s);
  throws(() => createGame({ players: 2, hands: [['r-1-0'], ['r-2-0']], top: 'w-d4-0', stock: ['w-d4-1'], randomInt: seeded(1) }), 'deal');
});

// ---- a turn -----------------------------------------------------------------------------------------

test('a card goes on by colour, number or symbol; a Wild on anything, naming a colour', () => {
  const s = game([['g-2-0', 'r-5-0', 'b-7-0', 'w-wild-0', 'b-skip-0', 'w-d4-0'], ['y-skip-1', 'r-4-0'], ['y-1-0', 'y-2-0']], 'g-5-0', { dealer: 2 });
  assert.deepEqual(playable(s, 0), ['r-5-0', 'g-2-0', 'w-wild-0', 'w-d4-0']);
  assert.deepEqual(playable(s, 1), [], 'not their turn');
  throws(() => act(s, 0, { type: 'play', card: 'b-7-0' }), 'fits');
  throws(() => act(s, 0, { type: 'play', card: 'y-1-0' }), 'card');
  throws(() => act(s, 1, { type: 'play', card: 'y-skip-1' }), 'turn');
  throws(() => act(s, 0, { type: 'play', card: 'w-wild-0' }), 'colour');
  throws(() => act(s, 0, { type: 'fly' }), 'move');
  assert.deepEqual(act(s, 0, { type: 'play', card: 'w-wild-0', colour: 'y' }), [{ type: 'play', seat: 0, card: 'w-wild-0', colour: 'y' }]);
  assert.equal(s.colour, 'y');
  act(s, 1, { type: 'play', card: 'y-skip-1', call: true });
  assert.equal(s.turn, 0, 'seat 2 skipped');
  // A Skip on a Skip, whatever its colour.
  assert.ok(fits(s, 'b-skip-0'));
  act(s, 0, { type: 'play', card: 'b-skip-0' });
  assert.equal(s.colour, 'b');
});

test('drawing: one card; one that fits may go straight on (only that one) or be kept; one that doesn’t ends the turn', () => {
  const s = game([['g-1-0', 'r-2-0'], ['r-3-0', 'r-4-0'], ['b-1-0', 'b-2-0']], 'g-5-0', { dealer: 2, front: ['g-9-0', 'b-3-0', 'r-5-1'] });
  // Drawing is allowed with a card that fits in hand.
  assert.ok(playable(s, 0).includes('g-1-0'));
  assert.deepEqual(act(s, 0, { type: 'draw' }), [{ type: 'draw', seat: 0, count: 1 }]);
  assert.equal(s.drawn, 'g-9-0');
  assert.equal(s.turn, 0);
  assert.equal(view(s, 0).drawn, 'g-9-0');
  assert.equal(view(s, 1).drawn, null);
  assert.equal(view(s, 1).choosing, true);
  assert.deepEqual(moves(s, 0), [{ type: 'play', card: 'g-9-0' }, { type: 'pass' }]);
  throws(() => act(s, 0, { type: 'play', card: 'g-1-0' }), 'drawn');
  throws(() => act(s, 0, { type: 'draw' }), 'drawn');
  assert.deepEqual(act(s, 0, { type: 'pass' }), [{ type: 'pass', seat: 0 }]);
  assert.equal(s.turn, 1);
  assert.equal(s.hands[0].length, 3);
  throws(() => act(s, 1, { type: 'pass' }), 'pass');
  // Seat 1 draws a card that doesn't fit: the turn is over.
  act(s, 1, { type: 'draw' });
  assert.equal(s.drawn, null);
  assert.equal(s.turn, 2);
  assert.deepEqual(s.lacked[1], ['g'], 'public: seat 1 drew on green');
  // Seat 2 draws one that fits by number and plays it.
  act(s, 2, { type: 'draw' });
  assert.equal(s.drawn, 'r-5-1');
  act(s, 2, { type: 'play', card: 'r-5-1' });
  assert.equal(s.colour, 'r');
  assert.equal(s.turn, 0);
});

test('Skip and Reverse; with two players a Reverse acts as a Skip', () => {
  const s = game([['g-skip-0', 'r-1-0'], ['g-3-0', 'r-2-0'], ['g-rev-0', 'r-3-0'], ['r-4-0', 'r-5-0']], 'g-5-0', { dealer: 3 });
  assert.deepEqual(act(s, 0, { type: 'play', card: 'g-skip-0', call: true }), [
    { type: 'play', seat: 0, card: 'g-skip-0' }, { type: 'call', seat: 0 }, { type: 'skip', seat: 1 },
  ]);
  assert.equal(s.turn, 2);
  assert.deepEqual(act(s, 2, { type: 'play', card: 'g-rev-0', call: true }).at(-1), { type: 'reverse', dir: -1 });
  assert.equal(s.turn, 1);
  act(s, 1, { type: 'play', card: 'g-3-0', call: true });
  assert.equal(s.turn, 0);

  const two = game([['g-rev-0', 'g-skip-1', 'g-2-0', 'r-1-0'], ['b-1-0', 'b-2-0']], 'g-5-0', { dealer: 1 });
  assert.deepEqual(types(act(two, 0, { type: 'play', card: 'g-rev-0' })), ['play', 'reverse', 'skip']);
  assert.equal(two.turn, 0);
  act(two, 0, { type: 'play', card: 'g-skip-1' });
  assert.equal(two.turn, 0);
  act(two, 0, { type: 'play', card: 'g-2-0', call: true });
  assert.equal(two.turn, 1);
});

test('Draw Two: the next player draws two and misses the turn; no stacking by default', () => {
  const s = game([['g-d2-0', 'r-1-0', 'r-2-0'], ['b-d2-1', 'y-1-0'], ['b-d2-0', 'y-2-0', 'y-3-0']], 'g-5-0', { dealer: 2, front: ['y-4-0', 'y-5-0', 'y-6-0', 'y-7-0'] });
  assert.deepEqual(act(s, 0, { type: 'play', card: 'g-d2-0' }), [
    { type: 'play', seat: 0, card: 'g-d2-0' }, { type: 'draw', seat: 1, count: 2, penalty: true }, { type: 'skip', seat: 1 },
  ]);
  assert.deepEqual(s.hands[1], ['b-d2-1', 'y-1-0', 'y-4-0', 'y-5-0'], 'their Draw Two can’t pass it on');
  assert.equal(s.pending, null);
  assert.equal(s.turn, 2);
  act(s, 2, { type: 'play', card: 'b-d2-0' });
  assert.equal(s.hands[0].length, 4);
  assert.equal(s.turn, 1);
});

test('Wild Draw Four, played as it may be: the next draws four and misses the turn', () => {
  const s = game([['w-d4-0', 'r-1-0', 'y-2-0'], ['b-1-0', 'b-2-0'], ['b-3-0', 'b-4-0']], 'g-5-0', { dealer: 2 });
  assert.deepEqual(act(s, 0, { type: 'play', card: 'w-d4-0', colour: 'b' }), [{ type: 'play', seat: 0, card: 'w-d4-0', colour: 'b' }]);
  assert.deepEqual(s.pending, { kind: 'd4', count: 4, seat: 0, victim: 1, before: 'g', guilty: false });
  assert.equal(s.turn, 1);
  assert.equal(s.colour, 'b');
  for (const seat of [null, 0, 1, 2]) assert.deepEqual(view(s, seat).pending, { kind: 'd4', count: 4, seat: 0, victim: 1, before: 'g' });
  assert.deepEqual(moves(s, 1), [{ type: 'draw' }, { type: 'challenge' }]);
  throws(() => act(s, 1, { type: 'play', card: 'b-1-0' }), 'fits');
  throws(() => act(s, 2, { type: 'challenge' }), 'turn');
  assert.deepEqual(act(s, 1, { type: 'draw' }), [{ type: 'draw', seat: 1, count: 4, penalty: true }]);
  assert.equal(s.hands[1].length, 6);
  assert.equal(s.turn, 2);
  assert.equal(s.pending, null);
  throws(() => act(s, 2, { type: 'challenge' }), 'challenge');
});

test('a challenged Four that was played as it may be: the challenger draws six and misses the turn; the colour stands', () => {
  const s = game([['w-d4-0', 'r-1-0', 'y-2-0'], ['b-1-0', 'b-2-0'], ['b-3-0', 'b-4-0']], 'g-5-0', { dealer: 2 });
  act(s, 0, { type: 'play', card: 'w-d4-0', colour: 'b' });
  assert.deepEqual(act(s, 1, { type: 'challenge' }), [
    { type: 'challenge', seat: 1, against: 0, guilty: false }, { type: 'draw', seat: 1, count: 6, penalty: true },
  ]);
  assert.equal(s.hands[1].length, 8);
  assert.equal(s.turn, 2);
  assert.equal(s.colour, 'b');
  assert.deepEqual(s.fours[0], { played: 1, challenged: 1, guilty: 0 });
});

test('a challenged bluff: its player draws four, and the challenger plays their turn on the colour named', () => {
  const s = game([['w-d4-0', 'g-1-0', 'y-2-0'], ['b-1-0', 'b-2-0'], ['b-3-0', 'b-4-0']], 'g-5-0', { dealer: 2 });
  act(s, 0, { type: 'play', card: 'w-d4-0', colour: 'b' });
  assert.equal(s.pending?.guilty, true);
  assert.deepEqual(act(s, 1, { type: 'challenge' }), [
    { type: 'challenge', seat: 1, against: 0, guilty: true }, { type: 'draw', seat: 0, count: 4, penalty: true },
  ]);
  assert.equal(s.hands[0].length, 6);
  assert.equal(s.hands[1].length, 2);
  assert.equal(s.turn, 1);
  assert.equal(s.colour, 'b');
  assert.deepEqual(playable(s, 1), ['b-1-0', 'b-2-0']);
  assert.deepEqual(s.fours[0], { played: 1, challenged: 1, guilty: 1 });
  // An unchallenged bluff costs nothing.
  const t = game([['w-d4-0', 'g-1-0', 'y-2-0'], ['b-1-0', 'b-2-0'], ['b-3-0', 'b-4-0']], 'g-5-0', { dealer: 2 });
  act(t, 0, { type: 'play', card: 'w-d4-0', colour: 'b' });
  act(t, 1, { type: 'draw' });
  assert.deepEqual([t.hands[0].length, t.hands[1].length], [2, 6]);
});

test('a Four is a bluff only with the colour in play: the same number in another colour, or a wild, doesn’t count', () => {
  const s = game([['w-d4-0', 'r-5-1', 'w-wild-0', 'b-skip-0'], ['b-1-0', 'b-2-0'], ['b-3-0', 'b-4-0']], 'g-5-0', { dealer: 2 });
  act(s, 0, { type: 'play', card: 'w-d4-0', colour: 'r' });
  assert.equal(s.pending?.guilty, false);
  assert.equal(act(s, 1, { type: 'challenge' })[0].guilty, false);
});

test('the challenged hand is shown to the challenger only, until the next move', () => {
  const s = game([['w-d4-0', 'g-1-0', 'y-2-0'], ['b-1-0', 'b-2-0', 'b-5-0'], ['b-3-0', 'b-4-0']], 'g-5-0', { dealer: 2 });
  act(s, 0, { type: 'play', card: 'w-d4-0', colour: 'b' });
  const events = act(s, 1, { type: 'challenge' });
  assert.ok(!JSON.stringify(events).includes('g-1-0'), 'never in the events');
  assert.deepEqual(view(s, 1).peek, { from: 0, hand: ['y-2-0', 'g-1-0'] });
  for (const seat of [null, 0, 2]) assert.equal(view(s, seat).peek, null);
  checkState(s);
  act(s, 1, { type: 'play', card: 'b-1-0' });
  assert.equal(view(s, 1).peek, null);
});

// ---- the call ---------------------------------------------------------------------------------------

/** Seat 0 to play its second-to-last card, at a table of three. */
const callTable = () => game([['g-1-0', 'g-2-0'], ['r-7-0', 'g-3-0'], ['y-1-0', 'y-2-0']], 'g-5-0', { dealer: 2, front: ['b-1-0', 'b-2-0', 'b-3-0'] });

test('the call: "Yksi!" with the second-to-last card, or open until the next player moves; a catch costs two', () => {
  const s = callTable();
  assert.deepEqual(moves(s, 0).filter((m) => m.card === 'g-1-0'), [{ type: 'play', card: 'g-1-0', call: true }, { type: 'play', card: 'g-1-0' }]);
  assert.deepEqual(act(s, 0, { type: 'play', card: 'g-1-0', call: true }), [{ type: 'play', seat: 0, card: 'g-1-0' }, { type: 'call', seat: 0 }]);
  assert.equal(s.open, null);
  throws(() => act(s, 2, { type: 'catch' }), 'catch');

  const t = callTable();
  act(t, 0, { type: 'play', card: 'g-1-0' });
  assert.equal(t.open, 0);
  assert.equal(view(t, 2).open, 0);
  assert.deepEqual(moves(t, 2), [{ type: 'catch' }]);
  assert.deepEqual(moves(t, 0), [{ type: 'call' }]);
  assert.deepEqual(moves(t, 1)[0], { type: 'catch' }, 'the next player may catch too');
  assert.deepEqual(act(t, 2, { type: 'catch' }), [{ type: 'catch', seat: 0, by: 2 }, { type: 'draw', seat: 0, count: 2, penalty: true }]);
  assert.equal(t.open, null);
  assert.equal(t.hands[0].length, 3);
  assert.equal(t.turn, 1, 'a catch is out of turn: the turn stays');
});

test('a late call is safe; a catch by the open seat itself, or once the next player has moved, is refused', () => {
  const s = callTable();
  act(s, 0, { type: 'play', card: 'g-1-0' });
  throws(() => act(s, 0, { type: 'catch' }), 'catch');
  throws(() => act(s, 1, { type: 'call' }), 'call');
  assert.deepEqual(act(s, 0, { type: 'call' }), [{ type: 'call', seat: 0 }]);
  throws(() => act(s, 1, { type: 'catch' }), 'catch');

  const t = callTable();
  act(t, 0, { type: 'play', card: 'g-1-0' });
  act(t, 1, { type: 'play', card: 'g-3-0', call: true });
  assert.equal(t.open, null);
  throws(() => act(t, 2, { type: 'catch' }), 'catch');
  throws(() => act(t, 0, { type: 'call' }), 'call');

  // The next player's draw is a move too.
  const u = callTable();
  act(u, 0, { type: 'play', card: 'g-1-0' });
  act(u, 1, { type: 'draw' });
  throws(() => act(u, 2, { type: 'catch' }), 'catch');
});

test('drawing back above one card ends being open', () => {
  const s = game([['g-skip-0', 'r-1-0'], ['b-1-0', 'b-2-0']], 'g-5-0', { dealer: 1, front: ['b-4-0'] });
  act(s, 0, { type: 'play', card: 'g-skip-0' });
  assert.equal(s.open, 0);
  assert.equal(s.turn, 0, 'two players: the Skip comes back');
  act(s, 0, { type: 'draw' });
  assert.equal(s.open, null);
  throws(() => act(s, 1, { type: 'catch' }), 'catch');
});

// ---- the round's end --------------------------------------------------------------------------------

test('going out wins the round: the winner scores every other hand; then any seat deals the next round', () => {
  const s = game([['g-1-0'], ['r-9-0', 'w-wild-0'], ['b-skip-0', 'y-3-0']], 'g-5-0', { dealer: 2 });
  assert.deepEqual(act(s, 0, { type: 'play', card: 'g-1-0' }), [
    { type: 'play', seat: 0, card: 'g-1-0' }, { type: 'out', seat: 0 }, { type: 'scored', winner: 0, points: 82 },
  ]);
  assert.equal(s.phase, 'scored');
  assert.equal(s.winner, 0);
  assert.deepEqual(s.totals, [82, 0, 0]);
  assert.deepEqual(totals(s), [82, 0, 0]);
  assert.deepEqual(s.history, [{ round: 1, winner: 0, points: [82, 0, 0] }]);
  assert.deepEqual(view(s, 1).result, { round: 1, winner: 0, points: [82, 0, 0], hands: [[], ['r-9-0', 'w-wild-0'], ['y-3-0', 'b-skip-0']], blocked: false });
  assert.deepEqual(view(s, null).hands, [[], ['r-9-0', 'w-wild-0'], ['y-3-0', 'b-skip-0']]);
  for (const seat of [0, 1, 2]) assert.deepEqual(moves(s, seat), [{ type: 'next' }]);
  throws(() => act(s, 1, { type: 'draw' }), 'phase');
  const events = act(s, 1, { type: 'next' }, { randomInt: seeded(3) });
  assert.deepEqual(events[0], { type: 'deal', round: 2, dealer: 0 });
  assert.equal(events[1].type, 'upcard');
  assert.equal(s.round, 2);
  assert.equal(s.dealer, 0);
  assert.equal(s.phase, 'play');
  assert.ok(s.hands.every((h) => h.length >= 7));
  assert.equal(view(s, 1).hands, null);
  assert.deepEqual(s.totals, [82, 0, 0], 'the totals stay');
  checkState(s);
  throws(() => act(s, 1, { type: 'next' }, { randomInt: seeded(3) }), 'phase');
});

test('going out on a Draw Two or a Wild Draw Four: the next still draws (no challenge), and those cards count', () => {
  const s = game([['g-d2-0'], ['r-9-0'], ['b-1-0']], 'g-5-0', { dealer: 2, front: ['y-5-0', 'y-6-0'] });
  assert.deepEqual(act(s, 0, { type: 'play', card: 'g-d2-0' }), [
    { type: 'play', seat: 0, card: 'g-d2-0' }, { type: 'out', seat: 0 }, { type: 'draw', seat: 1, count: 2, penalty: true },
    { type: 'scored', winner: 0, points: 21 },
  ]);
  const t = game([['w-d4-0'], ['r-9-0'], ['b-1-0']], 'g-5-0', { dealer: 2, front: ['y-5-0', 'y-6-0', 'y-7-0', 'y-8-0'] });
  const events = act(t, 0, { type: 'play', card: 'w-d4-0' });
  assert.deepEqual(events.at(-2), { type: 'draw', seat: 1, count: 4, penalty: true });
  assert.deepEqual(events.at(-1), { type: 'scored', winner: 0, points: 9 + 5 + 6 + 7 + 8 + 1 });
  assert.equal(t.pending, null);
  // A wild as the last card names no colour.
  assert.deepEqual(moves(game([['w-wild-0'], ['r-9-0']], 'g-5-0', { dealer: 1 }), 0), [{ type: 'play', card: 'w-wild-0' }, { type: 'draw' }]);
});

test('the stock runs out: the pile under its top card is shuffled into a new stock', () => {
  const s = createGame({ players: 2, dealer: 1, hands: [['g-1-0', 'g-2-0', 'r-3-0'], ['g-6-0', 'b-4-0', 'b-7-0']], top: 'g-5-0', stock: ['y-8-0'], randomInt: seeded(2) });
  act(s, 0, { type: 'play', card: 'g-1-0' });
  act(s, 1, { type: 'draw' });
  assert.equal(s.stock.length, 0);
  act(s, 0, { type: 'play', card: 'g-2-0', call: true });
  const events = act(s, 1, { type: 'draw' }, { randomInt: seeded(2) });
  assert.deepEqual(events, [{ type: 'reshuffle', count: 2 }, { type: 'draw', seat: 1, count: 1 }]);
  assert.deepEqual(s.pile, ['g-2-0'], 'the top card stays');
  assert.equal(s.stock.length, 1);
  assert.ok(['g-5-0', 'g-1-0'].includes(/** @type {string} */ (s.drawn)));
});

test('stock and pile both empty: a draw gets nothing; once everyone in turn has drawn nothing the round ends, fewest cards winning', () => {
  const s = createGame({ players: 2, dealer: 1, hands: [['r-1-0', 'r-2-0'], ['b-1-0']], top: 'g-5-0', stock: [] });
  assert.deepEqual(act(s, 0, { type: 'draw' }), [{ type: 'draw', seat: 0, count: 0 }]);
  assert.equal(s.turn, 1);
  assert.deepEqual(act(s, 1, { type: 'draw' }), [
    { type: 'draw', seat: 1, count: 0 }, { type: 'blocked', seat: 1 }, { type: 'scored', winner: 1, points: 3 },
  ]);
  assert.equal(s.phase, 'scored');
  assert.deepEqual(s.history, [{ round: 1, winner: 1, points: [0, 3], blocked: true }]);

  // Players who never play can't keep a round going: it ends on its own.
  const t = createGame({ players: 3, hands: [['r-1-0', 'r-2-0'], ['b-1-0', 'b-2-0'], ['y-1-0']], top: 'g-5-0', stock: ['r-3-0', 'b-3-0'], randomInt: seeded(1) });
  let k = 0;
  while (t.phase === 'play') {
    assert.ok(k++ < 50, 'the round ends');
    act(t, t.turn, t.drawn ? { type: 'pass' } : { type: 'draw' }, { randomInt: seeded(k) });
  }
  assert.equal(t.winner, 2);
});

test('the match: rounds until a total reaches the target, the dealer one seat on each round; target 0 is one round', () => {
  const s = game([['g-1-0'], ['w-wild-0', 'w-wild-1', 'w-d4-0', 'w-d4-1']], 'g-5-0', { dealer: 1, rules: { target: 200 } });
  const events = act(s, 0, { type: 'play', card: 'g-1-0' });
  assert.deepEqual(events.slice(-2), [{ type: 'scored', winner: 0, points: 200 }, { type: 'done', winner: 0 }]);
  assert.equal(s.phase, 'done');
  assert.deepEqual(moves(s, 0), []);
  throws(() => act(s, 0, { type: 'next' }, { randomInt: seeded(1) }), 'phase');
  assert.deepEqual(view(s, 1).hands, [[], ['w-wild-0', 'w-wild-1', 'w-d4-0', 'w-d4-1']]);

  const one = game([['g-1-0'], ['r-1-0']], 'g-5-0', { dealer: 1, rules: { target: 0 } });
  act(one, 0, { type: 'play', card: 'g-1-0' });
  assert.equal(one.phase, 'done');

  const long = game([['g-1-0'], ['r-1-0']], 'g-5-0', { dealer: 1, rules: { target: 200 } });
  act(long, 0, { type: 'play', card: 'g-1-0' });
  assert.equal(long.phase, 'scored');
  act(long, 0, { type: 'next' }, { randomInt: seeded(5) });
  assert.equal(long.dealer, 0);
  assert.equal(long.turn, 1, 'left of the new dealer (a number upcard)');
});

test('standings: by total, equal totals share a place', () => {
  const s = createGame({ players: 4, randomInt: seeded(1) });
  s.totals = [10, 30, 10, 0];
  assert.deepEqual(standings(s), [
    { seat: 1, total: 30, place: 1 }, { seat: 0, total: 10, place: 2 }, { seat: 2, total: 10, place: 2 }, { seat: 3, total: 0, place: 4 },
  ]);
});

// ---- the house rules --------------------------------------------------------------------------------

test('house rule stack: a Draw Two on a Draw Two passes the sum on; whoever can’t takes it all and misses the turn', () => {
  const s = game([['g-d2-0', 'r-1-0', 'r-2-0'], ['b-d2-0', 'y-1-0', 'y-2-0'], ['w-d4-0', 'y-3-0', 'y-4-0']], 'g-5-0', { dealer: 2, rules: { stack: true } });
  act(s, 0, { type: 'play', card: 'g-d2-0' });
  assert.deepEqual(s.pending, { kind: 'd2', count: 2, seat: 0, victim: 1 });
  assert.equal(s.hands[1].length, 3, 'nothing drawn yet');
  assert.deepEqual(moves(s, 1), [{ type: 'play', card: 'b-d2-0' }, { type: 'draw' }]);
  act(s, 1, { type: 'play', card: 'b-d2-0' });
  assert.deepEqual(s.pending, { kind: 'd2', count: 4, seat: 1, victim: 2 });
  assert.equal(s.colour, 'b');
  // A Four doesn't answer a Draw Two (Mattel's Progressive rule: the same kind only).
  throws(() => act(s, 2, { type: 'play', card: 'w-d4-0', colour: 'r' }), 'fits');
  assert.deepEqual(act(s, 2, { type: 'draw' }), [{ type: 'draw', seat: 2, count: 4, penalty: true }]);
  assert.equal(s.turn, 0);
  assert.equal(s.pending, null);
});

test('house rule stack: a Four on a Four; a challenge takes on the whole stack', () => {
  const deal = (second) => game([['w-d4-0', 'r-1-0', 'r-2-0'], ['w-d4-1', ...second], ['b-3-0', 'b-4-0']], 'g-5-0', { dealer: 2, rules: { stack: true } });
  const s = deal(['b-1-0', 'b-2-0']);
  act(s, 0, { type: 'play', card: 'w-d4-0', colour: 'y' });
  assert.deepEqual(moves(s, 1), [...COLOURS.map((colour) => ({ type: 'play', card: 'w-d4-1', colour })), { type: 'draw' }, { type: 'challenge' }]);
  act(s, 1, { type: 'play', card: 'w-d4-1', colour: 'r' });
  assert.deepEqual(s.pending, { kind: 'd4', count: 8, seat: 1, victim: 2, before: 'y', guilty: false });
  assert.deepEqual(act(s, 2, { type: 'challenge' }).at(-1), { type: 'draw', seat: 2, count: 10, penalty: true });
  assert.equal(s.turn, 0);

  const t = deal(['y-1-0', 'b-2-0']);
  act(t, 0, { type: 'play', card: 'w-d4-0', colour: 'y' });
  act(t, 1, { type: 'play', card: 'w-d4-1', colour: 'r' });
  assert.deepEqual(act(t, 2, { type: 'challenge' }).at(-1), { type: 'draw', seat: 1, count: 8, penalty: true });
  assert.equal(t.turn, 2, 'the challenger plays on');
});

test('house rule jumpIn: a card identical to the top one goes down out of turn, and play goes on from there', () => {
  const s = game([['g-7-0', 'r-1-0', 'r-2-0'], ['b-1-0', 'b-2-0'], ['g-7-1', 'b-3-0', 'b-4-0'], ['r-7-0', 'y-1-0']], 'g-5-0', { dealer: 3, rules: { jumpIn: true } });
  act(s, 0, { type: 'play', card: 'g-7-0' });
  assert.deepEqual(jumpable(s, 2), ['g-7-1']);
  assert.deepEqual(jumpable(s, 3), [], 'the same number in another colour isn’t identical');
  assert.deepEqual(jumpable(s, 1), [], 'on its own turn a seat simply plays');
  assert.deepEqual(view(s, 2).jumpable, ['g-7-1']);
  assert.deepEqual(moves(s, 2), [{ type: 'jump', card: 'g-7-1' }]);
  throws(() => act(s, 3, { type: 'jump', card: 'r-7-0' }), 'jump');
  throws(() => act(s, 1, { type: 'jump', card: 'b-1-0' }), 'jump');
  assert.deepEqual(act(s, 2, { type: 'jump', card: 'g-7-1' }), [{ type: 'play', seat: 2, card: 'g-7-1', jump: true }]);
  assert.equal(s.turn, 3, 'seat 1 is passed over');

  // An identical Skip: its action applies from the jumper.
  const t = game([['g-skip-0', 'r-1-0', 'r-2-0'], ['g-skip-1', 'b-1-0', 'b-2-0'], ['b-3-0', 'b-4-0'], ['y-2-0', 'y-1-0']], 'g-5-0', { dealer: 3, rules: { jumpIn: true } });
  act(t, 0, { type: 'play', card: 'g-skip-0' });
  assert.equal(t.turn, 2, 'seat 1 skipped');
  assert.deepEqual(types(act(t, 1, { type: 'jump', card: 'g-skip-1' })), ['play', 'skip']);
  assert.equal(t.turn, 3, 'seat 2 skipped by the jumper’s Skip');
  // No jump with a wild, nor without the rule.
  const u = game([['w-wild-0', 'r-1-0'], ['w-wild-1', 'b-2-0'], ['b-3-0', 'b-4-0']], 'g-5-0', { dealer: 2, rules: { jumpIn: true } });
  act(u, 0, { type: 'play', card: 'w-wild-0', colour: 'b', call: true });
  assert.deepEqual(jumpable(u, 2), []);
  const plain = game([['g-7-0', 'r-1-0', 'r-2-0'], ['b-1-0', 'b-2-0'], ['g-7-1', 'b-3-0']], 'g-5-0', { dealer: 2 });
  act(plain, 0, { type: 'play', card: 'g-7-0' });
  throws(() => act(plain, 2, { type: 'jump', card: 'g-7-1' }), 'jump');
});

test('house rule jumpIn: a jump while the turn’s player chooses on a drawn card, and with the second-to-last card', () => {
  const s = game([['g-7-0', 'r-1-0', 'r-2-0'], ['b-1-0', 'b-2-0'], ['g-7-1', 'b-3-0']], 'g-5-0', { dealer: 2, rules: { jumpIn: true }, front: ['g-9-0'] });
  act(s, 0, { type: 'play', card: 'g-7-0' });
  act(s, 1, { type: 'draw' });
  assert.equal(s.drawn, 'g-9-0');
  act(s, 2, { type: 'jump', card: 'g-7-1' });
  assert.equal(s.drawn, null);
  assert.ok(s.hands[1].includes('g-9-0'), 'the drawn card stays in hand');
  assert.equal(s.open, 2, 'no call: open');
  assert.equal(s.turn, 0);
});

test('house rule sevenZero: a 7 swaps hands with a player of your choice; a 0 passes every hand on', () => {
  const s = game([['g-7-0', 'r-1-0', 'r-2-0'], ['b-1-0'], ['y-1-0', 'y-2-0', 'y-3-0', 'y-4-0']], 'g-5-0', { dealer: 2, rules: { sevenZero: true } });
  assert.deepEqual(moves(s, 0).filter((m) => m.card === 'g-7-0'), [{ type: 'play', card: 'g-7-0', swap: 1 }, { type: 'play', card: 'g-7-0', swap: 2 }]);
  throws(() => act(s, 0, { type: 'play', card: 'g-7-0' }), 'swap');
  throws(() => act(s, 0, { type: 'play', card: 'g-7-0', swap: 0 }), 'swap');
  assert.deepEqual(act(s, 0, { type: 'play', card: 'g-7-0', swap: 1 }).at(-1), { type: 'swap', seat: 0, with: 1 });
  assert.deepEqual(s.hands[0], ['b-1-0']);
  assert.deepEqual(s.hands[1], ['r-1-0', 'r-2-0']);
  assert.equal(s.open, null, 'they didn’t play down to one card');
  assert.equal(s.turn, 1);
  checkState(s);

  const t = game([['g-0-0', 'r-1-0', 'r-2-0'], ['b-1-0'], ['y-1-0', 'y-2-0', 'y-3-0', 'y-4-0']], 'g-5-0', { dealer: 2, rules: { sevenZero: true } });
  assert.deepEqual(act(t, 0, { type: 'play', card: 'g-0-0' }).at(-1), { type: 'rotate', dir: 1 });
  assert.deepEqual(t.hands, [['y-1-0', 'y-2-0', 'y-3-0', 'y-4-0'], ['r-1-0', 'r-2-0'], ['b-1-0']]);
  // A 7 as the last card ends the round: nobody to swap with.
  const u = game([['g-7-0'], ['b-1-0']], 'g-5-0', { dealer: 1, rules: { sevenZero: true } });
  assert.deepEqual(moves(u, 0)[0], { type: 'play', card: 'g-7-0' });
  act(u, 0, { type: 'play', card: 'g-7-0' });
  assert.equal(u.phase, 'scored');
});

test('house rule drawToPlay: drawing goes on until a card fits, which may be played or kept', () => {
  const s = game([['r-1-0', 'r-2-0'], ['b-1-0'], ['y-1-0']], 'g-5-0', { dealer: 2, rules: { drawToPlay: true }, front: ['b-2-0', 'y-2-0', 'g-9-0'] });
  assert.deepEqual(act(s, 0, { type: 'draw' }), [{ type: 'draw', seat: 0, count: 3 }]);
  assert.equal(s.drawn, 'g-9-0');
  assert.deepEqual(moves(s, 0), [{ type: 'play', card: 'g-9-0' }, { type: 'pass' }]);
  // With nothing that fits left to draw, the turn ends after the last.
  const t = createGame({ players: 2, dealer: 1, hands: [['r-1-0'], ['b-1-0']], top: 'g-5-0', stock: ['b-2-0', 'y-2-0'], rules: { drawToPlay: true } });
  act(t, 0, { type: 'draw' });
  assert.deepEqual([t.hands[0].length, t.drawn, t.turn], [3, null, 1]);
});

// ---- whole matches ----------------------------------------------------------------------------------

