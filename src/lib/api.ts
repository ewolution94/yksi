// The server's shapes (server/rooms.mjs → view, server/rules.mjs → view) and the calls that change
// them. Adapted from Würfle's.

import type { Avatar } from './avatar';
import type { Colour } from './deck';

export type Phase = 'lobby' | 'play' | 'final' | 'gone';
export type ClockChoice = 'off' | 'relaxed' | 'quick';
/** A bot's rank, as in a guild, weakest first (server/bots.mjs, the family's three). */
export type Level = 'apprentice' | 'journeyman' | 'master';
export const LEVELS: Level[] = ['apprentice', 'journeyman', 'master'];
/** How far a match goes: one round (0), or until someone reaches 200 or 500 points (the default). */
export const TARGETS = [0, 200, 500] as const;
export type Target = (typeof TARGETS)[number];

export interface Settings {
  clock: ClockChoice;
  /** The bots' rank: every bot's (until the host gives one its own) and the stand-ins'. */
  bots: Level;
}

/** The match's rules (server/rules.mjs → RULES): the house rules are all off by default. */
export interface Rules {
  /** A Draw Two on a Draw Two, a +4 on a +4, the sum passed on. */
  stack: boolean;
  /** An identical card may be played out of turn. */
  jumpIn: boolean;
  /** A 7 swaps hands with someone; a 0 passes every hand on. */
  sevenZero: boolean;
  /** Drawing goes on until a card fits. */
  drawToPlay: boolean;
  target: Target;
}
export const HOUSE_RULES = ['stack', 'jumpIn', 'sevenZero', 'drawToPlay'] as const;
export type HouseRule = (typeof HOUSE_RULES)[number];

export interface Player {
  id: string;
  name: string;
  avatar: Avatar;
  online: boolean;
  bot: boolean;
  level?: Level;
}

/** A Wild Draw Four waiting for its victim's answer: challenge, or take the four. */
export interface Pending {
  /** 'd4': a Wild Draw Four (challenge, take it, or under stacking add a Four); 'd2': a Draw Two stack (stacking only). */
  kind: 'd2' | 'd4';
  /** The cards owed so far. */
  count: number;
  seat: number;
  victim: number;
  /** The colour in play before the Four. */
  before?: Colour;
}

/** A round's record: who went out, and what each seat scored. */
export interface RoundRecord {
  round: number;
  winner: number;
  points: number[];
  /** Nobody could play or draw: the fewest cards won. */
  blocked?: true;
}

/** The match as one seat may see it (server/rules.mjs → view): your hand, nobody else's. */
export interface MatchState {
  rules: Rules;
  players: number;
  dealer: number;
  round: number;
  totals: number[];
  history: RoundRecord[];
  phase: 'play' | 'scored' | 'done';
  turn: number;
  dir: 1 | -1;
  /** The colour in play; null only while the first player names it after a Wild turned up. */
  colour: Colour | null;
  /** The pile's top few cards, the top last; how many lie on it in all. */
  pile: string[];
  piled: number;
  stock: number;
  /** How many cards each seat holds. */
  counts: number[];
  pending: Pending | null;
  /** Out of turn, under jump-in: the cards identical to the top one. */
  jumpable: string[];
  /** A seat down to one card that didn't call "Yksi!": anyone may catch it until the next move. */
  open: number | null;
  /** Your hand (sorted), or null when watching. */
  hand: string[] | null;
  /** The card you just drew that fits: play it, or keep it. */
  drawn: string | null;
  /** What you may play now. */
  playable: string[];
  /** After your challenge: the hand you were shown. */
  peek: { from: number; hand: string[] } | null;
  winner: number | null;
  /** At a round's end: every hand, shown. */
  hands: string[][] | null;
  /** Someone drew a card that fits and is choosing. */
  choosing: boolean;
}

export interface Standing {
  seat: number;
  total: number;
  place: number;
}

export interface TableEvent {
  n: number;
  type: string;
  seat?: number;
  [k: string]: unknown;
}

export type Ended = 'done' | 'stopped' | 'left';

