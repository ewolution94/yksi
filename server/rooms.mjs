// The rooms: tables with a code, seats, the host, the lobby's settings, and the match being played.
// No I/O: the HTTP layer (server/api.mjs) calls these functions and streams each page its view;
// tests drive it with a fake clock. Adapted from Würfle's server/rooms.mjs (itself Stammtisch's and
// Stichle's): the codes, the seats, the host's seat moving on, bots, the clock per move and the
// housekeeping are the same; the game is Yksi's (server/rules.mjs), round after round to the target.
//
// A room lives in memory only. A restart (a deploy) ends every game, and an empty room is forgotten
// after half an hour.
//
// Phases: lobby → play (rounds; between two, the result waits for everyone's "next") → final.
//
// Hands are secret: every page gets the rules' view for its own seat (your hand, nobody else's), a
// watcher the view of nobody's. Out of turn, anyone may call "Yksi!" for themselves or catch someone
// who didn't; bots do it too, after a moment that depends on their rank.

import { randomBytes, randomInt as cryptoInt } from 'node:crypto';
import { cleanAvatar, randomAvatar } from './avatar.mjs';
import { botMove, botReflex, LEVELS } from './bots.mjs';
import { PLAYERS, RuleError, act as ruleAct, cleanRules, createGame, moves as ruleMoves, RULES, standings, totals, view as ruleView } from './rules.mjs';

