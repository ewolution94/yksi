<!--
  A card held up to look at: big, on a dark stage, tilting with the phone (src/lib/tilt.ts; iOS asks
  once, from the hold that opened it), with a finger, or towards the mouse, the foil moving with
  the light. Opened by holding a card in your hand.
-->
<script lang="ts">
  import { nameOf } from '../lib/deck';
  import { i18n, t } from '../lib/i18n.svelte';
  import { tilt } from '../lib/tilt';
  import Card from './Card.svelte';

  let { card, onclose }: { card: string | null; onclose: () => void } = $props();

  let closeButton: HTMLButtonElement | undefined = $state();
  $effect(() => {
    if (card) closeButton?.focus();
  });
</script>

<svelte:window onkeydown={(e) => card && e.key === 'Escape' && onclose()} />

{#if card}
  <div class="stage" role="dialog" aria-modal="true" aria-label={nameOf(card, i18n.lang)}>
    <div class="top">
      <span class="name">{nameOf(card, i18n.lang)}</span>
      <button class="btn small light" type="button" bind:this={closeButton} onclick={onclose}>{t('close')}</button>
    </div>
    <div class="hold">
      <div class="big" use:tilt>
        {#key card}<Card id={card} glare />{/key}
      </div>
    </div>
    <p class="hint">{t('tiltHint')}</p>
  </div>
{/if}

<style>
  .stage {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: calc(env(safe-area-inset-top, 0px) + 14px) 16px calc(env(safe-area-inset-bottom, 0px) + 18px);
    background: rgb(10 18 17 / 0.94);
    color: #e7ece9;
    animation: fade 0.2s ease-out both;
    touch-action: none;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    max-width: 520px;
  }
  .name {
    font: 800 17px/1.2 var(--display);

  }
  .hold {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    place-items: center;
    width: 100%;
  }
  .big {
    width: min(78vw, 340px, calc((100dvh - 200px) * 0.714));
    will-change: transform;
    animation: lift 0.32s cubic-bezier(0.2, 0.9, 0.3, 1.1) both;
  }
  @keyframes lift {
    from {
      scale: 0.7;
      opacity: 0;
    }
  }
  .big :global(.face) {
    border-radius: 8% / 5.7%;
    box-shadow: 0 30px 60px -20px rgb(0 0 0 / 0.8);
  }
  /* On the dark stage the button is light in either theme. */
  .light {
    border-color: #e7ece9;
    color: #e7ece9;
  }
  .hint {
    margin: 0;
    font: 500 12px/1.3 var(--ewo-mono);
    color: #95a39e;
  }
</style>
