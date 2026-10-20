// Yksi's rules: the colour-matching card game for 2 to 10 players as a pure state machine, Stammtisch's
// Mau-Mau's descendant. The baseline is Mattel's published classic sheet (the 108-card US sheet of
// 2009, item 42003) with the 2001 sheet's two-player rule on top (a Reverse acts as a Skip), checked
// against Mattel's own instruction sheets on 2026-10-20. A round: seven cards each, the next card
// turns up and starts the pile; in turn, put a card on it that matches its colour, its number or its
// symbol, or a Wild; or draw one. Whoever plays their last card wins the round and scores what's left
// in every other hand; the match runs rounds until someone's total reaches the target.
//
// The house rules (RULES, all off by default; the printed ones are Mattel's 2008 "House Rules"
// panel): `stack` a Draw Two on a Draw Two, a Wild Draw Four on a Wild Draw Four, passing the sum on
// · `jumpIn` a card identical to the top one goes down out of turn · `sevenZero` a 7 swaps hands
// with a player of your choice, a 0 passes every hand on · `drawToPlay` drawing goes on until a card
// fits · `target` the match's length (0: one round).
//
// Moves (plain JSON, from the page or a bot):
//   { type: 'play', card, colour?, call?, swap? }  colour: with a Wild; call: "Yksi!" with the
//                                                   second-to-last card; swap: a seat, with a 7
//                                                   under sevenZero
//   { type: 'draw' }        one card (or until one fits, under drawToPlay); also takes a pending Draw
//                           stack or accepts a pending Wild Draw Four
//   { type: 'pass' }        after drawing a card that fits, keep it
//   { type: 'challenge' }   the Wild Draw Four's victim calls it a bluff
//   { type: 'colour', colour }  the first player names the colour after a Wild upcard
//   { type: 'call' }        "Yksi!" late, while still open (out of turn too)
//   { type: 'catch' }       someone else is open: they draw two (out of turn too)
//   { type: 'jump', card, colour?, call?, swap? }  under jumpIn, out of turn
//   { type: 'next' }        any seat, once a round is scored: the next round is dealt
// act() returns events for the table. Events are public: a draw says how many cards, never which,
// and no hand shows before the round's end.
//
// Pure: no I/O, no clock, no randomness of its own (a randomInt(n) → 0..n-1 comes in for every
// shuffle), plain JSON state. Card ids are unique per physical card, so a page can key them without
// twin trouble (learnings/projects/stammtisch.md).

export class RuleError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.name = 'RuleError';
    this.code = code;
  }
}

/** @typedef {'r' | 'y' | 'g' | 'b'} Colour */
/** @typedef {'0'|'1'|'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'skip'|'rev'|'d2'|'wild'|'d4'} Face */

export const PLAYERS = Object.freeze({ min: 2, max: 10 });
/** Red, yellow, green, blue: the order a hand is sorted in. */
export const COLOURS = Object.freeze(/** @type {Colour[]} */ (['r', 'y', 'g', 'b']));
/** The match's lengths: the first to this total wins; 0 is one round. */
export const TARGETS = Object.freeze([0, 200, 500]);
export const RULES = Object.freeze({ stack: false, jumpIn: false, sevenZero: false, drawToPlay: false, target: 500 });
/** Cards dealt to each. */
export const HAND = 7;

const FLAGS = ['stack', 'jumpIn', 'sevenZero', 'drawToPlay'];
/** A coloured card's faces in hand order, and the wilds'. */
const FACES = Object.freeze(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'rev', 'd2']);
const WILD_FACES = Object.freeze(['wild', 'd4']);

/**
 * The rules from a lobby's settings: the defaults, with every known key that's set replacing its
 * default (null: the defaults). Throws 'rules' for a value of the wrong kind; unknown keys are dropped.
 * @param {Record<string, unknown> | null} [input]
 */