export class GameError extends Error {
  /** @param {string} code  @param {number} [status]  @param {Record<string, unknown>} [detail] */
  constructor(code, status = 400, detail = undefined) {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/** Room codes have no vowels, so no code spells a word. */
const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
export const CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/;

/** A clock per move: off, relaxed (60 s) or quick (25 s). When it runs out, the bot finishes your turn. */
export const CLOCKS = Object.freeze(['off', 'relaxed', 'quick']);
export const MOVE_SECONDS = Object.freeze({ relaxed: 60, quick: 25 });

export const DEFAULT_SETTINGS = Object.freeze({ clock: 'off', bots: 'journeyman' });

export const LIMITS = {
  rooms: 200,
  players: 20,
  /** At the table: the rules' ten. */
  seats: PLAYERS.max,
  name: 16,
  roomsPer10Min: 40,
};

/** A seated player who's gone (closed the page) for this long on their turn: the bot plays it for them. */
export const AWAY_MS = 12_000;
/** A card in the air: bots wait for it to land on everyone's page before the next one. */
export const PLAY_SHOW = 450;
/** A round's result waits this long for everyone's "next", then the next round comes anyway. */
export const ROUND_WAIT = 25_000;
/**
 * How long a bot takes to notice a missing call (or its own), by rank: between these many
 * milliseconds. People get the same window; the next player's move closes it.
 */
export const REFLEX = Object.freeze({ apprentice: [2200, 3600], journeyman: [1300, 2400], master: [700, 1400] });

const HOST_GRACE = 15_000;
const LOBBY_GRACE = 60_000;
const EMPTY_TTL = 30 * 60_000;
/** A game with no human online for this long ends, so bots never play on for no one. */
const UNWATCHED_MS = 2 * 60_000;
const IDLE_TTL = 4 * 60 * 60_000;
/** Bots think for a moment: between these many milliseconds. */
const BOT_THINK = [650, 1250];
/** Someone sits at one card without the call: the next bot waits this long before it moves, so a person can catch them. */
export const CATCH_WINDOW = 1800;
/** How many of the table's last events each view carries (who played what, who drew …). */
const EVENTS_KEPT = 24;

const BOT_NAMES = ['Aino', 'Eero', 'Lumi', 'Otso', 'Ilona', 'Kalle', 'Saga', 'Veikko', 'Helmi'];

/**
 * @typedef {{ now(): number, setTimeout(fn: () => void, ms: number): any, clearTimeout(handle: any): void }} Clock
 * @typedef {{ player: string | null, send(event: string, data: string): void }} Subscriber
 */

const realClock = { now: Date.now, setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h) };

/**
 * @param {{ clock?: Clock, randomInt?: (n: number) => number }} [options]
 *   randomInt shuffles and deals (tests pass a seeded one)
 */
export function createRooms({ clock = realClock, randomInt = (n) => cryptoInt(n) } = {}) {
  /** @type {Map<string, any>} */
  const rooms = new Map();
  const created = [];
  const random = () => randomInt(1_000_000) / 1_000_000;

  // ---- helpers ------------------------------------------------------------------------------

  function room(code) {
    const r = rooms.get(String(code ?? '').toUpperCase());
    if (!r) throw new GameError('no-room', 404);
    return r;
  }

  // A page's retry is the same request: "New table" and a join carry a key the page keeps for
  // every try of the same tap, so a retry after the page gave up returns the seat the first try made
  // (development/plans/waiting-states.md). Kept for a minute.
  /** @type {Map<string, { seat: { code: string, player: string, token: string }, at: number }>} */
  const keyed = new Map();
  const KEY = /^[A-Za-z0-9-]{8,64}$/;
  const KEY_TTL = 60_000;

  function keyedSeat(key, code = null) {
    if (typeof key !== 'string' || !KEY.test(key)) return null;
    const t = clock.now();
    for (const [k, v] of keyed) if (t - v.at > KEY_TTL) keyed.delete(k);
    const hit = keyed.get(key);
    if (!hit || (code && hit.seat.code !== code)) return null;
    const p = rooms.get(hit.seat.code)?.players.get(hit.seat.player);
    return p && !p.left ? { ...hit.seat } : null;
  }

  function remember(key, seat) {
    if (typeof key === 'string' && KEY.test(key)) keyed.set(key, { seat, at: clock.now() });
    return seat;
  }

  function within(stamps, windowMs, limit) {
    const t = clock.now();
    while (stamps.length && stamps[0] <= t - windowMs) stamps.shift();
    if (stamps.length >= limit) return false;
    stamps.push(t);
    return true;
  }

  function newCode() {
    for (let i = 0; i < 100; i++) {
      let code = '';
      for (let j = 0; j < 4; j++) code += CODE_LETTERS[cryptoInt(CODE_LETTERS.length)];
      if (!rooms.has(code)) return code;
    }
    throw new GameError('busy', 503);
  }

  function player(r, token) {
    if (typeof token !== 'string' || !token) throw new GameError('no-player', 401);
    for (const p of r.players.values()) if (p.token === token && !p.left && !p.bot) return p;
    throw new GameError('no-player', 401);
  }

  function requireHost(r, p) {
    if (r.host !== p.id) throw new GameError('not-host', 403);
  }

  function requirePhase(r, ...phases) {
    if (!phases.includes(r.phase)) throw new GameError('wrong-phase', 409);
  }

  /** Players who are still in the room, in the order they joined. */
  const present = (r) => [...r.players.values()].filter((p) => !p.left);
  const isOnline = (p) => p.bot || p.online > 0;
  /** The players at the table, in seat order (the lobby's order; fixed once a game starts). */
  const seated = (r) => r.order.map((id) => r.players.get(id)).filter((p) => p && !p.left);

  function addPlayer(r, rawName, rawAvatar, bot = false) {
    if (present(r).length >= LIMITS.players) throw new GameError('room-full', 409);
    const base = cleanName(rawName);
    if (!base) throw new GameError('name');
    const taken = new Set(present(r).map((p) => p.name.toLowerCase()));
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    const p = {
      id: randomBytes(6).toString('base64url'),
      token: bot ? '' : randomBytes(18).toString('base64url'),
      name,
      avatar: cleanAvatar(rawAvatar, random),
      bot,
      // A bot's rank: the table's, until the host gives it its own.
      ...(bot ? { level: r.settings.bots ?? 'journeyman' } : {}),
      joined: clock.now(),
      online: 0,
      offlineSince: clock.now(),
      left: false,
    };
    r.players.set(p.id, p);
    // A free chair in the lobby is yours; past ten, or once the cards are out, you watch.
    if (r.phase === 'lobby' && seated(r).length < LIMITS.seats) r.order.push(p.id);
    return p;
  }

  function touch(r) {
    r.touched = clock.now();
    r.version++;
    broadcast(r);
  }

  function later(r, ms, fn) {
    const handle = clock.setTimeout(() => {
      r.timers.delete(handle);
      if (rooms.get(r.code) === r) fn();
    }, ms);
    r.timers.add(handle);
    return handle;
  }

  function clearTimers(r) {
    for (const handle of r.timers) clock.clearTimeout(handle);
    r.timers.clear();
  }

  /** A refusal from the rules, as the game's own error. */
  function rule(fn) {
    try {
      return fn();
    } catch (error) {
      if (error instanceof RuleError) throw new GameError(error.code, 409);
      throw error;
    }
  }

  // ---- the match ----------------------------------------------------------------------------

  function startGame(r) {
    const players = seated(r);
    if (players.length < PLAYERS.min) throw new GameError('too-few', 409, { min: PLAYERS.min });
    if (players.length > PLAYERS.max) throw new GameError('too-many', 409, { max: PLAYERS.max });
    // The first dealer is drawn by lot; after that the deal goes round.
    const state = rule(() => createGame({ players: players.length, rules: r.rules, dealer: randomInt(players.length), randomInt }));
    r.game = {
      n: ++r.games,
      seats: players.map((p) => p.id),
      state,
      /** Bots wait until the last card has landed on everyone's page. */
      holdUntil: 0,
      /** A seat whose clock ran out: the bot plays the rest of this turn for it. */
      autopilot: -1,
      endsAt: null,
      /** Between rounds: who has tapped on, and when the next round comes anyway. */
      ready: [],
      readyBy: null,
      events: [],
      seq: 0,
      /** A move counter: a timer set for one move does nothing once the game has moved on. */
      move: 0,
      startedAt: clock.now(),
      endedAt: null,
      ended: null,
      stoppedBy: null,
    };
    r.phase = 'play';
    r.notice = null;
    moved(r);
  }

  /** Keeps the table's last events, each with its number. */
  function note(g, events) {
    for (const e of events) g.events.push({ ...e, n: ++g.seq });
    if (g.events.length > EVENTS_KEPT) g.events.splice(0, g.events.length - EVENTS_KEPT);
  }

  /** After every move: the clock for the next decision, the round's end, and the bots. */
  function moved(r) {
    const g = r.game;
    g.move++;
    g.endsAt = null;
    const s = g.state;
    if (s.phase === 'scored') {
      if (g.readyBy === null) {
        g.ready = [];
        g.readyBy = clock.now() + ROUND_WAIT;
        const round = s.round;
        later(r, ROUND_WAIT, () => r.phase === 'play' && g.state.phase === 'scored' && g.state.round === round && onward(r));
      }
    } else if (s.phase === 'play') {
      g.readyBy = null;
      const seconds = MOVE_SECONDS[r.settings.clock];
      if (seconds && g.autopilot !== s.turn) {
        const move = g.move;
        const turn = s.turn;
        g.endsAt = clock.now() + seconds * 1000 + Math.max(0, g.holdUntil - clock.now());
        later(r, g.endsAt - clock.now() + 300, () => {
          if (g.move !== move || r.phase !== 'play' || g.state.turn !== turn) return;
          g.autopilot = turn;
          autoMove(r);
        });
      }
    }
    touch(r);
    if (s.phase === 'scored') readyCheck(r);
    else {
      botsPlay(r);
      reflexes(r);
    }
  }

  /** Everyone at the table who's here has tapped "next" (bots and the absent count as ready). */
  function readyCheck(r) {
    const g = r.game;
    if (g.state.phase !== 'scored') return;
    const waitingFor = g.seats.map((id) => r.players.get(id)).filter((p) => p && !p.left && !p.bot && p.online > 0 && !g.ready.includes(p.id));
    if (!waitingFor.length) onward(r);
  }

  /** The next round, dealt by the next dealer. */
  function onward(r) {
    const g = r.game;
    if (g.state.phase !== 'scored') return;
    const events = rule(() => ruleAct(g.state, 0, { type: 'next' }, { randomInt }));
    note(g, events);
    g.ready = [];
    g.readyBy = null;
    g.autopilot = -1;
    if (g.state.phase === 'done') return finish(r, 'done');
    moved(r);
  }

  /** The bot's move for the seat in turn (a bot's own, a stand-in's, or a timed-out turn). */
  function autoMove(r, only = null) {
    const g = r.game;
    const s = g.state;
    if (r.phase !== 'play' || s.phase !== 'play') return;
    const seat = s.turn;
    if (only !== null && seat !== only) return;
    const wait = g.holdUntil - clock.now();
    if (wait > 0) {
      const move = g.move;
      later(r, wait + 50, () => g.move === move && autoMove(r, only));
      return;
    }
    const move = botMove(s, seat, { level: levelOf(r, seat) });
    if (!move) return;
    playMove(r, seat, move);
  }

  /** A bot plays at its own rank; a stand-in for someone away at the table's. */
  function levelOf(r, seat) {
    const p = r.players.get(r.game.seats[seat]);
    return p?.bot ? (p.level ?? 'journeyman') : (r.settings.bots ?? 'journeyman');
  }

  /** A move by `seat` (the rules check it, turn or not: a call, a catch, a jump-in may come from anyone). */
  function playMove(r, seat, move) {
    const g = r.game;
    const s = g.state;
    if (!move || typeof move !== 'object' || typeof move.type !== 'string') throw new GameError('move');
    if (move.type === 'next') throw new GameError('move');
    const turn = s.turn;
    const events = rule(() => ruleAct(s, seat, move, { randomInt }));
    note(g, events);
    if (events.some((e) => e.type === 'play')) g.holdUntil = clock.now() + PLAY_SHOW;
    // The turn moved on: the next one is the next seat's own again.
    if (s.turn !== turn || s.phase !== 'play') g.autopilot = -1;
    if (s.phase === 'done') return finish(r, 'done');
    moved(r);
  }

  function finish(r, reason) {
    const g = r.game;
    clearTimers(r);
    g.ended = reason;
    g.endedAt = clock.now();
    g.endsAt = null;
    g.readyBy = null;
    r.phase = 'final';
    r.unwatchedSince = null;
    touch(r);
  }

  // ---- bots and the absent ------------------------------------------------------------------

  const think = () => BOT_THINK[0] + randomInt(BOT_THINK[1] - BOT_THINK[0]);
  const between = ([lo, hi]) => lo + randomInt(hi - lo);

  /** If it's a bot's turn, a timed-out turn, or the turn of someone who's gone: it's played in a moment. */
  function botsPlay(r) {
    const g = r.game;
    if (r.phase !== 'play' || !g) return;
    const s = g.state;
    if (s.phase !== 'play') return;
    const seat = s.turn;
    const move = g.move;
    const still = () => r.phase === 'play' && g.move === move;
    const p = r.players.get(g.seats[seat]);
    const window = s.open !== null && s.open !== seat ? CATCH_WINDOW : 0;
    const after = () => Math.max(think(), window, g.holdUntil - clock.now() + think() / 2);
    if (!p || p.bot || g.autopilot === seat) {
      later(r, after(), () => still() && autoMove(r, seat));
    } else if (p.left || p.online === 0) {
      const gone = p.left ? 0 : AWAY_MS - Math.min(AWAY_MS, clock.now() - (p.offlineSince ?? clock.now()));
      later(r, Math.max(gone, after()), () => still() && (p.left || p.online === 0) && autoMove(r, seat));
    }
  }

  /**
   * Out of turn: each bot looks whether it should call for itself, catch someone who didn't, or jump
   * in, and does it after its rank's reaction time, if it's still allowed then.
   */
  function reflexes(r) {
    const g = r.game;
    if (r.phase !== 'play' || !g || g.state.phase !== 'play') return;
    const move = g.move;
    g.seats.forEach((id, seat) => {
      const p = r.players.get(id);
      if (!p?.bot && !(p?.left)) return;
      const level = levelOf(r, seat);
      const want = botReflex(g.state, seat, { level });
      if (!want) return;
      later(r, between(REFLEX[level] ?? REFLEX.journeyman), () => {
        if (r.phase !== 'play' || g.move !== move || g.state.phase !== 'play') return;
        if (!ruleMoves(g.state, seat).some((m) => sameMove(m, want))) return;
        try {
          playMove(r, seat, want);
        } catch (error) {
          if (!(error instanceof GameError)) throw error;
        }
      });
    });
  }

  // ---- what each page gets ------------------------------------------------------------------

  /** @param {any} r  @param {any | null} viewer  the player whose page this is; null for a watcher */
  function view(r, viewer) {
    const me = viewer && !viewer.left ? viewer : null;
    return {
      code: r.code,
      phase: r.phase,
      version: r.version,
      host: r.host,
      me: me?.id ?? null,
      settings: { ...r.settings },
      rules: { ...r.rules },
      notice: r.notice,
      order: seated(r).map((p) => p.id),
      players: present(r).map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, online: isOnline(p), bot: p.bot, ...(p.bot ? { level: p.level ?? 'journeyman' } : {}) })),
      game: r.game ? gameView(r, r.game, me) : null,
      now: clock.now(),
    };
  }

  function gameView(r, g, me) {
    const s = g.state;
    const seat = me ? g.seats.indexOf(me.id) : -1;
    return {
      n: g.n,
      /** Player ids round the table, in seat order. */
      seats: g.seats,
      gone: g.seats.map((id) => Boolean(r.players.get(id)?.left)),
      /** Your seat, or -1: watching. */
      seat,
      /** The match as your seat may see it (your hand, nobody else's). */
      state: ruleView(s, seat >= 0 ? seat : null),
      totals: totals(s),
      standings: standings(s),
      holdUntil: g.holdUntil,
      autopilot: g.autopilot,
      ready: g.ready,
      readyBy: g.readyBy,
      events: g.events,
      endsAt: g.endsAt,
      startedAt: g.startedAt,
      endedAt: g.endedAt,
      ended: g.ended,
      stoppedBy: g.stoppedBy,
    };
  }

  function broadcast(r) {
    for (const s of r.subscribers) {
      const p = s.player ? r.players.get(s.player) : null;
      s.send('view', JSON.stringify(view(r, p)));
    }
  }

  // ---- host and housekeeping ----------------------------------------------------------------

  function handOver(r) {
    const host = r.players.get(r.host);
    if (host && !host.left && host.online > 0) return;
    const next = present(r).find((p) => !p.bot && p.online > 0);
    if (next && next.id !== r.host) {
      r.host = next.id;
      touch(r);
    }
  }

  function removePlayer(r, p) {
    if (r.phase === 'lobby') {
      r.players.delete(p.id);
      r.order = r.order.filter((id) => id !== p.id);
    } else p.left = true;
    p.online = 0;
    const people = present(r).filter((q) => !q.bot);
    if (!people.length) {
      clearTimers(r);
      rooms.delete(r.code);
      for (const s of r.subscribers) s.send('view', JSON.stringify({ code: r.code, phase: 'gone' }));
      return;
    }
    if (r.host === p.id) r.host = (people.find((q) => q.online > 0) ?? people[0]).id;
    touch(r);
    // A seat whose player left is played by the bot from now on.
    if (r.game && r.phase === 'play') {
      if (r.game.state.phase === 'scored') readyCheck(r);
      else botsPlay(r);
    }
  }

  /** At the table or watching; a full table refuses one more. */
  function setSeated(r, p, wanted) {
    const at = r.order.includes(p.id);
    if (wanted && !at) {
      if (seated(r).length >= LIMITS.seats) throw new GameError('table-full', 409);
      r.order.push(p.id);
    } else if (!wanted && at) {
      r.order = r.order.filter((id) => id !== p.id);
    }
  }

  return {
    get size() {
      return rooms.size;
    },

    /** @param {{ name: unknown, avatar?: unknown, key?: unknown }} body */
    create({ name, avatar, key }) {
      const again = keyedSeat(key);
      if (again) return again;
      if (!cleanName(name)) throw new GameError('name');
      if (rooms.size >= LIMITS.rooms || !within(created, 10 * 60_000, LIMITS.roomsPer10Min)) throw new GameError('busy', 429);
      const code = newCode();
      const r = {
        code,
        created: clock.now(),
        touched: clock.now(),
        /** Since when no human has been online during a game (null while someone is). */
        unwatchedSince: null,
        version: 0,
        host: '',
        players: new Map(),
        /** The table's seats, in playing order. */
        order: [],
        settings: { ...DEFAULT_SETTINGS },
        rules: { ...RULES },
        phase: 'lobby',
        game: null,
        games: 0,
        notice: null,
        timers: new Set(),
        subscribers: new Set(),
      };
      rooms.set(code, r);
      const p = addPlayer(r, name, avatar);
      r.host = p.id;
      return remember(key, { code, player: p.id, token: p.token });
    },

    /** A quick look before joining: does the room exist, and is it open? */
    info(code) {
      const r = rooms.get(String(code ?? '').toUpperCase());
      if (!r) return null;
      return { code: r.code, phase: r.phase, players: present(r).length, full: present(r).length >= LIMITS.players };
    },

    /**
     * Joins, or comes back: a known token gets the same seat again. A token alone that no longer
     * fits (kicked, or dropped from the lobby) is refused. `key`: a retried join gets the same seat.
     * @param {{ name?: unknown, avatar?: unknown, token?: unknown, key?: unknown }} body
     */
    join(code, { name, avatar, token, key }) {
      const r = room(code);
      const again = keyedSeat(key, r.code);
      if (again) return again;
      if (typeof token === 'string' && token) {
        for (const p of r.players.values()) {
          if (p.token === token && !p.left && !p.bot) return { code: r.code, player: p.id, token: p.token };
        }
        if (!cleanName(name)) throw new GameError('no-player', 401);
      }
      const p = addPlayer(r, name, avatar);
      touch(r);
      return remember(key, { code: r.code, player: p.id, token: p.token });
    },

    view(code, playerId = null) {
      const r = room(code);
      return view(r, playerId ? (r.players.get(playerId) ?? null) : null);
    },

    /**
     * Streams the room to one page: its view now and after every change ('view'). Returns the
     * unsubscribe function.
     * @param {(event: string, data: string) => void} send
     */
    subscribe(code, playerId, send) {
      const r = room(code);
      const p = r.players.get(String(playerId ?? ''));
      const me = p && !p.left && !p.bot ? p : null;
      /** @type {Subscriber} */
      const sub = { player: me?.id ?? null, send };
      r.subscribers.add(sub);
      if (me) {
        me.online++;
        me.offlineSince = null;
      }
      send('view', JSON.stringify(view(r, me)));
      if (me && me.online === 1) touch(r);
      return () => {
        if (!r.subscribers.delete(sub)) return;
        if (me && !me.left) {
          me.online = Math.max(0, me.online - 1);
          if (me.online === 0) {
            me.offlineSince = clock.now();
            touch(r);
            if (r.game && r.phase === 'play') {
              if (r.game.state.phase === 'scored') readyCheck(r);
              else botsPlay(r);
            }
          }
        }
      };
    },

    /**
     * A player's action. Throws GameError for anything not allowed right now.
     * @param {string} code  @param {unknown} token  @param {string} action  @param {any} body
     */
    act(code, token, action, body = {}) {
      const r = room(code);
      const p = player(r, token);
      r.touched = clock.now();
      const g = r.game;

      switch (action) {
        case 'settings': {
          requireHost(r, p);
          requirePhase(r, 'lobby', 'final');
          const next = mergeSettings(r.settings, r.rules, body);
          // The table's rank is every bot's: changing it changes theirs (a bot's own rank is set on it).
          if (next.settings.bots !== r.settings.bots) for (const q of present(r)) if (q.bot) q.level = next.settings.bots;
          r.settings = next.settings;
          r.rules = next.rules;
          touch(r);
          return;
        }
        case 'sit': {
          requirePhase(r, 'lobby', 'final');
          setSeated(r, p, body?.seated !== false);
          touch(r);
          return;
        }
        case 'move': {
          // In a game: a move for your seat (the rules check it, your turn or not). In the lobby: the
          // host seats anyone, or sends them to watch.
          if (r.phase === 'play') {
            const seat = g.seats.indexOf(p.id);
            if (seat < 0) throw new GameError('not-playing', 409);
            if (g.state.phase !== 'play') throw new GameError('wrong-phase', 409);
            // Playing your turn yourself again takes it back from the bot; out of turn, anything goes.
            if (g.autopilot === seat && g.state.turn === seat) throw new GameError('autopilot', 409);
            playMove(r, seat, body?.move);
            return;
          }
          requireHost(r, p);
          requirePhase(r, 'lobby', 'final');
          const target = r.players.get(String(body?.player ?? ''));
          if (!target || target.left) throw new GameError('no-player', 404);
          setSeated(r, target, body?.seated !== false);
          touch(r);
          return;
        }
        case 'next': {
          // Done looking at the round's result.
          requirePhase(r, 'play');
          if (g.state.phase !== 'scored') throw new GameError('wrong-phase', 409);
          if (!g.ready.includes(p.id)) g.ready.push(p.id);
          touch(r);
          readyCheck(r);
          return;
        }
        case 'order': {
          // The host's playing order: the seated players' ids in their new order (a drag in the lobby).
          requireHost(r, p);
          requirePhase(r, 'lobby', 'final');
          const ids = Array.isArray(body?.order) ? body.order.map(String) : [];
          const now = seated(r).map((q) => q.id);
          if (ids.length !== now.length || new Set(ids).size !== ids.length || !ids.every((id) => now.includes(id))) throw new GameError('order');
          r.order = ids;
          touch(r);
          return;
        }
        case 'shuffle': {
          requireHost(r, p);
          requirePhase(r, 'lobby', 'final');
          const order = [...r.order];
          for (let i = order.length - 1; i > 0; i--) {
            const j = randomInt(i + 1);
            [order[i], order[j]] = [order[j], order[i]];
          }
          r.order = order;
          touch(r);
          return;
        }
        case 'start': {
          requireHost(r, p);
          requirePhase(r, 'lobby');
          startGame(r);
          return;
        }
        case 'stop': {
          requireHost(r, p);
          requirePhase(r, 'play');
          g.stoppedBy = p.id;
          finish(r, 'stopped');
          return;
        }
        case 'rematch': {
          // Again: the same table straight into a new match, or back to the lobby to change it.
          requireHost(r, p);
          requirePhase(r, 'final');
          clearTimers(r);
          for (const q of [...r.players.values()]) {
            if (!q.left) continue;
            r.players.delete(q.id);
            r.order = r.order.filter((id) => id !== q.id);
          }
          r.game = null;
          r.notice = null;
          r.phase = 'lobby';
          if (body?.lobby) {
            touch(r);
            return;
          }
          try {
            startGame(r);
          } catch (error) {
            touch(r);
            throw error;
          }
          return;
        }
        case 'bot': {
          requireHost(r, p);
          requirePhase(r, 'lobby', 'final');
          const bots = present(r).filter((q) => q.bot);
          if (body?.add) {
            if (seated(r).length >= LIMITS.seats) throw new GameError('table-full', 409);
            const used = new Set(bots.map((b) => b.name));
            const name = BOT_NAMES.find((n) => !used.has(n)) ?? BOT_NAMES[0];
            const bot = addPlayer(r, name, randomAvatar(random), true);
            if (!r.order.includes(bot.id)) r.order.push(bot.id);
            touch(r);
          } else if (body?.level !== undefined) {
            // One bot's own rank.
            const target = r.players.get(String(body?.player ?? ''));
            if (!target?.bot || target.left) throw new GameError('no-player', 404);
            if (!LEVELS.includes(body.level)) throw new GameError('level');
            target.level = body.level;
            touch(r);
          } else {
            const target = body?.player ? r.players.get(String(body.player)) : bots.at(-1);
            if (target?.bot) {
              r.players.delete(target.id);
              r.order = r.order.filter((id) => id !== target.id);
              touch(r);
            }
          }
          return;
        }
        case 'avatar': {
          p.avatar = cleanAvatar(body?.avatar, random);
          touch(r);
          return;
        }
        case 'kick': {
          requireHost(r, p);
          const target = r.players.get(String(body?.player ?? ''));
          if (!target || target.left || target.id === p.id) throw new GameError('no-player', 404);
          removePlayer(r, target);
          return;
        }
        case 'leave': {
          removePlayer(r, p);
          return;
        }
        default:
          throw new GameError('unknown-action', 404);
      }
    },

    /**
     * Housekeeping, every few seconds: hand the host's seat on, drop people who closed the page in
     * the lobby, end a game nobody is watching, forget empty rooms, and catch a lost clock.
     */
    tick() {
      const now = clock.now();
      for (const r of rooms.values()) {
        const online = present(r).filter((p) => !p.bot && p.online > 0);
        if ((!online.length && now - r.touched > EMPTY_TTL) || now - r.touched > IDLE_TTL) {
          clearTimers(r);
          for (const s of r.subscribers) s.send('view', JSON.stringify({ code: r.code, phase: 'gone' }));
          rooms.delete(r.code);
          continue;
        }
        if (r.phase === 'play') {
          if (online.length) r.unwatchedSince = null;
          else {
            r.unwatchedSince ??= now;
            if (now - r.unwatchedSince >= UNWATCHED_MS) {
              r.unwatchedSince = null;
              finish(r, 'left');
              continue;
            }
          }
          const g = r.game;
          if (g.endsAt && now >= g.endsAt + 2000 && g.state.phase === 'play') {
            g.autopilot = g.state.turn;
            autoMove(r);
          }
          if (g.readyBy && now >= g.readyBy + 2000 && g.state.phase === 'scored') onward(r);
        }
        const host = r.players.get(r.host);
        if (host && host.online === 0 && host.offlineSince !== null && now - host.offlineSince >= HOST_GRACE) handOver(r);
        if (r.phase === 'lobby') {
          for (const p of present(r)) {
            if (!p.bot && p.id !== r.host && p.online === 0 && p.offlineSince !== null && now - p.offlineSince >= LOBBY_GRACE) removePlayer(r, p);
          }
        }
      }
    },

    /** Stops every timer (shutdown, tests). */
    close() {
      for (const r of rooms.values()) {
        clearTimers(r);
        r.subscribers.clear();
      }
      rooms.clear();
    },
  };
}

