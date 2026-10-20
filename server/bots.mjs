// Yksi's bots in three ranks, a guild's (Stammtisch's and Stichle's ranks):
//
//   apprentice  the rules with a beginner's habits: every other card any card that fits (a Wild early,
//               a Wild Draw Four whether it may or not), a colour picked half at random, "Yksi!"
//               forgotten one time in four, never a challenge, seldom a catch
//   journeyman  sensible: keeps its wilds for when nothing else fits, sheds the colour it holds most,
//               hits a player close to going out with a Draw Two or a Skip, names the colour it holds
//               most, plays a Wild Draw Four only when it may, always calls, catches whoever forgets,
//               and challenges a Four when its player's record says they bluff
//   master      the journeyman's sense and more: it keeps track of the colours others have drawn on
//               (and so lack), dumps its expensive cards when someone is about to go out, weighs a
//               draw card against a wild by the next player's count, bluffs a Four now and then when
//               it's worth it, challenges by the odds; then it deals out the cards it can't see, many
//               times over, plays each of its best few choices to the end of the round in all of them
//               (that sense, without the search, for everyone), and takes another choice than its
//               own first only when that one does clearly better on average
//
// No bot reads a hand but its own (tests/bots.test.mjs → "honest"): only what its view shows, plus
// the pile (every card in it was played face up) and the public record in the state (`lacked`, the
// colours a seat drew on; `fours`, each seat's challenged Fours). Every random draw comes from a
// generator seeded by what the seat sees, so the same position always gives the same move.

import { COLOURS, act, fits, fourIsLegal, handPoints, identical, jumpable, makeDeck, nextSeat, parseCard, points, sortHand, view } from './rules.mjs';

/** @typedef {import('./rules.mjs').State} State */
/** @typedef {import('./rules.mjs').Colour} Colour */
/** @typedef {Record<string, any>} Move */

/** The ranks, weakest first. */
export const LEVELS = Object.freeze(['apprentice', 'journeyman', 'master']);

/**
 * The master's hard stop in wall-clock time: no new trial deal starts after it. Under the 150 ms a
 * move may take, with room for the trial running when it strikes (and for the NAS's slower cores, on
 * which the count below may not be reached). YKSI_MASTER_MS overrides it (tests: far away, so the
 * count binds and the moves repeat).
 */
export const MASTER_MS = Number(globalThis.process?.env?.YKSI_MASTER_MS ?? 80);
/** How much play a master's decision may cost, in moves played across all its trials (YKSI_MASTER_PLAYS overrides it). */
export const PLAYS = Number(globalThis.process?.env?.YKSI_MASTER_PLAYS ?? 40000);
/** Trial deals per decision: at least this many, at most that many (the plays bind in between). */
const DEALS = Object.freeze({ min: 8, max: 400 });
/**
 * How clearly a searched choice must beat the master's own, in standard errors of the difference
 * (duplicate deals, 2026-10-20: 1.5 to 2 did best; below 1 the noise picks the move, and twice the
 * plays brought nothing more).
 */
const Z = Number(globalThis.process?.env?.YKSI_Z ?? 1.5);
const HORIZON = Number(globalThis.process?.env?.YKSI_H ?? 0);
const CARD = Number(globalThis.process?.env?.YKSI_CARD ?? 6);
/** A trial round ends here even if nobody has gone out (the count of cards then judges it). */
const ROLLOUT_CAP = 300;
/** Choices a master compares (its own heuristic's best few, and drawing). */
const CHOICES = Number(globalThis.process?.env?.YKSI_CHOICES ?? 5);

const DECK = Object.freeze(makeDeck());

/**
 * The bot's move for `seat`, whose turn it is (the colour after a Wild upcard, a challenge, keeping
 * or playing a drawn card included); `{ type: 'next' }` once a round is scored; null when this seat
 * has nothing to do (botReflex() has the out-of-turn moves).
 * @param {State} state  @param {number} seat  @param {{ level?: string }} [style]
 * @returns {Move | null}
 */
