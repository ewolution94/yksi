<!--
  Your hand: a fan along the bottom of the table, two rows once it's too many cards for one. Folio's
  card kit (vendor/ewo/elements/card-fan.js and card-hand.js, from Stichle's hand, by way of
  Stammtisch's): run a thumb along it and the cards lift under it; drag one up or flick it, and it
  flies to the pile; or tap a card to lift it and tap it again to play it. A card you may not play
  lifts, refuses with a shake and drops back. Hold a card still to look at it big. Every card is also
  a button, for the keyboard. `intercept` stops a card before it flies (a wild asks for its colour
  first); `marked` is a card to point out (the one just drawn).
-->
<script lang="ts">
  import { nameOf } from '../lib/deck';
  import { flying } from '../lib/flight.svelte';
  import { i18n } from '../lib/i18n.svelte';
  import { idOfKey, rekey } from '../lib/table';
  import Card from './Card.svelte';
  import { fanLayout, fanTransform, flightTransform } from '../../vendor/ewo/elements/card-fan.js';
  import { handGestures, type Dragged } from '../../vendor/ewo/elements/card-hand.js';

  type Target = { x: number; y: number; rot: number; width: number };

  let {
    cards,
    legal,
    canPlay,
    onplay,
    target,
    oninspect,
    onrefuse,
    intercept = null,
    marked = null,
  }: {
    cards: string[];
    /** What may be played now; empty when it's not your move. */
    legal: string[];
    canPlay: boolean;
    /** Sends the move; rejects with the server's reason. */
    onplay: (card: string) => Promise<void>;
    /** Where your card lands (page coordinates), or null to let it go without a flight. */
    target: (card: string) => Target | null;
    oninspect: (card: string) => void;
    /** A card that may not be played now was tried. */
    onrefuse: (card: string) => void;
    /** A card that needs a question before it's played: true stops it (it stays lifted). */
    intercept?: ((card: string) => boolean) | null;
    marked?: string | null;
  } = $props();

  const FLY_MS = 380;
  let box: HTMLDivElement | undefined = $state();
  let width = $state(360);
  let sel: string | null = $state(null);
  /** The card in the air: still drawn here until it has landed, but out of the fan. */
  let air = $state<{ key: string; id: string; transform: string; landed: boolean } | null>(null);
  let shaking: string | null = $state(null);
  /** The card under a finger that's dragging it, and where it is. */
  let drag = $state<Dragged | null>(null);

  // Each card's key: its id, which is unique in Yksi's deck (src/lib/table.ts → rekey).
  const items = $derived(rekey(cards));
  const idOf = (key: string) => items.find((c) => c.key === key)?.id ?? air?.id ?? idOfKey(key);

  const els = new Map<string, HTMLElement>();
  function register(node: HTMLElement, key: string) {
    els.set(key, node);
    return {
      update(next: string) {
        els.delete(key);
        key = next;
        els.set(key, node);
      },
      destroy: () => els.delete(key),
    };
  }

  // A lifted card that left the hand is no longer lifted.
  $effect(() => {
    if (sel && !items.some((c) => c.key === sel)) sel = null;
  });
  // A lifted card drops back on a tap or click anywhere outside the hand, or on Escape: on a laptop it
  // had no way down (Stichle dc1b4d5; the user, 2026-10-13). The kit's gestures listen on the hand's
  // own box only, so a press inside it lifts as before.
  $effect(() => {
    if (!sel) return;
    const away = (e: PointerEvent) => {
      if (!(e.target instanceof Node && box?.contains(e.target))) sel = null;
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') sel = null;
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', escape);
    };
  });
  // Landed, and the server's hand no longer has it: from now on it's the table's to draw.
  $effect(() => {
    if (air?.landed && !items.some((c) => c.key === air!.key)) air = null;
  });
  /** Drawn in a steady order, so the card in the air keeps its element (and its transition). */
  const list = $derived(air && !items.some((c) => c.key === air!.key) ? [...items, { id: air.id, key: air.key }] : items);

  // The fan from the kit: few cards are held bigger, a full hand shrinks to fit (never below 58 px,
  // for Doppelkopf's twelve) and goes to two rows; a laptop's wider table lets them grow a little.
  const keys = $derived(items.filter((c) => c.key !== air?.key).map((c) => c.key));
  const sizes = $derived<[number, number, number]>(width > 600 ? [124, 112, 100] : [104, 92, 84]);
  // The hand's box keeps one height all game: the tallest any hand gets at this width (a few cards,
  // held big), with the cards at its foot. A card leaving the hand or one drawn changes their size,
  // never the box, so the table above never moves (Stichle e28b833; the user, 2026-10-13: "it cannot
  // jump").
  const room = $derived(Math.max(...Array.from({ length: 24 }, (_, i) => fanLayout(Array.from({ length: i + 1 }, (_, k) => `${k}`), { width, count: i + 1, sizes, min: 58 }).height)));
  const natural = $derived(fanLayout(keys, { width, count: cards.length, sizes, min: 58 }));
  const layout = $derived(fanLayout(keys, { width, count: cards.length, sizes, min: 58, top: 22 + room - natural.height }));
  const cw = $derived(layout.cw);
  const height = $derived(layout.height);
  const places = $derived(layout.places);
  const lifted = (key: string) => key === sel;

  function transformOf(key: string) {
    if (drag?.key === key) return `translate(${drag.x}px, ${drag.y}px) rotate(${drag.r}deg) scale(1.12)`;
    return fanTransform(layout, key, { lifted: lifted(key) });
  }

  // The gestures from the kit: scrub, drag or flick up, tap twice, refuse, hold to look.
  $effect(() => {
    if (!box) return;
    const gestures = handGestures(box, {
      fan: () => layout,
      lifted: () => sel,
      lift: (key) => (sel = key),
      enabled: () => !air && keys.length > 0,
      canPlay: () => canPlay,
      playable: (key) => legal.includes(idOf(key)),
      play,
      refuse,
      inspect: (key) => oninspect(idOf(key)),
      drag: (d) => (drag = d),
    });
    return () => gestures.destroy();
  });

  /** A card on its way: a question first if it needs one (it stays lifted), else it flies. */
  function play(key: string) {
    if (intercept?.(idOf(key))) return;
    void send(key);
  }

  function refuse(key: string) {
    shaking = key;
    setTimeout(() => shaking === key && (shaking = null), 420);
    onrefuse(idOf(key));
  }

  /** Flies the card to its place on the table, and sends the move; back into the hand if refused. */
  async function send(key: string) {
    const id = idOf(key);
    const el = els.get(key);
    const to = target(id);
    if (box && el && to) {
      air = { key, id, landed: false, transform: flightTransform(layout, box.getBoundingClientRect(), to) };
      flying(id, FLY_MS);
      setTimeout(() => {
        if (air?.key === key) air = { ...air, landed: true };
      }, FLY_MS + 40);
    }
    sel = null;
    try {
      await onplay(id);
    } catch {
      air = null;
      flying('', 0);
      sel = key;
      refuse(key);
    }
  }

  function keyboard(e: MouseEvent, key: string) {
    // Taps arrive as pointer events (the kit's gestures); this is Enter or Space on a focused card.
    if (e.detail !== 0) return;
    tryPlay(key);
  }

  /** A card chosen from the keyboard: lifted, and played if it may be. */
  function tryPlay(key: string) {
    sel = key;
    if (!canPlay) return;
    if (!legal.includes(idOf(key))) return refuse(key);
    play(key);
  }
</script>

<div
  class="hand"
  bind:this={box}
  bind:clientWidth={width}
  style:height="{height}px"
  role="group"
  data-press="own"
  aria-label={i18n.lang === 'de' ? 'Deine Karten' : 'Your cards'}
>
  {#each list as c (c.key)}
    {@const p = places.get(c.key)}
    <button
      type="button"
      class="slot"
      class:lifted={lifted(c.key)}
      class:marked={marked !== null && c.id === marked}
      class:dim={canPlay && !legal.includes(c.id)}
      class:dragging={drag?.key === c.key}
      class:air={air?.key === c.key}
      class:shake={shaking === c.key}
      style:width="{cw}px"
      style:transform={air && air.key === c.key ? air.transform : transformOf(c.key)}
      style:z-index={air?.key === c.key || drag?.key === c.key ? 300 : (p?.z ?? 0)}
      aria-label={nameOf(c.id, i18n.lang)}
      aria-disabled={!canPlay || !legal.includes(c.id)}
      onclick={(e) => keyboard(e, c.key)}
      use:register={c.key}
    >
      <Card id={c.id} />
    </button>
  {/each}
</div>

<style>
  .hand {
    position: relative;
    width: 100%;
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }
  .slot {
    position: absolute;
    left: 0;
    top: 0;
    padding: 0;
    border: 0;
    background: none;
    border-radius: 6px;
    transform-origin: 50% 50%;
    transition: transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1), filter 0.2s;
    will-change: transform;
    -webkit-tap-highlight-color: transparent;
    cursor: grab;
  }
  .slot:focus-visible {
    outline: 3px solid var(--lagoon);
    outline-offset: 2px;
  }
  .slot.lifted :global(.face) {
    box-shadow: 0 2px 2px rgb(5 20 20 / 0.3), 0 18px 26px -12px rgb(5 20 20 / 0.7);
  }
  /* The card just drawn: a sun hairline until it's played or kept. */
  .slot.marked :global(.face) {
    box-shadow: 0 0 0 2.5px var(--sun), 0 0 14px 2px rgb(242 182 0 / 0.45);
  }
  /* Not playable now: the paper darkens a little, as if in shadow. */
  .slot.dim {
    filter: brightness(0.74) saturate(0.85);
  }
  .slot.dragging {
    transition: none;
    cursor: grabbing;
  }
  .slot.air {
    transition: transform 0.38s cubic-bezier(0.16, 0.84, 0.26, 1);
    pointer-events: none;
  }
  .slot.shake {
    animation: shake 0.4s cubic-bezier(0.36, 0.07, 0.19, 0.97);
  }
  @keyframes shake {
    20%,
    60% {
      translate: -5px 0;
    }
    40%,
    80% {
      translate: 5px 0;
    }
  }
</style>
