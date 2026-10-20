// Where things are around the table, from your own seat: you sit at the bottom, and play goes on to
// your left, across the top, and round to your right (clockwise, as at a real table). From
// Stammtisch's src/lib/table.ts, which took it from Stichle's; the geometry is Folio's card kit.

import { placeOf as kitPlaceOf, seatAngle, stackPlace } from '../../vendor/ewo/elements/card-pile.js';

let uid = 0;
/** A fresh id for one drawn card, so its clip path never clashes with another card's. */
export const nextUid = () => ++uid;

/** The seat at the bottom of this page's table. */
export const homeSeat = (mine: number) => (mine >= 0 ? mine : 0);

/** A seat's place: 0 is you, then 1, 2 … in the order play goes. */
export const placeOf = (seat: number, mine: number, n: number) => kitPlaceOf(seat, homeSeat(mine), n);

/** The direction a seat sits in, in degrees (0 = right, 90 = down): you at 90, the others from the left over the top to the right. */
export const angleOf = (seat: number, mine: number, n: number) => seatAngle(seat, mine, n);

/** A card on the discard pile: a little off-centre and askew, the same on every page. */
export { stackPlace };

/**
 * A hand's cards with a key each: Yksi's ids are unique per card (two red sevens are `r-7-0` and
 * `r-7-1`), so the id is the key. Kept so Hand.svelte reads like Stammtisch's.
 */
export function rekey(cards: readonly string[]) {
  return cards.map((id) => ({ id, key: id }));
}
export const idOfKey = (key: string) => key;

/** From this window up the table is laid out for a computer: phones and small windows keep theirs. */
export const DESK = '(min-width: 1100px) and (min-height: 740px)';