export function botMove(state, seat, { level = 'journeyman' } = {}) {
  if (state.phase === 'scored') return { type: 'next' };
  if (state.phase !== 'play' || seat !== state.turn) return null;
  if (level === 'apprentice') return apprentice(state, seat);
  if (level === 'master') return master(state, seat);
  return decide(state, seat, false);
}

/**
 * An out-of-turn move, or null: "Yksi!" for itself when open, a catch of someone open, a jump under
 * the jumpIn rule. The rooms ask it after a reaction delay.
 * @param {State} state  @param {number} seat  @param {{ level?: string }} [style]
 * @returns {Move | null}
 */
export function botReflex(state, seat, { level = 'journeyman' } = {}) {
  if (state.phase !== 'play') return null;
  const beginner = level === 'apprentice';
  const jumps = jumpable(state, seat);
  if (state.open === null && !jumps.length) return null;
  const r = seeded(`reflex|${level}|${seat}|${sight(state, seat)}`);
  // An apprentice who forgot the call has forgotten it; the others call with the card, so for them
  // this is only a safety net.
  if (state.open === seat) return beginner ? null : { type: 'call' };
  if (state.open !== null) return !beginner || r() < 0.25 ? { type: 'catch' } : null;
  if (beginner) return r() < 0.5 ? withCall(shape(state, seat, jumps[0], 'jump', false, r), state, seat, r() >= 0.25) : null;
  // A free card out of turn is nearly always worth it; not when it costs more than it sheds (a 0 or
  // a 7 that would hand this seat a bigger hand).
  const hand = state.hands[seat];
  const card = jumps[0];
  if (score(state, seat, card, hand.filter((id) => id !== card), level === 'master') <= 0) return null;
  return withCall(shape(state, seat, card, 'jump', level === 'master'), state, seat, true);
}

// ---- the journeyman (and the master's own sense) --------------------------------------------------
//
// It reads only its own hand, the counts, the top card and colour, what's waiting (never whether a
// Four was a bluff), the card it drew itself, and the public record.

/**
 * The journeyman's move for the seat in turn (`sharp`: the master's sense on top).
 * @param {State} state  @param {number} seat  @param {boolean} sharp
 * @returns {Move}
 */
function decide(state, seat, sharp) {
  const hand = state.hands[seat];
  if (state.colour === null) return { type: 'colour', colour: favourite(state, seat, hand, sharp) };
  const pend = state.pending;
  if (pend) return answer(state, seat, pend, sharp);
  if (state.drawn) return afterDraw(state, seat, sharp);
  const best = ranked(state, seat, sharp)[0];
  return best ? withCall(shape(state, seat, best.card, 'play', sharp), state, seat, true) : { type: 'draw' };
}

/** A waiting draw: stack it if the rule allows and a card does, else challenge a Four (by the record, or the odds) or take it. */
function answer(state, seat, pend, sharp) {
  const hand = state.hands[seat];
  if (state.rules.stack) {
    const own = sortHand(hand.filter((id) => parseCard(id).f === pend.kind));
    // A Four is passed on only when it may be (no card of the colour in play).
    const ok = own.filter((id) => pend.kind === 'd2' || fourIsLegal(hand.filter((x) => x !== id), state.colour));
    if (ok.length) {
      // A Draw Two of the colour the rest of the hand holds most.
      const card = ok.reduce((a, b) => (colourCount(hand, parseCard(b).c, b) > colourCount(hand, parseCard(a).c, a) ? b : a));
      return withCall(shape(state, seat, card, 'play', sharp), state, seat, true);
    }
  }
  if (pend.kind === 'd4' && (sharp ? guiltOdds(state, seat, pend) > 0.22 : suspect(state, pend.seat))) return { type: 'challenge' };
  return { type: 'draw' };
}

/** Drew a card that fits: play it, unless it's a Four it may not play, or a 0 or a 7 that would cost more than it sheds. */
function afterDraw(state, seat, sharp) {
  const card = /** @type {string} */ (state.drawn);
  const hand = state.hands[seat];
  const rest = hand.filter((id) => id !== card);
  if (!fits(state, card)) return { type: 'pass' };
  if (parseCard(card).f === 'd4' && !fourIsLegal(rest, state.colour)) return { type: 'pass' };
  if (score(state, seat, card, rest, sharp) <= 0) return { type: 'pass' };
  return withCall(shape(state, seat, card, 'play', sharp), state, seat, true);
}