/** Whether two moves are the same decision (a reflex still on offer when its moment comes). */
function sameMove(a, b) {
  return a.type === b.type && (a.card ?? null) === (b.card ?? null);
}

/**
 * A display name: printable, single-spaced, at most LIMITS.name characters (graphemes, so an emoji
 * counts as one). Empty when nothing usable is left.
 */
export function cleanName(raw) {
  return cleanText(raw, LIMITS.name);
}

/** Printable, single-spaced text of at most `max` graphemes. */
export function cleanText(raw, max) {
  if (typeof raw !== 'string') return '';
  const text = raw
    .slice(0, max * 8)
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Co}\p{Cn}]|(?!‍)\p{Cf}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const graphemes = [...new Intl.Segmenter('de', { granularity: 'grapheme' }).segment(text)].map((s) => s.segment);
  return graphemes.slice(0, max).join('').trim();
}

/**
 * The settings and house rules with a host's changes applied; anything invalid is ignored.
 * body: { clock?, bots?, rules?: { stack?, jumpIn?, sevenZero?, drawToPlay?, target? } }
 */
export function mergeSettings(settings, rules, body) {
  const next = { ...settings };
  if (CLOCKS.includes(body?.clock)) next.clock = body.clock;
  if (LEVELS.includes(body?.bots)) next.bots = body.bots;
  let out = { ...rules };
  if (body?.rules && typeof body.rules === 'object') {
    try {
      out = { ...cleanRules({ ...rules, ...body.rules }) };
    } catch {
      // an invalid value: the rules stay as they were
    }
  }
  return { settings: next, rules: out };
}
