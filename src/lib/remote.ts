// The table's Driver for a room on the server: every move is one the server checks, waited for at the
// control that made it (Folio's track()); a played card flies at once (Hand.svelte) and comes back
// if the server refuses it. From Würfle's.

import type { Move } from './api';
import type { Driver } from './match';
import type { Room } from './room.svelte';
import { actAt, waitAt } from './waits';

export function remote(room: Room): Driver {
  return {
    move: (move: Move, from?: Element | Event | null) =>
      // A card from the hand flies by itself: no wait at a control for it.
      from ? actAt(room, 'move', { move }, from).then(() => undefined) : waitAt(null, (signal) => room.act('move', { move }, signal)).then(() => undefined),
    next: (from?: Element | Event | null) => actAt(room, 'next', undefined, from).then(() => undefined),
    left: (at: number, now?: number) => room.left(at, now),
  };
}
