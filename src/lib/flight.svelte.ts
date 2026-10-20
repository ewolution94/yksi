// A card on its way from your hand to the table. The hand flies it there itself (Hand.svelte); the
// trick waits to draw it until it has landed, so the card never shows twice or jumps.

export const flight = $state({ card: '', until: 0 });

export function flying(card: string, ms: number) {
  flight.card = card;
  flight.until = Date.now() + ms;
}