export function cleanRules(input = {}) {
  if (input === null || input === undefined) input = {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new RuleError('rules');
  const out = { ...RULES };
  for (const k of FLAGS) {
    if (input[k] === undefined) continue;
    if (typeof input[k] !== 'boolean') throw new RuleError('rules');
    out[k] = input[k];
  }
  if (input.target !== undefined) {
    if (!TARGETS.includes(/** @type {number} */ (input.target))) throw new RuleError('rules');
    out.target = /** @type {number} */ (input.target);
  }
  return Object.freeze(out);
}

// ---- cards ----------------------------------------------------------------------------------------

/**
 * The deck in box order: colour by colour (COLOURS order), each 0, two of 1 to 9, two Skips, two
 * Reverses, two Draw Twos; then four Wilds and four Wild Draw Fours. 108 ids, a new array.
 */
export function makeDeck() {
  /** @type {string[]} */
  const out = [];
  for (const c of COLOURS) for (const f of FACES) for (let k = 0; k < (f === '0' ? 1 : 2); k++) out.push(`${c}-${f}-${k}`);
  for (const f of WILD_FACES) for (let k = 0; k < 4; k++) out.push(`w-${f}-${k}`);
  return out;
}

/** Every card, parsed once: the engine asks a card's colour and face on every fit, the bots' trials thousands of times. */
const PARSED = new Map(makeDeck().map((id) => {
  const [c, f, k] = id.split('-');
  return [id, Object.freeze({ c: /** @type {Colour | 'w'} */ (c), f: /** @type {Face} */ (f), k: Number(k) })];
}));

/** @param {unknown} id  @returns {{ c: Colour | 'w', f: Face, k: number }} */
export function parseCard(id) {
  const p = typeof id === 'string' ? PARSED.get(id) : undefined;
  if (!p) throw new RuleError('card');
  return p;
}

/** @param {unknown} id */
export const isCard = (id) => typeof id === 'string' && PARSED.has(id);
/** A Wild or a Wild Draw Four. @param {string} id */
export const isWild = (id) => parseCard(id).c === 'w';
/** Same colour and face: the two copies of a card (what jumpIn asks for). @param {string} a  @param {string} b */
export const identical = (a, b) => {
  const p = parseCard(a);
  const q = parseCard(b);
  return p.c === q.c && p.f === q.f;
};

/** What a card left in hand scores for the round's winner: its number, 20 for an action, 50 for a wild. @param {string} id */
export function points(id) {
  const { c, f } = parseCard(id);
  if (c === 'w') return 50;
  return f === 'skip' || f === 'rev' || f === 'd2' ? 20 : Number(f);
}
/** @param {readonly string[]} hand */
export const handPoints = (hand) => hand.reduce((sum, id) => sum + points(id), 0);

const COLOUR_AT = { r: 0, y: 1, g: 2, b: 3, w: 4 };
const FACE_AT = Object.fromEntries([...FACES, ...WILD_FACES].map((f, i) => [f, i]));
/** A hand as it's held: by colour (red, yellow, green, blue), each 0 to 9, Skip, Reverse, Draw Two; the wilds last. Returns a new array. */
export const sortHand = (hand) => [...hand].sort((a, b) => sortKey(a) - sortKey(b));
const sortKey = (id) => {
  const { c, f, k } = parseCard(id);
  return COLOUR_AT[c] * 100 + FACE_AT[f] * 4 + k;
};

/**
 * Fisher–Yates. Returns a new array.
 * @template T  @param {readonly T[]} cards  @param {(n: number) => number} randomInt 0..n-1
 */
export function shuffled(cards, randomInt) {
  if (typeof randomInt !== 'function') throw new TypeError('shuffling needs randomInt');
  const a = [...cards];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The seat `steps` on from `seat` (negative goes the other way round). */
export const nextSeat = (seat, players, steps = 1) => (((seat + steps) % players) + players) % players;

// ---- the state ------------------------------------------------------------------------------------

/**
 * pending: a draw waiting for the victim's answer. kind 'd4': a Wild Draw Four (count 4, more when
 * stacked), with `before`, the colour in play before it, and `guilty`, whether its player held a card
 * of that colour (fixed when it's played: a catch could add cards before the challenge; never in a
 * view). kind 'd2': a Draw Two stack, under the stack rule only (without it a Draw Two hits at once).
 * @typedef {{ kind: 'd2' | 'd4', count: number, seat: number, victim: number, before?: Colour, guilty?: boolean }} Pending
 * @typedef {{ round: number, winner: number, points: number[], blocked?: true }} RoundRecord
 * @typedef {{ played: number, challenged: number, guilty: number }} FourRecord
 * @typedef {{
 *   game: 'yksi', rules: typeof RULES, players: number, dealer: number, round: number,
 *   totals: number[], history: RoundRecord[], phase: 'play' | 'scored' | 'done',
 *   hands: string[][], stock: string[], pile: string[], colour: Colour | null,
 *   turn: number, dir: 1 | -1, drawn: string | null, pending: Pending | null,
 *   open: number | null, peek: { seat: number, from: number, hand: string[] } | null,
 *   winner: number | null, result: { round: number, winner: number, points: number[], hands: string[][], blocked: boolean } | null,
 *   lacked: Colour[][], fours: FourRecord[], stuck: number, opening: Record<string, unknown>[],
 * }} State
 */

/**
 * A new match and its first round. randomInt(n) returns 0..n-1. Tests pass `hands`, `top` and
 * `stock` (stock[0] is drawn first) instead, for a fixed deal; randomInt is still needed when the
 * upcard is a Wild Draw Four (it goes back and the stock is shuffled) or a later round is dealt.
 * @param {{ players: number, rules?: Record<string, unknown> | null, dealer?: number, randomInt?: (n: number) => number,
 *   hands?: string[][], top?: string, stock?: string[] }} o
 * @returns {State}
 */
export function createGame({ players, rules: raw, dealer = 0, randomInt, hands, top, stock }) {
  const rules = cleanRules(raw);
  if (!Number.isInteger(players) || players < PLAYERS.min || players > PLAYERS.max) throw new RuleError('players');
  if (!Number.isInteger(dealer) || dealer < 0 || dealer >= players) throw new RuleError('players');
  /** @type {State} */
  const state = {
    game: 'yksi',
    rules,
    players,
    dealer,
    round: 1,
    totals: Array(players).fill(0),
    history: [],
    phase: 'play',
    hands: [],
    stock: [],
    pile: [],
    colour: null,
    turn: 0,
    dir: 1,
    drawn: null,
    pending: null,
    open: null,
    peek: null,
    winner: null,
    result: null,
    lacked: [],
    fours: Array.from({ length: players }, () => ({ played: 0, challenged: 0, guilty: 0 })),
    stuck: 0,
    opening: [],
  };
  dealRound(state, { randomInt, hands, top, stock });
  return state;
}

/** Deals a round into `state` (dealer, round, totals and the four record stay) and turns the upcard. Returns its events. */
function dealRound(state, { randomInt, hands: fixed, top: fixedTop, stock: fixedStock }) {
  const n = state.players;
  /** @type {string[][]} */
  let hands;
  /** @type {string} */
  let top;
  /** @type {string[]} */
  let stock;
  if (fixed) {
    if (!Array.isArray(fixed) || fixed.length !== n || fixed.some((h) => !Array.isArray(h) || !h.length)) throw new RuleError('deal');
    const all = [...fixed.flat(), fixedTop, ...(fixedStock ?? [])];
    if (!all.every(isCard)) throw new RuleError('card');
    if (new Set(all).size !== all.length) throw new RuleError('deal');
    hands = fixed.map((h) => [...h]);
    top = /** @type {string} */ (fixedTop);
    stock = [...(fixedStock ?? [])];
  } else {
    if (typeof randomInt !== 'function') throw new TypeError('dealing needs randomInt or hands');
    const deck = shuffled(makeDeck(), randomInt);
    hands = Array.from({ length: n }, () => []);
    // One card at a time, left of the dealer first.
    for (let i = 0; i < n * HAND; i++) hands[nextSeat(state.dealer, n, 1 + (i % n))].push(deck[i]);
    top = deck[n * HAND];
    stock = deck.slice(n * HAND + 1);
  }

  Object.assign(state, {
    phase: 'play', hands, stock, pile: [], colour: null, dir: 1, drawn: null, pending: null, open: null, peek: null,
    winner: null, result: null, lacked: Array.from({ length: n }, () => []), stuck: 0,
  });
  /** @type {Record<string, unknown>[]} */
  const events = [];
  // A Wild Draw Four can't start the pile: back into the stock, which is shuffled, and turn another.
  while (parseCard(top).f === 'd4') {
    if (!state.stock.some((id) => parseCard(id).f !== 'd4')) throw new RuleError('deal');
    events.push({ type: 'upcard', card: top, back: true });
    state.stock = shuffled([...state.stock, top], /** @type {(n: number) => number} */ (randomInt));
    top = /** @type {string} */ (state.stock.shift());
  }
  state.pile = [top];
  events.push({ type: 'upcard', card: top });

  // The upcard counts as the dealer's play (the 2009 sheet): a Skip skips the first player, a
  // Reverse sends play the other way so the dealer starts (with two that's a Skip: the dealer
  // starts too), a Draw Two makes the first player draw two and miss the turn, and after a Wild the
  // first player names the colour before playing.
  const { c, f } = parseCard(top);
  const first = nextSeat(state.dealer, n, 1);
  state.turn = first;
  if (c !== 'w') {
    state.colour = c;
    if (f === 'skip') {
      events.push({ type: 'skip', seat: first });
      state.turn = nextSeat(first, n, 1);
    } else if (f === 'rev') {
      state.dir = -1;
      events.push({ type: 'reverse', dir: -1 });
      if (n === 2) events.push({ type: 'skip', seat: first });
      state.turn = state.dealer;
    } else if (f === 'd2') {
      const got = drawCards(state, first, 2, events, randomInt);
      events.push({ type: 'draw', seat: first, count: got, penalty: true });
      events.push({ type: 'skip', seat: first });
      state.turn = nextSeat(first, n, 1);
    }
  }
  state.opening = events;
  return events;
}

/** The card on top of the pile. @param {State} state */
export const topCard = (state) => state.pile[state.pile.length - 1];

/**
 * Whether `id` may go on the pile now, whatever hand it's in (the turn's own limits, like the card
 * just drawn, are in playable()). A Wild Draw Four always may: holding the colour in play makes it
 * a bluff, which only a challenge punishes.
 * @param {State} state  @param {string} id
 */
export function fits(state, id) {
  const p = parseCard(id);
  const pend = state.pending;
  // A draw is waiting: only stacking answers it (a Draw Two on a Draw Two, a Four on a Four).
  if (pend) return state.rules.stack && p.f === pend.kind;
  if (p.c === 'w') return true;
  if (p.c === state.colour) return true;
  const top = parseCard(topCard(state));
  return top.c !== 'w' && p.f === top.f;
}

/**
 * Whether a Wild Draw Four is legal (not a bluff) from `hand` (without the Four itself): no card of
 * the colour in play. Cards of the same number or symbol in other colours don't count, nor do wilds
 * (the 2009 reading; the 2021 sheet counts wilds too).
 * @param {readonly string[]} hand  @param {Colour | null} colour
 */
export const fourIsLegal = (hand, colour) => !hand.some((id) => parseCard(id).c === colour);

/**
 * The cards `seat` may play now on its turn, each once, in hand order; empty when it isn't their
 * turn (jumpable() has the out-of-turn ones).
 * @param {State} state  @param {number} seat
 */
export function playable(state, seat) {
  if (state.phase !== 'play' || seat !== state.turn || state.colour === null) return [];
  if (state.drawn) return fits(state, state.drawn) ? [state.drawn] : [];
  return sortHand(state.hands[seat].filter((id) => fits(state, id)));
}

/**
 * The cards `seat` may jump in with now (jumpIn): identical to the top card, not a wild, and not on
 * its own turn (then it simply plays).
 * @param {State} state  @param {number} seat
 */
export function jumpable(state, seat) {
  if (!state.rules.jumpIn || state.phase !== 'play' || seat === state.turn || state.colour === null) return [];
  const top = topCard(state);
  if (isWild(top)) return [];
  return sortHand(state.hands[seat].filter((id) => identical(id, top)));
}

/**
 * Every legal move for `seat` now, out-of-turn ones included (call, catch, jump). A play that leaves
 * one card is listed with and without `call` (both are legal; without, the seat is open); a Wild once
 * per colour; a 7 under sevenZero once per seat to swap with.
 * @param {State} state  @param {number} seat
 */
export function moves(state, seat) {
  if (state.phase === 'scored') return [{ type: 'next' }];
  if (state.phase !== 'play') return [];
  /** @type {Record<string, unknown>[]} */
  const out = [];
  if (state.open === seat) out.push({ type: 'call' });
  else if (state.open !== null) out.push({ type: 'catch' });
  if (seat !== state.turn) {
    for (const card of jumpable(state, seat)) out.push(...variants(state, seat, card, 'jump'));
    return out;
  }
  if (state.colour === null) {
    for (const colour of COLOURS) out.push({ type: 'colour', colour });
    return out;
  }
  for (const card of playable(state, seat)) out.push(...variants(state, seat, card, 'play'));
  out.push(state.drawn ? { type: 'pass' } : { type: 'draw' });
  if (state.pending?.kind === 'd4') out.push({ type: 'challenge' });
  return out;
}

/** The ways to play `card`: a colour for a wild, a seat for a 7 under sevenZero, with and without the call. */
function variants(state, seat, card, type) {
  const left = state.hands[seat].length - 1;
  const { c, f } = parseCard(card);
  /** @type {Record<string, unknown>[]} */
  let out = [{ type, card }];
  // The last card ends the round: no colour to name, nobody to swap with.
  if (left > 0 && c === 'w') out = COLOURS.map((colour) => ({ type, card, colour }));
  if (left > 0 && f === '7' && state.rules.sevenZero) {
    out = out.flatMap((m) => [...Array(state.players).keys()].filter((s) => s !== seat).map((swap) => ({ ...m, swap })));
  }
  if (left === 1) out = out.flatMap((m) => [{ ...m, call: true }, m]);
  return out;
}

// ---- moves ----------------------------------------------------------------------------------------

/**
 * Makes a move. Changes `state` and returns what happened, in order, for the table. `randomInt` is
 * needed when the stock runs out (the pile is shuffled into a new one) and to deal the next round.
 * @param {State} state  @param {number} seat  @param {Record<string, any>} move
 * @param {{ randomInt?: (n: number) => number }} [ctx]
 */
export function act(state, seat, move, { randomInt } = {}) {
  if (!move || typeof move !== 'object') throw new RuleError('move');
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.players) throw new RuleError('seat');
  /** @type {Record<string, unknown>[]} */
  const events = [];
  const type = move.type;
  if (type === 'next') {
    if (state.phase !== 'scored') throw new RuleError('phase');
    if (typeof randomInt !== 'function') throw new TypeError('dealing needs randomInt');
    state.dealer = nextSeat(state.dealer, state.players, 1);
    state.round += 1;
    events.push({ type: 'deal', round: state.round, dealer: state.dealer });
    events.push(...dealRound(state, { randomInt }));
    return events;
  }
  if (state.phase !== 'play') throw new RuleError('phase');

  if (type === 'call') {
    if (state.open !== seat) throw new RuleError('call');
    state.open = null;
    events.push({ type: 'call', seat });
    return events;
  }
  if (type === 'catch') {
    const open = state.open;
    if (open === null || open === seat) throw new RuleError('catch');
    state.open = null;
    events.push({ type: 'catch', seat: open, by: seat });
    penalty(state, open, 2, events, randomInt);
    return events;
  }
  if (type === 'jump') {
    if (!state.rules.jumpIn || seat === state.turn || !jumpable(state, seat).includes(move.card)) throw new RuleError('jump');
    playCard(state, seat, move, events, randomInt, true);
    tidy(state);
    return events;
  }

  // The turn's own moves.
  if (seat !== state.turn) throw new RuleError('turn');
  if (type === 'colour') {
    if (state.colour !== null || !COLOURS.includes(move.colour)) throw new RuleError('colour');
    settle(state, seat);
    state.colour = move.colour;
    events.push({ type: 'colour', seat, colour: move.colour });
    return events;
  }
  // After a Wild upcard the colour comes first.
  if (state.colour === null) throw new RuleError('colour');
  if (type === 'play') {
    playCard(state, seat, move, events, randomInt, false);
  } else if (type === 'draw') {
    if (state.drawn) throw new RuleError('drawn');
    settle(state, seat);
    draw(state, seat, events, randomInt);
  } else if (type === 'pass') {
    if (!state.drawn) throw new RuleError('pass');
    settle(state, seat);
    // The kept card fits, so it may be of the colour the seat was thought to lack.
    state.lacked[seat] = state.lacked[seat].filter((x) => x !== state.colour);
    events.push({ type: 'pass', seat });
    endTurn(state, seat);
  } else if (type === 'challenge') {
    const pend = state.pending;
    if (pend?.kind !== 'd4' || pend.victim !== seat) throw new RuleError('challenge');
    settle(state, seat);
    challenge(state, seat, pend, events, randomInt);
  } else throw new RuleError('move');
  tidy(state);
  return events;
}

/**
 * What any table move by `seat` ends: a challenger's look at the challenged hand, and someone else's
 * open "Yksi!" (the next player has moved: too late to catch them).
 */
function settle(state, seat) {
  state.peek = null;
  if (state.open !== null && state.open !== seat) state.open = null;
}

/** After a move: whoever is open is open only while holding one card and the round goes on. */
function tidy(state) {
  if (state.open !== null && (state.phase !== 'play' || state.hands[state.open].length !== 1)) state.open = null;
}

function playCard(state, seat, move, events, randomInt, jump) {
  const { card } = move;
  const hand = state.hands[seat];
  if (!isCard(card) || !hand.includes(card)) throw new RuleError('card');
  if (!jump) {
    if (state.drawn && card !== state.drawn) throw new RuleError('drawn');
    if (!fits(state, card)) throw new RuleError('fits');
  }
  const p = parseCard(card);
  const n = state.players;
  const last = hand.length === 1;
  // A wild names a colour, unless it's the last card (the round is over).
  let colour = p.c === 'w' ? move.colour : p.c;
  if (p.c === 'w' && !COLOURS.includes(colour)) {
    if (!last || colour !== undefined) throw new RuleError('colour');
    colour = state.colour;
  }
  const sevenZero = state.rules.sevenZero && !last && (p.f === '7' || p.f === '0');
  if (sevenZero && p.f === '7' && (!Number.isInteger(move.swap) || move.swap < 0 || move.swap >= n || move.swap === seat)) {
    throw new RuleError('swap');
  }
  settle(state, seat);
  // A jump: play goes on from the jumper as if it were their turn, and the turn's player loses the
  // card they drew to choose on (it stays in their hand).
  if (jump) {
    state.drawn = null;
    state.turn = seat;
  }

  const before = /** @type {Colour} */ (state.colour);
  const prior = state.pending;
  hand.splice(hand.indexOf(card), 1);
  state.pile.push(card);
  state.drawn = null;
  state.pending = null;
  state.stuck = 0;
  state.colour = colour;
  if (p.c !== 'w') state.lacked[seat] = state.lacked[seat].filter((x) => x !== p.c);
  /** @type {Record<string, unknown>} */
  const ev = { type: 'play', seat, card };
  if (p.c === 'w' && !last) ev.colour = colour;
  if (jump) ev.jump = true;
  events.push(ev);
  if (p.f === 'd4') state.fours[seat].played += 1;
  // Under the stack rule a Draw answers a waiting Draw of its kind, and the sum grows.
  const stacked = prior && prior.kind === p.f ? prior.count : 0;
  const next = nextSeat(seat, n, state.dir);

  if (last) {
    events.push({ type: 'out', seat });
    // Going out on a Draw Two or a Wild Draw Four: the next player still draws (no challenge), and
    // those cards count for the winner.
    if (p.f === 'd2' || p.f === 'd4') penalty(state, next, stacked + (p.f === 'd2' ? 2 : 4), events, randomInt);
    finish(state, seat, events, false);
    return;
  }
  // Down to one card: "Yksi!" now, or open until the next player moves.
  if (hand.length === 1) {
    if (move.call === true) events.push({ type: 'call', seat });
    else state.open = seat;
  }

  switch (p.f) {
    case 'skip':
      events.push({ type: 'skip', seat: next });
      state.turn = nextSeat(next, n, state.dir);
      break;
    case 'rev':
      state.dir = state.dir === 1 ? -1 : 1;
      events.push({ type: 'reverse', dir: state.dir });
      // With two, a Reverse is a Skip: the player goes again.
      if (n === 2) {
        events.push({ type: 'skip', seat: next });
        state.turn = seat;
      } else state.turn = nextSeat(seat, n, state.dir);
      break;
    case 'd2':
      if (state.rules.stack) {
        state.pending = { kind: 'd2', count: stacked + 2, seat, victim: next };
        state.turn = next;
      } else {
        penalty(state, next, 2, events, randomInt);
        events.push({ type: 'skip', seat: next });
        state.turn = nextSeat(next, n, state.dir);
      }
      break;
    case 'd4':
      // Guilt is fixed now: a catch could add cards to this hand before the challenge.
      state.pending = { kind: 'd4', count: stacked + 4, seat, victim: next, before, guilty: !fourIsLegal(hand, before) };
      state.turn = next;
      break;
    default:
      if (sevenZero && p.f === '7') {
        const other = move.swap;
        [state.hands[seat], state.hands[other]] = [state.hands[other], state.hands[seat]];
        [state.lacked[seat], state.lacked[other]] = [state.lacked[other], state.lacked[seat]];
        events.push({ type: 'swap', seat, with: other });
      } else if (sevenZero && p.f === '0') {
        // Every hand goes to the next player in the direction of play (and what's known of it with it).
        const hands = [...state.hands];
        const lacked = [...state.lacked];
        for (let s = 0; s < n; s++) {
          state.hands[nextSeat(s, n, state.dir)] = hands[s];
          state.lacked[nextSeat(s, n, state.dir)] = lacked[s];
        }
        events.push({ type: 'rotate', dir: state.dir });
      }
      state.turn = next;
  }
  // A swap can leave the player without the one card they called on (or with someone else's one).
  if (state.open === seat && state.hands[seat].length !== 1) state.open = null;
}

function draw(state, seat, events, randomInt) {
  const pend = state.pending;
  if (pend) {
    // Taking a waiting Draw (or accepting a Wild Draw Four): the cards, and the turn is lost.
    state.pending = null;
    const got = penalty(state, seat, pend.count, events, randomInt);
    if (!stuck(state, seat, got, events)) endTurn(state, seat);
    return;
  }
  const hand = state.hands[seat];
  const colour = /** @type {Colour} */ (state.colour);
  let got = 0;
  /** @type {string | null} */
  let card = null;
  // One card; under drawToPlay, on until one fits (or nothing is left to draw).
  do {
    if (!drawCards(state, seat, 1, events, randomInt)) break;
    got += 1;
    card = hand[hand.length - 1];
  } while (state.rules.drawToPlay && !fits(state, card));
  events.push({ type: 'draw', seat, count: got });
  if (stuck(state, seat, got, events)) return;
  // Public knowledge for the bots: this seat drew rather than follow the colour (likely lacks it).
  if (!state.lacked[seat].includes(colour)) state.lacked[seat] = COLOURS.filter((x) => x === colour || state.lacked[seat].includes(x));
  // A card that fits may go straight on (only that one); anything else ends the turn.
  if (card && fits(state, card)) state.drawn = card;
  else endTurn(state, seat);
}

/**
 * Counts a turn that drew nothing (stock and pile both empty). Once every player in a row has drawn
 * nothing the round can't go on: it ends, won by whoever holds the fewest cards (the first of them
 * from the dealer's left). Returns whether it ended.
 */
function stuck(state, seat, got, events) {
  if (got) {
    state.stuck = 0;
    return false;
  }
  state.stuck += 1;
  if (state.stuck < state.players) return false;
  const fewest = Math.min(...state.hands.map((h) => h.length));
  const winner = /** @type {number} */ ([...Array(state.players).keys()]
    .map((k) => nextSeat(state.dealer, state.players, 1 + k))
    .find((s) => state.hands[s].length === fewest));
  events.push({ type: 'blocked', seat: winner });
  finish(state, winner, events, true);
  return true;
}

/**
 * The Wild Draw Four's victim calls it a bluff, and sees the hand. Guilty (it held the colour that
 * was in play): its player draws the Four (the whole stack under the stack rule) and the challenger
 * plays their turn on the colour named. Innocent: the challenger draws the Four and two more, and
 * loses the turn. The colour named stands either way.
 */
function challenge(state, seat, pend, events, randomInt) {
  const against = pend.seat;
  state.pending = null;
  state.peek = { seat, from: against, hand: sortHand(state.hands[against]) };
  const guilty = /** @type {boolean} */ (pend.guilty);
  state.fours[against].challenged += 1;
  if (guilty) state.fours[against].guilty += 1;
  events.push({ type: 'challenge', seat, against, guilty });
  if (guilty) {
    penalty(state, against, pend.count, events, randomInt);
    return;
  }
  penalty(state, seat, pend.count + 2, events, randomInt);
  endTurn(state, seat);
}

/** A penalty: `n` cards for `seat` (what's left if the stock and pile can't give them all); what's known of their hand goes. */
function penalty(state, seat, n, events, randomInt) {
  const got = drawCards(state, seat, n, events, randomInt);
  events.push({ type: 'draw', seat, count: got, penalty: true });
  state.lacked[seat] = [];
  return got;
}

/**
 * Draws up to `n` cards into `seat`'s hand, turning the pile (all but its top card) into a new stock
 * when the stock runs out. Returns how many it got.
 */
function drawCards(state, seat, n, events, randomInt) {
  let got = 0;
  for (let i = 0; i < n; i++) {
    if (!state.stock.length) {
      const under = state.pile.slice(0, -1);
      if (!under.length) break;
      if (typeof randomInt !== 'function') throw new TypeError('act needs randomInt to shuffle the pile');
      state.stock = shuffled(under, randomInt);
      state.pile = [topCard(state)];
      events.push({ type: 'reshuffle', count: state.stock.length });
    }
    state.hands[seat].push(/** @type {string} */ (state.stock.shift()));
    got += 1;
  }
  return got;
}

function endTurn(state, seat) {
  state.drawn = null;
  state.turn = nextSeat(seat, state.players, state.dir);
}

/** The round's end: the winner scores every other hand; the match ends at the target (or after one round with target 0). */
function finish(state, winner, events, blocked) {
  const n = state.players;
  const won = state.hands.reduce((sum, hand, s) => (s === winner ? sum : sum + handPoints(hand)), 0);
  const roundPoints = Array(n).fill(0);
  roundPoints[winner] = won;
  state.totals[winner] += won;
  /** @type {RoundRecord} */
  const record = { round: state.round, winner, points: roundPoints };
  if (blocked) record.blocked = true;
  state.history.push(record);
  state.result = { round: state.round, winner, points: [...roundPoints], hands: state.hands.map(sortHand), blocked };
  state.winner = winner;
  state.drawn = null;
  state.pending = null;
  state.open = null;
  state.peek = null;
  events.push({ type: 'scored', winner, points: won });
  const over = state.rules.target === 0 || state.totals[winner] >= state.rules.target;
  state.phase = over ? 'done' : 'scored';
  if (over) events.push({ type: 'done', winner });
}

// ---- what the table sees --------------------------------------------------------------------------

/** Every seat's match total, in seat order. @param {State} state */
export const totals = (state) => [...state.totals];

/** The table's order, best first; equal totals share a place (1, 1, 3). @param {State} state */
export function standings(state) {
  const all = state.totals.map((total, seat) => ({ seat, total }));
  return all
    .map((s) => ({ ...s, place: 1 + all.filter((o) => o.total > s.total).length }))
    .sort((a, b) => b.total - a.total || a.seat - b.seat);
}

/**
 * What one seat sees: its own hand and nobody else's (only how many cards each holds), the pile's
 * top few cards, the stock's size, whose turn it is and what's waiting (never whether a Wild Draw
 * Four was a bluff). Once a round is scored every hand is shown, as when the cards are counted.
 * `seat` null: a watcher. A JSON-safe copy.
 * @param {State} state  @param {number | null} seat
 */
export function view(state, seat) {
  const mine = Number.isInteger(seat) && /** @type {number} */ (seat) >= 0 && /** @type {number} */ (seat) < state.players;
  const s = /** @type {number} */ (seat);
  const shown = state.phase !== 'play';
  const pend = state.pending;
  return {
    game: 'yksi',
    rules: state.rules,
    phase: state.phase,
    players: state.players,
    dealer: state.dealer,
    round: state.round,
    turn: state.turn,
    dir: state.dir,
    colour: state.colour,
    pile: state.pile.slice(-4),
    piled: state.pile.length,
    stock: state.stock.length,
    counts: state.hands.map((h) => h.length),
    pending: pend ? { kind: pend.kind, count: pend.count, seat: pend.seat, victim: pend.victim, ...(pend.kind === 'd4' ? { before: pend.before } : {}) } : null,
    open: state.open,
    // Someone drew a card that fits and is choosing; which card it is only they know.
    choosing: state.drawn !== null,
    lacked: state.lacked.map((l) => [...l]),
    fours: state.fours.map((f) => ({ ...f })),
    totals: [...state.totals],
    history: state.history.map((h) => ({ ...h, points: [...h.points] })),
    hand: mine ? sortHand(state.hands[s]) : null,
    drawn: mine && s === state.turn ? state.drawn : null,
    playable: mine ? playable(state, s) : [],
    jumpable: mine ? jumpable(state, s) : [],
    peek: mine && state.peek?.seat === s ? { from: state.peek.from, hand: [...state.peek.hand] } : null,
    winner: state.winner,
    result: shown && state.result ? { ...state.result, points: [...state.result.points], hands: state.result.hands.map((h) => [...h]) } : null,
    hands: shown ? state.hands.map(sortHand) : null,
  };
}
