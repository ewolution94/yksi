// What the table needs, whoever runs the match: a room on the server (src/lib/room.svelte.ts) or a
// solo game in the page (src/lib/solo.svelte.ts). The table (Table.svelte) shows a MatchView and asks
// a Driver to make moves for your seat and to go on after a round's result. From Würfle's.

import type { Avatar } from './avatar';
import type { Level, MatchState, Move, Standing, TableEvent, View } from './api';

export interface Person {
  name: string;
  avatar: Avatar;
  bot: boolean;
  level?: Level;
  /** Here (a bot always is), or their page is closed. */
  online: boolean;
  /** Left the table: a bot plays for them. */
  gone: boolean;
}

export interface MatchView {
  /** Changes with every new match at the table. */
  id: string;
  /** The match as your seat may see it. */
  state: MatchState;
  totals: number[];
  standings: Standing[];
  /** By seat, in playing order. */
  people: Person[];
  /** Your seat, or -1: watching. */
  me: number;
  /** The table's last events (who played, drew, was caught …), numbered. */
  events: TableEvent[];
  /** A seat whose clock ran out: the bot is finishing its turn. */
  autopilot: number;
  /** When the turn's clock runs out (the server's time), or null. */
  endsAt: number | null;
  /** Between rounds: when the next round comes anyway (the server's time), and whether you've tapped on. */
  readyBy: number | null;
  ready: boolean;
  over: boolean;
}

export interface Driver {
  /** A move for your seat; rejects with the reason it was refused. */
  move(move: Move, from?: Element | Event | null): Promise<void>;
  /** Done looking at the round's result. */
  next(from?: Element | Event | null): Promise<void>;
  /** Milliseconds until a server timestamp. */
  left(at: number, now?: number): number;
}

/** A room's view as the table sees it. */
export function fromRoom(view: View): MatchView | null {
  const g = view.game;
  if (!g) return null;
  const byId = new Map(view.players.map((p) => [p.id, p]));
  return {
    id: `${view.code}:${g.n}`,
    state: g.state,
    totals: g.totals,
    standings: g.standings,
    people: g.seats.map((id, seat) => {
      const p = byId.get(id);
      return {
        name: p?.name ?? '?',
        avatar: p?.avatar ?? (null as unknown as Avatar),
        bot: p?.bot ?? false,
        level: p?.level,
        online: p?.online ?? false,
        gone: g.gone[seat] ?? !p,
      };
    }),
    me: g.seat,
    events: g.events,
    autopilot: g.autopilot,
    endsAt: g.endsAt,
    readyBy: g.readyBy,
    ready: view.me !== null && g.ready.includes(view.me),
    over: view.phase === 'final',
  };
}
