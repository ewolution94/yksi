// A game against bots, all in the page: the rules and the bots (server/rules.mjs, server/bots.mjs) run
// here, so it plays with no server and works offline (the service worker keeps the page). The game is
// kept on the device as it goes (`yksi:solo`), so a reload or a locked phone carries on where it was;
// finished games go into the record (`yksi:record`): games played and won, for the start page. From
// Würfle's src/lib/solo.svelte.ts; the bots' timing is the rooms' (server/rooms.mjs).

import { act, createGame, moves, standings, totals, view as ruleView } from '../../server/rules.mjs';
import { botMove, botReflex } from '../../server/bots.mjs';
import type { Level, MatchState, Move, Rules, TableEvent } from './api';
import { randomAvatar, type Avatar } from './avatar';
import type { Driver, MatchView, Person } from './match';

const GAME = 'yksi:solo';
const RECORD = 'yksi:record';
/** As on the server (server/rooms.mjs): a card lands before a bot moves on; bots think a moment. */
const PLAY_SHOW = 450;
const BOT_THINK = [650, 1250];
/** Someone sits at one card without the call: the next bot waits this long, so you can catch them. */
const CATCH_WINDOW = 1800;
const REFLEX: Record<Level, [number, number]> = { apprentice: [2200, 3600], journeyman: [1300, 2400], master: [700, 1400] };
const EVENTS_KEPT = 24;
export const BOT_NAMES = ['Aino', 'Eero', 'Lumi', 'Otso', 'Ilona', 'Kalle', 'Saga', 'Veikko', 'Helmi'];

export interface SoloSetup {
  /** How many bots at the table (1 to 9). */
  bots: number;
  level: Level;
  rules: Rules;
}

export interface SoloRecord {
  played: number;
  won: number;
}

interface Saved {
  setup: SoloSetup;
  people: Person[];
  state: unknown;
  events: TableEvent[];
  seq: number;
  id: string;
}

/** A fair random integer below n from the browser's crypto, without modulo bias. */
function randomInt(n: number) {
  const a = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;
  do crypto.getRandomValues(a);
  while (a[0] >= limit);
  return a[0] % n;
}

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // not kept
  }
}

export const record = $state<SoloRecord>(read<SoloRecord>(RECORD) ?? { played: 0, won: 0 });

/** A solo game left unfinished on this device, if any. */
export const savedSolo = () => {
  const s = read<Saved>(GAME);
  const phase = (s?.state as { phase?: string } | undefined)?.phase;
  return s && (phase === 'play' || phase === 'scored') ? s : null;
};

export class Solo implements Driver {
  view: MatchView = $state.raw(null as unknown as MatchView);
  /** This game was won. */
  won = $state(false);

  #setup: SoloSetup;
  #people: Person[];
  #state: any;
  #events: TableEvent[] = [];
  #seq = 0;
  #id: string;
  #timers = new Set<number>();
  #move = 0;
  #holdUntil = 0;
  #closed = false;

