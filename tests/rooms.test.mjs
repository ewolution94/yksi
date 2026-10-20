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

test('a room: the host makes it, others join by its code, everyone sees the same table', () => {
  const { rooms } = setup();
  const t = table(rooms, 2);
  assert.equal(t.pages[0].view.phase, 'lobby');
  assert.deepEqual(t.pages[0].view.settings, DEFAULT_SETTINGS);
  assert.deepEqual(t.pages[0].view.rules, RULES);
  assert.equal(t.pages[0].view.order.length, 3);
  assert.equal(t.pages[1].view.host, t.host.player);
  assert.deepEqual(rooms.info(t.code), { code: t.code, phase: 'lobby', players: 3, full: false });
  refused(() => rooms.join('ZZZZ', { name: 'X' }), 'no-room');
  refused(() => rooms.create({ name: '' }), 'name');
});

test('settings: the host picks the target, the house rules, the clock and the bots; invalid values are ignored', () => {
  const merged = mergeSettings({ ...DEFAULT_SETTINGS }, { ...RULES }, { clock: 'quick', bots: 'master', rules: { target: 200, stack: true, jumpIn: true } });
  assert.deepEqual(merged.settings, { clock: 'quick', bots: 'master' });
  assert.equal(merged.rules.target, 200);
  assert.equal(merged.rules.stack, true);
  assert.equal(merged.rules.jumpIn, true);
  const bad = mergeSettings({ ...DEFAULT_SETTINGS }, { ...RULES }, { clock: 'slow', bots: 'grandmaster', rules: { target: 300 } });
  assert.deepEqual(bad.settings, DEFAULT_SETTINGS);
  assert.deepEqual(bad.rules, { ...RULES });

  const { rooms } = setup();
  const t = table(rooms, 1);
  t.act(t.host, 'settings', { rules: { target: 0, sevenZero: true } });
  assert.equal(t.pages[1].view.rules.target, 0);
  assert.equal(t.pages[1].view.rules.sevenZero, true);
  refused(() => t.act(t.seats[1], 'settings', { clock: 'quick' }), 'not-host');
});

test('the order of play: the host moves people with their ids in a new order, or shuffles', () => {
  const { rooms } = setup();
  const t = table(rooms, 2);
  const order = t.pages[0].view.order;
  t.act(t.host, 'order', { order: [order[2], order[0], order[1]] });
  assert.deepEqual(t.pages[1].view.order, [order[2], order[0], order[1]]);
  refused(() => t.act(t.host, 'order', { order: [order[0], order[0], order[1]] }), 'order');
  refused(() => t.act(t.seats[1], 'order', { order }), 'not-host');
  t.act(t.host, 'start');
  assert.deepEqual(t.pages[0].view.game.seats, [order[2], order[0], order[1]], 'the match keeps the lobby order');
});

test('a table needs two; ten at most', () => {
  const { rooms } = setup();
  const t = table(rooms, 0);
  refused(() => t.act(t.host, 'start'), 'too-few');
  for (let i = 0; i < 9; i++) t.act(t.host, 'bot', { add: true });
  refused(() => t.act(t.host, 'bot', { add: true }), 'table-full');
  t.act(t.host, 'start');
  assert.equal(t.pages[0].view.game.seats.length, 10);
});

test('hands are secret: each page holds its own hand, a watcher none, and everyone sees the counts', () => {
  const { rooms } = setup();
  const t = table(rooms, 2);
  t.act(t.host, 'start');
  const views = t.pages.map((p) => p.view.game);
  views.forEach((g, i) => {
    assert.equal(g.seat, i);
    assert.equal(g.state.hand.length, 7);
    assert.deepEqual(g.state.counts, [7, 7, 7]);
    assert.equal(g.state.hands, null);
    // Nobody else's cards anywhere in the page's view.
    const text = JSON.stringify(t.pages[i].view);
    for (const [j, other] of views.entries()) if (j !== i) for (const card of other.state.hand) assert.ok(!text.includes(`"${card}"`) || views[i].state.pile.includes(card), `${card} of seat ${j} leaked to seat ${i}`);
  });
  const watcher = watch(rooms, t.code, null);
  assert.equal(watcher.view.game.seat, -1);
  assert.equal(watcher.view.game.state.hand, null);
});

test('the clock: when it runs out, a bot finishes the turn; playing yourself is refused meanwhile', () => {
  const { rooms, clock } = setup();
  const t = table(rooms, 1);
  t.act(t.host, 'settings', { clock: 'quick' });
  t.act(t.host, 'start');
  const g = () => t.pages[0].view.game;
  const turn = g().state.turn;
  assert.ok(g().endsAt > 0);
  clock.advance(MOVE_SECONDS.quick * 1000 + 400);
  assert.equal(g().autopilot === turn || g().state.turn !== turn || g().state.colour !== null, true);
  clock.advance(3000);
  assert.notEqual(g().state.turn === turn && g().autopilot === turn && g().events.length === 0, true);
});

test('someone gone on their turn: after a while the bot plays it for them', () => {
  const { rooms, clock } = setup();
  const t = table(rooms, 1);
  t.act(t.host, 'start');
  const turn = t.pages[0].view.game.state.turn;
  const before = t.pages[0].view.game.events.length;
  t.pages[turn].close();
  clock.advance(AWAY_MS + 3000);
  const g = watch(rooms, t.code, t.seats[1 - turn].player).view.game;
  assert.ok(g.events.length > before, 'the bot moved for the missing player');
});

test('stop and rematch: the host ends the match for everyone, then deals again or goes back to the lobby', () => {
  const { rooms } = setup();
  const t = table(rooms, 1);
  t.act(t.host, 'start');
  refused(() => t.act(t.seats[1], 'stop'), 'not-host');
  t.act(t.host, 'stop');
  assert.equal(t.pages[1].view.phase, 'final');
  assert.equal(t.pages[1].view.game.ended, 'stopped');
  t.act(t.host, 'rematch');
  assert.equal(t.pages[1].view.phase, 'play');
  assert.equal(t.pages[1].view.game.n, 2);
  t.act(t.host, 'stop');
  t.act(t.host, 'rematch', { lobby: true });
  assert.equal(t.pages[1].view.phase, 'lobby');
});

test('a watcher sees the match and has no seat', () => {
  const { rooms } = setup();
  const t = table(rooms, 1);
  const late = rooms.join(t.code, { name: 'Zoe' });
  t.act(t.host, 'move', { player: late.player, seated: false });
  t.act(t.host, 'start');
  const page = watch(rooms, t.code, late.player);
  assert.equal(page.view.game.seat, -1);
  assert.equal(page.view.game.state.hand, null);
  refused(() => rooms.act(t.code, late.token, 'move', { move: { type: 'draw' } }), 'not-playing');
});
