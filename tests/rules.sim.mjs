// Simulated games for rules: whole matches and positions played out by bots or random players.
// Not in CI (the user, 2026-10-20: "rely on simpler (unit) tests there"); run them with `npm run test:sim`.
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

const RULESETS = [{}, { stack: true }, { jumpIn: true }, { sevenZero: true }, { drawToPlay: true }, { stack: true, jumpIn: true, sevenZero: true, drawToPlay: true }];

test('moves() lists only legal moves, every one of them accepted; anything else is refused', () => {
  const randomInt = seeded(17);
  let tried = 0;
  for (let g = 0; g < 40; g++) {
    const players = 2 + (g % 5);
    const s = createGame({ players, dealer: g % players, rules: { ...RULESETS[g % RULESETS.length], target: 0 }, randomInt });
    for (let step = 0; step < 60 && s.phase === 'play'; step++) {
      for (let seat = 0; seat < players; seat++) {
        const listed = moves(s, seat);
        for (const m of listed) {
          const t = structuredClone(s);
          act(t, seat, m, { randomInt: seeded(step) });
          checkState(t);
          tried += 1;
        }
        // Every card in hand the list doesn't offer is refused.
        for (const card of s.hands[seat]) {
          const type = seat === s.turn ? 'play' : 'jump';
          if (listed.some((m) => m.card === card)) continue;
          assert.throws(() => act(structuredClone(s), seat, { type, card, colour: 'r', swap: (seat + 1) % players }, { randomInt }), (e) => e.name === 'RuleError');
        }
      }
      const all = moves(s, s.turn);
      act(s, s.turn, all[randomInt(all.length)], { randomInt });
    }
  }
  assert.ok(tried > 2000, `${tried}`);
});

/**
 * A random legal player: mostly the seat in turn (any move it has, plays more often than not),
 * now and then another seat's out-of-turn move (a call, a catch, a jump).
 */
function randomStep(s, randomInt) {
  if (s.phase === 'scored') return [randomInt(s.players), { type: 'next' }];
  const others = [...Array(s.players).keys()].filter((seat) => seat !== s.turn && moves(s, seat).length);
  if (others.length && randomInt(3) === 0) {
    const seat = others[randomInt(others.length)];
    const ms = moves(s, seat);
    return [seat, ms[randomInt(ms.length)]];
  }
  const ms = moves(s, s.turn);
  const plays = ms.filter((m) => m.type === 'play');
  return [s.turn, plays.length && randomInt(4) ? plays[randomInt(plays.length)] : ms[randomInt(ms.length)]];
}

test('whole matches by random legal players: the cards conserved, nothing in two places, no view showing another hand, the totals adding up, no hang', () => {
  let rounds = 0;
  let moved = 0;
  for (let g = 0; g < 54; g++) {
    const randomInt = seeded(1000 + g);
    const players = PLAYERS.min + (g % 9);
    const s = createGame({ players, dealer: g % players, rules: { ...RULESETS[g % RULESETS.length], target: 200 }, randomInt });
    checkState(s);
    let k = 0;
    while (s.phase !== 'done') {
      assert.ok(k++ < 30000, 'the match ends');
      const [seat, move] = randomStep(s, randomInt);
      if (move.type === 'next') rounds += 1;
      act(s, seat, move, { randomInt });
      checkState(s);
    }
    moved += k;
    rounds += 1;
    assert.ok(s.totals.some((t) => t >= 200));
    assert.equal(standings(s)[0].seat, s.winner);
  }
  assert.ok(rounds >= 100, `${rounds} rounds`);
  assert.ok(moved > 10000, `${moved} moves`);
});

test('whole matches by bots at every rank: every move listed as legal, the same checks after each, no hang', () => {
  const ranks = ['apprentice', 'journeyman', 'master'];
  let rounds = 0;
  for (let g = 0; g < 18; g++) {
    const randomInt = seeded(500 + g);
    const players = 2 + (g % 5);
    const s = createGame({ players, dealer: g % players, rules: { ...RULESETS[g % RULESETS.length], target: g % 3 ? 200 : 0 }, randomInt });
    const level = (seat) => ranks[(seat + g) % 3];
    let k = 0;
    while (s.phase !== 'done') {
      assert.ok(k++ < 5000, 'the match ends');
      if (s.phase === 'scored') {
        act(s, 0, /** @type {any} */ (botMove(s, 0)), { randomInt });
        rounds += 1;
        continue;
      }
      const seat = s.turn;
      const move = /** @type {any} */ (botMove(s, seat, { level: level(seat) }));
      assert.ok(isListed(s, seat, move), `${level(seat)}: ${JSON.stringify(move)} isn't listed`);
      act(s, seat, move, { randomInt });
      checkState(s);
      reflexes(s, seat, (t, o) => botReflex(t, o, { level: level(o) }), randomInt, checkState);
    }
    rounds += 1;
  }
  assert.ok(rounds >= 30, `${rounds} rounds`);
});
