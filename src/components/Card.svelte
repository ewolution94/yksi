<!--
  One card from the deck (src/lib/deck.ts), as the page draws it: inline SVG, the paper's grain on
  top (main.ts makes it once). `id` is the server's card id; none (or `back`) draws the back. From
  Stammtisch's Card.svelte.
-->
<script lang="ts">
  import { card } from '../lib/deck';
  import { nextUid } from '../lib/table';

  let { id = null, back = false, glare = false }: { id?: string | null; back?: boolean; glare?: boolean } = $props();

  const uid = nextUid();
  const svg = $derived(card(back ? null : id, { uid }));
</script>

<div class="face">
  {@html svg}
  {#if glare}<div class="glare"></div>{/if}
</div>

<style>
  .face {
    position: relative;
    width: 100%;
    aspect-ratio: 5 / 7;
    border-radius: 8% / 5.7%;
    overflow: hidden;
    box-shadow: var(--card-shadow);
    -webkit-user-select: none;
    user-select: none;
  }
  .face :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
  /* The print's paper: a little grain over the flat ink. */
  .face::after {
    content: '';
    position: absolute;
    inset: 0;
    background-image: var(--grain);
    background-size: 160px;
    mix-blend-mode: multiply;
    opacity: 0.22;
    pointer-events: none;
  }
  .glare {
    position: absolute;
    left: -50%;
    top: -50%;
    width: 200%;
    height: 200%;
    background: radial-gradient(circle at 50% 50%, rgb(255 255 255 / 0.6), rgb(255 255 255 / 0) 30%);
    mix-blend-mode: soft-light;
    opacity: 0;
    pointer-events: none;
    will-change: transform, opacity;
  }
</style>