  constructor(setup: SoloSetup, me: { name: string; avatar: Avatar }, saved: Saved | null = null) {
    if (saved) {
      this.#setup = saved.setup;
      this.#people = saved.people;
      this.#state = saved.state;
      this.#events = saved.events ?? [];
      this.#seq = saved.seq ?? 0;
      this.#id = saved.id;
    } else {
      this.#setup = setup;
      this.#people = [
        { name: me.name, avatar: me.avatar, bot: false, online: true, gone: false },
        ...BOT_NAMES.slice(0, setup.bots).map((name) => ({ name, avatar: randomAvatar(), bot: true, level: setup.level, online: true, gone: false })),
      ];
      this.#state = createGame({ players: this.#people.length, rules: { ...setup.rules }, dealer: randomInt(this.#people.length), randomInt });
      this.#id = `solo:${Date.now().toString(36)}`;
    }
    this.#publish();
  }

  static resume(me: { name: string; avatar: Avatar }) {
    const saved = savedSolo();
    return saved ? new Solo(saved.setup, me, saved) : null;
  }

  get setup() {
    return this.#setup;
  }

  close() {
    this.#closed = true;
    for (const t of this.#timers) clearTimeout(t);
    this.#timers.clear();
  }

  /** Gives the game up: it's forgotten, and not counted. */
  abandon() {
    this.close();
    write(GAME, null);
  }

  async move(move: Move) {
    this.#apply(0, move);
  }

  async next() {
    if (this.#state.phase !== 'scored') return;
    this.#note(act(this.#state, 0, { type: 'next' }, { randomInt }) as TableEvent[]);
    this.#after();
  }

  left(at: number, now = Date.now()) {
    return Math.max(0, at - now);
  }

  #later(ms: number, fn: () => void) {
    const t = window.setTimeout(() => {
      this.#timers.delete(t);
      if (!this.#closed) fn();
    }, ms);
    this.#timers.add(t);
  }

  #note(events: TableEvent[]) {
    for (const e of events) this.#events.push({ ...e, n: ++this.#seq });
    if (this.#events.length > EVENTS_KEPT) this.#events.splice(0, this.#events.length - EVENTS_KEPT);
  }

  /** A move by any seat; the rules check it (and throw RuleError, which the table words). */
  #apply(seat: number, move: Move) {
    const events = act(this.#state, seat, move, { randomInt }) as TableEvent[];
    this.#note(events);
    if (events.some((e) => e.type === 'play')) this.#holdUntil = Date.now() + PLAY_SHOW;
    this.#after();
  }

  #after() {
    this.#move++;
    if (this.#state.phase === 'done') this.#finish();
    this.#publish();
  }

  #finish() {
    write(GAME, null);
    const first = (standings(this.#state) as { seat: number; place: number }[]).find((s) => s.seat === 0);
    this.won = first?.place === 1;
    record.played += 1;
    if (this.won) record.won += 1;
    write(RECORD, { ...record });
  }

  #publish() {
    const s = this.#state;
    this.view = {
      id: this.#id,
      state: ruleView(s, 0) as MatchState,
      totals: totals(s) as number[],
      standings: standings(s) as MatchView['standings'],
      people: this.#people,
      me: 0,
      events: [...this.#events],
      autopilot: -1,
      endsAt: null,
      readyBy: null,
      ready: false,
      over: s.phase === 'done',
    };
    if (s.phase === 'done') return;
    write(GAME, { setup: this.#setup, people: this.#people, state: s, events: this.#events, seq: this.#seq, id: this.#id } satisfies Saved);
    if (s.phase === 'play') {
      this.#bots();
      this.#reflexes();
    }
  }

  /** A bot's turn: it thinks a moment once the last card has landed, then moves. */
  #bots() {
    const s = this.#state;
    const seat = s.turn as number;
    if (!this.#people[seat]?.bot) return;
    const at = this.#move;
    const think = BOT_THINK[0] + Math.random() * (BOT_THINK[1] - BOT_THINK[0]);
    const window = s.open !== null && s.open !== seat ? CATCH_WINDOW : 0;
    const wait = Math.max(think, window, this.#holdUntil - Date.now() + think / 2);
    this.#later(wait, () => {
      if (this.#move !== at || s.phase !== 'play' || s.turn !== seat) return;
      const move = botMove(s, seat, { level: this.#people[seat].level ?? 'journeyman' }) as Move | null;
      if (move) this.#apply(seat, move);
    });
  }

  /** Out of turn: a bot calls for itself, catches someone who didn't, or jumps in, after its rank's moment. */
  #reflexes() {
    const at = this.#move;
    this.#people.forEach((p, seat) => {
      if (!p.bot) return;
      const level = p.level ?? 'journeyman';
      const want = botReflex(this.#state, seat, { level }) as Move | null;
      if (!want) return;
      const [lo, hi] = REFLEX[level];
      this.#later(lo + Math.random() * (hi - lo), () => {
        const s = this.#state;
        if (this.#move !== at || s.phase !== 'play') return;
        const still = (moves(s, seat) as Move[]).some((m) => m.type === want.type && ('card' in m ? m.card : null) === ('card' in want ? want.card : null));
        if (still) this.#apply(seat, want);
      });
    });
  }
}
