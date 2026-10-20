<!--
  How to play, as full-screen pages: Folio's <ewo-guide> brings the frame (swipe, the dots, Back and
  Next, Done); each page has a small picture drawn with the game's own cards. Opens once on a
  device's first visit (Home), and from the start page, the lobby and Settings.
-->
<script lang="ts">
  import { t, type Key } from '../lib/i18n.svelte';
  import { ui } from '../lib/ui.svelte';
  import Card from './Card.svelte';

  const close = () => (ui.guide = false);
  const pages = [1, 2, 3, 4, 5, 6];
</script>

{#snippet fan(cards: string[], lit: number[] = [])}
  <div class="fan">
    {#each cards as id, k (id)}
      <span class="c" class:dim={lit.length > 0 && !lit.includes(k)} style:rotate="{(k - (cards.length - 1) / 2) * 7}deg" style:translate="0 {Math.abs(k - (cards.length - 1) / 2) * 5}px"><Card {id} /></span>
    {/each}
  </div>
{/snippet}

<ewo-guide
  open={ui.guide}
  label={t('guideTitle')}
  next-label={t('guideNext')}
  back-label={t('guideBack')}
  skip-label={t('guideSkip')}
  done-label={t('guideDone')}
  oncancel={close}
  onclose={close}
>
  {#each pages as n (n)}
    <section class="page">
      <div class="art" aria-hidden="true">
        {#if n === 1}
          <span class="pile"><Card id="r-7-0" /></span>
          {@render fan(['r-2-0', 'g-4-0', 'b-7-0', 'y-skip-0'], [0, 2])}
        {:else if n === 2}
          <div class="pair">
            <span class="pile"><Card back /></span>
            <span class="arrow">→</span>
            <span class="pile lift"><Card id="g-5-1" /></span>
          </div>
        {:else if n === 3}
          {@render fan(['b-skip-0', 'y-rev-0', 'r-d2-0'])}
        {:else if n === 4}
          {@render fan(['w-wild-0', 'w-d4-0'])}
        {:else if n === 5}
          <div class="pair">
            {@render fan(['g-9-0', 'b-9-1'])}
            <span class="shout">yksi!</span>
          </div>
        {:else}
          <div class="points">
            <span><Card id="y-8-0" /><b>8</b></span>
            <span><Card id="g-d2-1" /><b>20</b></span>
            <span><Card id="w-d4-2" /><b>50</b></span>
          </div>
        {/if}
      </div>
      <h2 class="display">{t(`guide${n}Title` as Key)}</h2>
      <p>{t(`guide${n}Text` as Key)}</p>
    </section>
  {/each}
</ewo-guide>

<style>
  ewo-guide {
    --ewo-guide-bg: var(--ground);
    --ewo-guide-fg: var(--ink);
    --ewo-guide-fg-2: var(--ink-2);
    --ewo-guide-accent: var(--lagoon);
    --ewo-guide-accent-ink: var(--lagoon-ink);
    --ewo-guide-dot: var(--ewo-fill-3);
    --ewo-guide-dot-on: var(--lagoon);
  }
  ewo-guide::part(next) {
    border-radius: 999px;
    font: 600 15px/1 var(--display);
  }
  .page {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 12px 28px 8px;
    text-align: center;
  }
  h2 {
    margin: 8px 0 0;
    font-size: 24px;
    color: var(--ink);
  }
  p {
    margin: 0;
    max-width: 36ch;
    font-size: 16px;
    line-height: 1.5;
    color: var(--ink-2);
  }
  .art {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    width: min(320px, 100%);
    min-height: 190px;
  }
  .fan {
    display: flex;
    justify-content: center;
  }
  .fan .c {
    width: 68px;
    margin: 0 -10px;
    transform-origin: 50% 100%;
  }
  .fan .c.dim {
    filter: brightness(0.72) saturate(0.8);
  }
  .pile {
    width: 70px;
  }
  .pile.lift {
    translate: 0 -12px;
    rotate: 6deg;
  }
  .pair {
    display: flex;
    align-items: center;
    gap: 22px;
  }
  .arrow {
    font: 800 26px/1 var(--display);
    color: var(--mute);
  }
  .shout {
    display: grid;
    place-items: center;
    width: 74px;
    height: 74px;
    border-radius: 50%;
    background: var(--lagoon);
    color: var(--lagoon-ink);
    font: 800 16px/1 var(--display);
    box-shadow: 0 0 0 8px rgb(242 182 0 / 0.45);
  }
  .points {
    display: flex;
    gap: 14px;
  }
  .points span {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    width: 64px;
  }
  .points b {
    font: 800 18px/1 var(--display);
    color: var(--sun-text);
  }
</style>