/**
 * The cards worth playing now, best first, with their scores (identical twins once; a Four only when
 * it may be played). Ties go to the card earlier in hand order.
 * @returns {{ card: string, score: number }[]}
 */
function ranked(state, seat, sharp) {
  const hand = state.hands[seat];
  /** @type {{ card: string, score: number }[]} */
  const out = [];
  for (const card of sortHand(hand)) {
    if (!fits(state, card)) continue;
    if (out.some((o) => identical(o.card, card))) continue;
    const rest = hand.filter((id) => id !== card);
    if (parseCard(card).f === 'd4' && !fourIsLegal(rest, state.colour)) continue;
    const s = score(state, seat, card, rest, sharp);
    if (s > 0) out.push({ card, score: s });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * What playing `card` is worth (above 0: better than drawing). Shedding a card is the point (10);
 * then: staying in a colour the hand can follow, keeping a wild for when nothing else fits, hitting
 * the next player when they're close to going out, dumping points when anyone is.
 * @param {State} state  @param {number} seat  @param {string} card  @param {string[]} rest  @param {boolean} sharp
 */
const KS = { skipFar: 2, d2Far: 3, revFar: 1, pts: 0, wildLow: 0, ...JSON.parse(globalThis.process?.env?.YKSI_KS ?? '{}') };
function score(state, seat, card, rest, sharp) {
  const { c, f } = parseCard(card);
  const n = state.players;
  const next = nextSeat(seat, n, state.dir);
  const prev = nextSeat(seat, n, -state.dir);
  const nextCount = state.hands[next].length;
  const close = nextCount <= 2;
  let danger = 99;
  for (let s = 0; s < n; s++) if (s !== seat) danger = Math.min(danger, state.hands[s].length);
  let v = 10;
  // Staying in a colour: the journeyman's weight; the master's is lighter (measured on duplicate
  // deals, 2026-10-20: it leaves the other cards' jobs a say).
  const stay = sharp ? 2 : 2.5;
  if (c === 'w') {
    // The wild names the colour the rest holds most; until nothing else fits it's worth more kept.
    v += stay * bestCount(rest);
    if (rest.length > 1) v -= f === 'wild' ? 9 : 5;
  } else {
    v += stay * colourCount(rest, c, null);
    // Into a colour the next player lacks (they drew on it): the master remembers.
    if (sharp && state.lacked[next].includes(c)) v += close ? 10 : 6;
  }
  // The cards that hurt the next player: more when they're about to go out. The master keeps its
  // Four for that (it may not be playable later, but it's worth most then).
  if (f === 'skip') v += close ? 9 : sharp ? KS.skipFar : 2;
  else if (f === 'rev') v += n === 2 ? (close ? 9 : sharp ? KS.skipFar : 2) : state.hands[prev].length <= 2 ? -6 : sharp ? KS.revFar : 1;
  else if (f === 'd2') v += close ? 13 : sharp ? KS.d2Far : 4;
  if (sharp) v += KS.pts * points(card) / 20;
  if (sharp && c === 'w' && rest.length <= 2) v -= KS.wildLow;
  else if (f === 'd4') v += close ? 15 : sharp ? -4 : 3;
  // Someone is about to go out: what's left in hand will count for them, so the expensive go first.
  if (danger <= 2) v += points(card) / (sharp ? 3 : 6);
  if (state.rules.sevenZero && rest.length) {
    if (f === '7') v += 3 * (rest.length - state.hands[swapTarget(state, seat)].length);
    // A 0: this seat gets the previous player's hand and gives its own to the next.
    if (f === '0') v += 2 * (rest.length - state.hands[prev].length) - (rest.length <= 2 ? 6 : 0);
  }
  return v;
}

/** A move for `card`: the colour for a wild, the seat for a 7 under sevenZero. */
function shape(state, seat, card, type, sharp, r) {
  const { c, f } = parseCard(card);
  const rest = state.hands[seat].filter((id) => id !== card);
  /** @type {Move} */
  const move = { type, card };
  if (!rest.length) return move;
  if (c === 'w') move.colour = r && r() < 0.5 ? COLOURS[Math.floor(r() * 4)] : favourite(state, seat, rest, sharp);
  if (f === '7' && state.rules.sevenZero) move.swap = swapTarget(state, seat);
  return move;
}

/** "Yksi!" with the second-to-last card (when `say`). */
function withCall(move, state, seat, say) {
  if (say && (move.type === 'play' || move.type === 'jump') && state.hands[seat].length === 2) move.call = true;
  return move;
}

/**
 * The colour to name: the one `rest` holds most (by count, then points: the expensive ones get a
 * colour to go on); the master also likes one the next player lacks. With no colour in hand, the
 * one the next lacks, else the one most played already (fewest left for the others).
 */
function favourite(state, seat, rest, sharp) {
  const next = nextSeat(seat, state.players, state.dir);
  const lacks = state.lacked[next];
  let best = COLOURS[0];
  let top = -Infinity;
  const coloured = rest.some((id) => parseCard(id).c !== 'w');
  for (const c of COLOURS) {
    let v;
    if (coloured) {
      v = 0;
      for (const id of rest) {
        const p = parseCard(id);
        if (p.c === c) v += 10 + points(id) / 10;
      }
      if (sharp && lacks.includes(c)) v += 6;
    } else {
      v = (lacks.includes(c) ? 100 : 0) + state.pile.reduce((k, id) => k + (parseCard(id).c === c ? 1 : 0), 0);
    }
    if (v > top) {
      top = v;
      best = c;
    }
  }
  return best;
}

/** Whom a 7 swaps with: the fewest cards (the first of them in the direction of play). */
function swapTarget(state, seat) {
  let best = -1;
  for (let k = 1; k < state.players; k++) {
    const s = nextSeat(seat, state.players, k * state.dir);
    if (best < 0 || state.hands[s].length < state.hands[best].length) best = s;
  }
  return best;
}

/** The journeyman's challenge: the Four's player has been caught bluffing at least half the times they were challenged. */
function suspect(state, against) {
  const rec = state.fours[against];
  return rec.guilty >= 1 && rec.guilty * 2 >= rec.challenged;
}

/**
 * The master's odds that a Four was a bluff: that a hand of its size, dealt from the cards this seat
 * can't see, holds the colour that was in play (less likely if its player drew on that colour), times
 * how often that player plays a Four regardless (from their record; about a third with none).
 */
function guiltOdds(state, seat, pend) {
  const before = /** @type {Colour} */ (pend.before);
  const size = state.hands[pend.seat].length;
  const unseen = DECK.length - state.hands[seat].length - state.pile.length;
  let of = 25;
  for (const id of state.hands[seat]) if (parseCard(id).c === before) of -= 1;
  for (const id of state.pile) if (parseCard(id).c === before) of -= 1;
  let none = 1;
  for (let i = 0; i < size; i++) none *= Math.max(0, unseen - of - i) / Math.max(1, unseen - i);
  let hold = 1 - none;
  if (state.lacked[pend.seat].includes(before)) hold *= 0.35;
  const rec = state.fours[pend.seat];
  const bluffs = (rec.guilty + 0.7) / (rec.challenged + 2);
  return hold * bluffs;
}

/** How many of `hand` (but `skip`) are of colour `c`. */
function colourCount(hand, c, skip) {
  let k = 0;
  for (const id of hand) if (id !== skip && parseCard(id).c === c) k += 1;
  return k;
}
/** The most cards of one colour in `hand`. */
function bestCount(hand) {
  let best = 0;
  for (const c of COLOURS) best = Math.max(best, colourCount(hand, c, null));
  return best;
}

// ---- the apprentice -------------------------------------------------------------------------------

function apprentice(state, seat) {
  const r = seeded(`apprentice|${seat}|${sight(state, seat)}`);
  const hand = state.hands[seat];
  if (state.colour === null) return { type: 'colour', colour: r() < 0.5 ? COLOURS[Math.floor(r() * 4)] : favourite(state, seat, hand, false) };
  const say = r() >= 0.25;
  const pend = state.pending;
  if (pend) {
    // Never a challenge; a stack when a card does, most times.
    const own = sortHand(hand.filter((id) => parseCard(id).f === pend.kind));
    if (state.rules.stack && own.length && r() < 0.7) return withCall(shape(state, seat, own[0], 'play', false, r), state, seat, say);
    return { type: 'draw' };
  }
  if (state.drawn) return withCall(shape(state, seat, state.drawn, 'play', false, r), state, seat, say);
  const fit = sortHand(hand.filter((id) => fits(state, id)));
  if (!fit.length) return { type: 'draw' };
  // Every other card any card that fits, a Four too, whether it may or not.
  if (r() < 0.5) return withCall(shape(state, seat, fit[Math.floor(r() * fit.length)], 'play', false, r), state, seat, say);
  const move = decide(state, seat, false);
  if (move.type === 'play' && 'call' in move && !say) delete move.call;
  return move;
}

// ---- the master -----------------------------------------------------------------------------------

function master(state, seat) {
  const own = decide(state, seat, true);
  const choices = candidates(state, seat, own);
  if (choices.length < 2) return own;
  const r = seeded(`master|${seat}|${sight(state, seat)}|${state.pile.join(',')}`);
  const randomInt = (n) => Math.floor(r() * n);
  // Each choice against its own sense's (choices[0]) in the same worlds: the differences, and their spread.
  const diff = choices.map(() => 0);
  const square = choices.map(() => 0);
  const until = Date.now() + MASTER_MS;
  let spent = 0;
  let deals = 0;
  while (deals < DEALS.max) {
    const world = imagine(state, seat, r);
    const base = trial(world, seat, choices[0], randomInt);
    spent += base.plies;
    for (let i = 1; i < choices.length; i++) {
      const t = trial(world, seat, choices[i], randomInt);
      const d = t.value - base.value;
      diff[i] += d;
      square[i] += d * d;
      spent += t.plies;
    }
    deals += 1;
    if (deals >= DEALS.min && spent >= PLAYS) break;
    if (Date.now() > until) break;
  }
  // The trials are noisy (a round won is worth a hundred points, one lost a few): another choice wins
  // only when it's clearly better than the master's own, by Z standard errors.
  let best = 0;
  let margin = 0;
  for (let i = 1; i < choices.length; i++) {
    const mean = diff[i] / deals;
    const sd = Math.sqrt(Math.max(0, square[i] / deals - mean * mean));
    const edge = mean - Z * sd / Math.sqrt(deals);
    if (edge > margin) {
      best = i;
      margin = edge;
    }
  }
  return choices[best];
}

/**
 * The choices a master weighs: its own move, then the next best few plays by its sense (a wild with
 * each of its two favourite colours), drawing (or keeping the drawn card), and now and then a Four
 * it may not play (a bluff) on a next player about to go out. A colour to name and a challenge are
 * decided by sense and odds alone.
 * @param {State} state  @param {number} seat  @param {Move} own
 * @returns {Move[]}
 */
function candidates(state, seat, own) {
  if (state.colour === null || own.type === 'challenge') return [own];
  const hand = state.hands[seat];
  /** @type {Move[]} */
  const out = [own];
  const add = (/** @type {Move} */ m) => {
    if (!out.some((o) => sameMove(o, m))) out.push(m);
  };
  const pend = state.pending;
  if (pend) {
    if (!state.rules.stack) return out;
    for (const card of sortHand(hand.filter((id) => parseCard(id).f === pend.kind))) {
      if (pend.kind === 'd4' && !fourIsLegal(hand.filter((x) => x !== card), state.colour)) continue;
      add(withCall(shape(state, seat, card, 'play', true), state, seat, true));
    }
    add({ type: 'draw' });
    return out.slice(0, CHOICES + 1);
  }
  if (state.drawn) {
    const card = state.drawn;
    const rest = hand.filter((x) => x !== card);
    if (parseCard(card).f !== 'd4' || fourIsLegal(rest, state.colour) || bluffing(state, seat)) add(withCall(shape(state, seat, card, 'play', true), state, seat, true));
    add({ type: 'pass' });
    return out;
  }
  for (const { card } of ranked(state, seat, true)) {
    if (out.length >= CHOICES) break;
    const move = withCall(shape(state, seat, card, 'play', true), state, seat, true);
    add(move);
    if (parseCard(card).c === 'w' && move.colour) {
      const rest = hand.filter((id) => id !== card);
      const second = COLOURS.filter((c) => c !== move.colour).sort((a, b) => colourCount(rest, b, null) - colourCount(rest, a, null))[0];
      add({ ...move, colour: second });
    }
  }
  const four = hand.find((id) => parseCard(id).f === 'd4');
  if (four && !fourIsLegal(hand.filter((x) => x !== four), state.colour) && bluffing(state, seat)) add(withCall(shape(state, seat, four, 'play', true), state, seat, true));
  add({ type: 'draw' });
  return out.slice(0, CHOICES + 1);
}

/** A bluff is weighed now and then (one time in two): only on a next player close to going out. */
function bluffing(state, seat) {
  const next = nextSeat(seat, state.players, state.dir);
  return state.hands[next].length <= 2 && seeded(`bluff|${seat}|${sight(state, seat)}`)() < 0.5;
}

const sameMove = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * One way the round could lie, as this seat can know it: the cards it can't see (not in its hand,
 * not on the pile) dealt to the others by their counts (a seat that drew on a colour gets none of it
 * while the cards allow; a hand it was shown keeps what's left of it), the rest as the stock. Every
 * hidden fact is set from these cards: whether a waiting Four was a bluff, too
 * (learnings/projects/stammtisch.md).
 * @param {State} state  @param {number} seat  @param {() => number} r
 * @returns {State}
 */
function imagine(state, seat, r) {
  const known = new Set([...state.hands[seat], ...state.pile]);
  const unseen = DECK.filter((id) => !known.has(id));
  /** @type {Map<number, number>} */
  const need = new Map();
  for (let s = 0; s < state.players; s++) if (s !== seat) need.set(s, state.hands[s].length);
  /** @type {Map<number, string[]>} */
  const must = new Map();
  if (state.peek?.seat === seat && need.has(state.peek.from)) must.set(state.peek.from, state.peek.hand.filter((id) => !known.has(id)));
  const { hands, rest } = dealOut(unseen, need, (s, id) => !state.lacked[s].includes(/** @type {Colour} */ (parseCard(id).c)), r, must);
  const pend = state.pending;
  return {
    ...state,
    hands: state.hands.map((h, s) => (s === seat ? [...h] : /** @type {string[]} */ (hands.get(s)))),
    stock: rest,
    pile: [...state.pile],
    // The Four's player is never this seat (its victim is the seat in turn).
    pending: pend && { ...pend, ...(pend.kind === 'd4' ? { guilty: !fourIsLegal(/** @type {string[]} */ (hands.get(pend.seat)), pend.before ?? null) } : {}) },
    peek: null,
    totals: [...state.totals],
    history: [],
    lacked: state.lacked.map((l) => [...l]),
    fours: state.fours.map((f) => ({ ...f })),
    opening: [],
    rules: { ...state.rules, target: 0 },
  };
}

/**
 * Plays `choice` in a copy of `world`, then the master's own sense (no search) for everyone to the
 * round's end. Its sense rather than the journeyman's, even against journeymen: the better play in
 * the trials judged the choices better (duplicate deals, 2026-10-20: +8.0 against +5.3 a seat and
 * round at four players).
 */
function trial(world, seat, choice, randomInt) {
  const s = copy(world);
  act(s, seat, choice, { randomInt });
  let plies = 1;
  const cap = HORIZON ? HORIZON * s.players : ROLLOUT_CAP;
  while (s.phase === 'play' && plies < cap) {
    const t = s.turn;
    act(s, t, decide(s, t, true), { randomInt });
    plies += 1;
  }
  return { value: worth(s, seat), plies };
}

/**
 * What a trial round brought this seat against the others on average: what it won; or, when someone
 * else went out, minus its own cards' points shared among the others (they count for one of them).
 * A round cut short is judged by the cards held against the others'.
 */
function worth(s, seat) {
  const n = s.players;
  if (s.phase !== 'play') {
    if (s.winner === seat) return /** @type {any} */ (s.result).points[seat];
    return -handPoints(s.hands[seat]) / (n - 1);
  }
  let others = 0;
  for (let k = 0; k < n; k++) if (k !== seat) others += s.hands[k].length;
  return CARD * (others / (n - 1) - s.hands[seat].length);
}

/** A copy of a state deep enough for act() to change freely. */
function copy(s) {
  return {
    ...s,
    hands: s.hands.map((h) => [...h]),
    stock: [...s.stock],
    pile: [...s.pile],
    totals: [...s.totals],
    history: [...s.history],
    lacked: [...s.lacked],
    fours: s.fours.map((f) => ({ ...f })),
  };
}

// ---- shared ---------------------------------------------------------------------------------------

/** What `seat` sees, as a key for its random draws: its view (nothing hidden is in it). */
const sight = (state, seat) => JSON.stringify(view(state, seat));

/**
 * A repeatable random number generator for one decision, seeded by a key the bot builds from what
 * its seat sees, so the same position always gives the same move (Stammtisch's).
 * @param {string} key
 */
export function seeded(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates in place, with a seeded generator. @template T @param {T[]} cards @param {() => number} r */
function shuffle(cards, r) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

/**
 * One way the unseen cards could lie (Stammtisch's): each seat in `need` gets as many as it needs,
 * first the cards it's known to hold (`must`), then from the shuffled rest only cards `fits(seat,
 * card)` allows; when the cards can't honour every rule, any will do. The most constrained seats are
 * dealt first. What's left over is returned too, in its shuffled order.
 * @param {string[]} unseen  @param {Map<number, number>} need  @param {(seat: number, card: string) => boolean} fits
 * @param {() => number} r  @param {Map<number, string[]>} [must]
 */
function dealOut(unseen, need, fits, r, must = new Map()) {
  /** @type {(string | null)[]} */
  const pool = shuffle([...unseen], r);
  /** @type {Map<number, string[]>} */
  const hands = new Map([...need.keys()].map((s) => [s, []]));
  for (const [seat, cards] of must) {
    const hand = hands.get(seat);
    if (!hand) continue;
    for (const id of cards) {
      const k = pool.indexOf(id);
      if (k >= 0 && hand.length < /** @type {number} */ (need.get(seat))) {
        hand.push(id);
        pool[k] = null;
      }
    }
  }
  const ruled = (seat) => pool.reduce((n, id) => n + (id !== null && !fits(seat, id) ? 1 : 0), 0);
  const order = [...need.keys()].sort((a, b) => ruled(b) - ruled(a) || a - b);
  for (const pass of [true, false]) {
    for (const seat of order) {
      const hand = /** @type {string[]} */ (hands.get(seat));
      const want = /** @type {number} */ (need.get(seat));
      for (let k = 0; k < pool.length && hand.length < want; k++) {
        const id = pool[k];
        if (id !== null && (!pass || fits(seat, id))) {
          hand.push(id);
          pool[k] = null;
        }
      }
    }
  }
  return { hands, rest: /** @type {string[]} */ (pool.filter((id) => id !== null)) };
}

/** A random legal move for the seat in turn (the ladder's and the tests' scale): plays most of the time. */
export function randomMove(state, seat, randomInt) {
  if (state.phase === 'scored') return { type: 'next' };
  if (state.phase !== 'play' || seat !== state.turn) return null;
  const all = [];
  if (state.colour === null) return { type: 'colour', colour: COLOURS[randomInt(4)] };
  const hand = state.hands[seat];
  for (const card of hand) if ((!state.drawn || card === state.drawn) && fits(state, card)) all.push(card);
  if (all.length && randomInt(5)) return withCall(shape(state, seat, all[randomInt(all.length)], 'play', false, () => randomInt(1000) / 1000), state, seat, randomInt(2) === 0);
  if (state.pending?.kind === 'd4' && randomInt(2)) return { type: 'challenge' };
  return state.drawn ? { type: 'pass' } : { type: 'draw' };
}

/** For tests and tools/ladder.mjs: the journeyman's move with the master's sense but no search. */
export const _sense = (state, seat) => decide(state, seat, true);
