<!--
  "So geht's" as a row of its own, in the panels' look (the user, 2026-10-20: the quiet button "looks
  really lost in this ui", on Würfle): a little card, the title, what's inside, a chevron. On the start
  page, in the lobby and at the top of Settings, as Stichle and Würfle have it.
-->
<script lang="ts">
  import { t } from '../lib/i18n.svelte';
  import { ui } from '../lib/ui.svelte';

  let { before }: { before?: () => void } = $props();
</script>

<button
  class="sheet guide-row"
  type="button"
  onclick={() => {
    before?.();
    ui.guide = true;
  }}
>
  <svg class="mark" viewBox="0 0 24 32" aria-hidden="true">
    <rect x="1.5" y="1.5" width="21" height="29" rx="4" />
    <path d="M12 8 16.5 15.6H7.5Z" />
  </svg>
  <span class="text"><b>{t('guide')}</b><small>{t('guideOpen')}</small></span>
  <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
</button>

<style>
  .guide-row {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    min-height: 68px;
    padding: 12px 14px 12px 16px;
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: transform var(--ewo-dur-1) var(--ewo-ease), box-shadow var(--ewo-dur-1) var(--ewo-ease);
  }
  .guide-row:active {
    transform: scale(0.98);
  }
  .guide-row:focus-visible {
    outline: 3px solid var(--sun-text);
    outline-offset: 2px;
  }
  .mark {
    flex: none;
    width: 26px;
    height: 34px;
  }
  .mark rect {
    fill: #df432d;
  }
  .mark path {
    fill: #fbfaf5;
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }
  .text b {
    font: 800 17px/1.15 var(--display);
    color: var(--ink);
  }
  .text small {
    font: 500 14px/1.3 var(--text);
    color: var(--mute);
  }
  .chev {
    flex: none;
    width: 20px;
    height: 20px;
    fill: none;
    stroke: var(--lagoon-text);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
