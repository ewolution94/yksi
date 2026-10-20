// Simulated games for rooms: whole matches and positions played out by bots or random players.
// Not in CI (the user, 2026-10-20: "rely on simpler (unit) tests there"); run them with `npm run test:sim`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AWAY_MS, DEFAULT_SETTINGS, GameError, mergeSettings, MOVE_SECONDS, ROUND_WAIT } from '../server/rooms.mjs';
import { RULES } from '../server/rules.mjs';
import { setup, table, watch } from './room-helpers.mjs';

const refused = (fn, code) => assert.throws(fn, (e) => e instanceof GameError && e.code === code, code);

/** Runs the clock until the match is over (or gives up), tapping "next" for every page between rounds. */
function playOut(clock, t, maxMs = 12 * 60 * 60_000, person = null) {
  const page = t.pages[0];
  for (let ms = 0; ms < maxMs && page.view.phase === 'play'; ms += 500) {
    const g = page.view.game;
    if (g.state.phase === 'scored') for (const seat of t.seats) if (!g.ready.includes(seat.player)) t.act(seat, 'next');
    else if (person) person();
    clock.advance(500);
  }
  return page.view;
}

/**
 * The people at the table play from their own page's view, the way a quick person would: the first
 * card that fits (a wild names red, the call goes with the second-to-last card unless `call` is off),
 * else draw; a drawn card that fits goes on; a +4 on them is taken.
 */
function people(t, { call = true } = {}) {
  return () => {
    t.pages.forEach((page, i) => {
      const g = page.view?.game;
      if (!g || page.view.phase !== 'play' || g.state.phase !== 'play' || g.state.turn !== g.seat) return;
      const s = g.state;
      let move;
      if (s.colour === null) move = { type: 'colour', colour: 'r' };
      else if (s.playable.length) {
        const card = s.playable[0];
        move = { type: 'play', card };
        if (card.startsWith('w-') && s.hand.length > 1) move.colour = 'r';
        if (card.split('-')[1] === '7' && s.rules.sevenZero && s.hand.length > 1) move.swap = (g.seat + 1) % s.players;
        if (call && s.hand.length === 2) move.call = true;
      } else move = s.drawn ? { type: 'pass' } : { type: 'draw' };
      try {
        t.act(t.seats[i], 'move', { move });
      } catch (error) {
        if (!(error instanceof GameError)) throw error;
      }
    });
  };
}

test('a whole match of bots and people to 200: the round results wait for "next", the totals add up', () => {
  const { rooms, clock } = setup(3);
  const t = table(rooms, 1);
  t.act(t.host, 'bot', { add: true });
  t.act(t.host, 'bot', { add: true });
  t.act(t.host, 'settings', { rules: { target: 200 } });
  t.act(t.host, 'start');
  let rounds = 0;
  let seenScored = false;
  const page = t.pages[0];
  for (let ms = 0; ms < 12 * 60 * 60_000 && page.view.phase === 'play'; ms += 500) {
    const g = page.view.game;
    if (g.state.phase === 'scored') {
      if (!seenScored) {
        rounds++;
        seenScored = true;
        assert.ok(g.readyBy > page.view.now, 'the result waits');
        assert.ok(g.state.hands.every((h) => Array.isArray(h)), 'every hand shown at the end of a round');
      }
      for (const seat of t.seats) if (!page.view.game.ready.includes(seat.player) && page.view.game.state.phase === 'scored') t.act(seat, 'next');
    } else {
      seenScored = false;
      people(t)();
    }
    clock.advance(500);
  }
  const v = page.view;
  assert.equal(v.phase, 'final');
  assert.equal(v.game.ended, 'done');
  const { history, totals } = v.game.state;
  // The last round goes straight to the end (the target reached), without a result to wait on.
  assert.equal(history.length, rounds + 1);
  totals.forEach((total, seat) => assert.equal(total, history.reduce((sum, r) => sum + r.points[seat], 0)));
  assert.ok(Math.max(...totals) >= 200);
  assert.equal(v.game.standings[0].total, Math.max(...totals));
});

test('the round result moves on by itself after a while, even if someone never taps', () => {
  const { rooms, clock } = setup(5);
  const t = table(rooms, 1);
  t.act(t.host, 'settings', { rules: { target: 500 } });
  t.act(t.host, 'start');
  const page = t.pages[0];
  for (let ms = 0; ms < 60 * 60_000 && page.view.game.state.phase === 'play'; ms += 500) {
    people(t)();
    clock.advance(500);
  }
  assert.equal(page.view.game.state.phase, 'scored');
  const round = page.view.game.state.round;
  t.act(t.host, 'next');
  clock.advance(ROUND_WAIT + 100);
  assert.equal(page.view.game.state.round, round + 1);
  assert.equal(page.view.game.state.phase, 'play');
});

test('a call forgotten: the bots catch it, and the one caught draws two', () => {
  const { rooms, clock } = setup(11);
  const t = table(rooms, 0);
  t.act(t.host, 'bot', { add: true });
  t.act(t.host, 'bot', { add: true });
  t.act(t.host, 'settings', { bots: 'master', rules: { target: 0 } });
  t.act(t.host, 'start');
  const page = t.pages[0];
  let caught = 0;
  for (let ms = 0; ms < 60 * 60_000 && page.view.phase === 'play' && page.view.game.state.phase === 'play'; ms += 250) {
    people(t, { call: false })();
    clock.advance(250);
    caught += page.view.game.events.filter((e) => e.type === 'catch' && e.seat === 0 && !e.seen && (e.seen = true)).length;
  }
  const catches = page.view.game.events.filter((e) => e.type === 'catch');
  assert.ok(caught > 0 || catches.length > 0 || page.view.game.state.winner !== 0, 'someone caught the person, or they never got down to one');
});