export interface Game {
  n: number;
  /** Player ids round the table, in playing order. */
  seats: string[];
  gone: boolean[];
  /** Your seat, or -1: watching. */
  seat: number;
  state: MatchState;
  totals: number[];
  standings: Standing[];
  holdUntil: number;
  /** A seat whose clock ran out: the bot is finishing its turn. */
  autopilot: number;
  /** Between rounds: who has tapped on, and when the next round comes anyway. */
  ready: string[];
  readyBy: number | null;
  events: TableEvent[];
  endsAt: number | null;
  startedAt: number;
  endedAt: number | null;
  ended: Ended | null;
  stoppedBy: string | null;
}

export interface View {
  code: string;
  phase: Phase;
  version: number;
  host: string;
  me: string | null;
  settings: Settings;
  rules: Rules;
  notice: string | null;
  /** The players at the table, in playing order. */
  order: string[];
  players: Player[];
  game: Game | null;
  now: number;
}

/** A move for your seat (server/rules.mjs → act). */
export type Move =
  | { type: 'play'; card: string; colour?: Colour; call?: boolean; swap?: number }
  | { type: 'draw' }
  | { type: 'pass' }
  | { type: 'challenge' }
  | { type: 'colour'; colour: Colour }
  | { type: 'call' }
  | { type: 'catch' }
  | { type: 'jump'; card: string; colour?: Colour; call?: boolean };

export interface Seat {
  code: string;
  player: string;
  token: string;
}

export interface Config {
  clocks: ClockChoice[];
  moveSeconds: Record<string, number>;
  players: { min: number; max: number };
  seats: number;
  targets: Target[];
  levels: Level[];
  defaults: Settings & { rules: Rules };
}

/**
 * A refusal from the server ("no-room", "turn" …), a network failure ("offline"), the server or
 * Cloudflare in trouble ("busy": a 5xx without the game's own answer) or no answer in time
 * ("timeout": Folio's track() gave up). The last three are worth "Try again" (waits.ts).
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status = 0,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, cache: 'no-store' });
  } catch {
    // Given up on (the signal from track()), or the network: Safari says "Load failed", Chrome
    // "Failed to fetch", so classify by type (learnings/ios-and-webkit.md).
    throw new ApiError(init.signal?.aborted ? 'timeout' : 'offline');
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const { error, ...detail } = body ?? {};
    throw new ApiError(error ?? (response.status >= 500 ? 'busy' : `http-${response.status}`), response.status, detail);
  }
  return body as T;
}

const post = (body: unknown, token?: string, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { 'x-yksi-token': token } : {}) },
  body: JSON.stringify(body ?? {}),
  signal,
});

/**
 * A deploy restarts the server and ends every room; for a few seconds a create or join can fail.
 * One quiet retry, then the error (learnings/projects/vollmond.md). Safe for create and join: they
 * carry a key, so a retry gets the seat a first try may have made. Not once the page gave up.
 */
async function again<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (signal?.aborted || !(error instanceof ApiError) || (error.code !== 'offline' && error.status < 500)) throw error;
    await new Promise((r) => setTimeout(r, 1500));
    if (signal?.aborted) throw error;
    return fn();
  }
}

export const api = {
  config: () => again(() => request<Config>('/api/config')),
  create: (name: string, avatar: Avatar, key?: string, signal?: AbortSignal) =>
    again(() => request<Seat>('/api/rooms', post({ name, avatar, key }, undefined, signal)), signal),
  info: (code: string) => request<{ code: string; phase: Phase; players: number; full: boolean }>(`/api/rooms/${code}`),
  join: (code: string, name: string, avatar: Avatar | null, token?: string, key?: string, signal?: AbortSignal) =>
    again(() => request<Seat>(`/api/rooms/${code}/join`, post({ name, avatar, token, key }, undefined, signal)), signal),
  act: (seat: Seat, action: string, body?: unknown, signal?: AbortSignal) => request<void>(`/api/rooms/${seat.code}/${action}`, post(body, seat.token, signal)),
};

/** Room codes: four consonants (server/rooms.mjs → CODE). */
export const CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/;
