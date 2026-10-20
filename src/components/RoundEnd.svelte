<!--
  A round's result, over the table until everyone has tapped on (at a table the next round comes by
  itself after a while; against bots it waits for you): who went out, what each hand left was worth
  (every hand shown, as when the cards are counted), and everyone's points so far. From Stammtisch's
  DealEnd.svelte.
-->
<script lang="ts">
  import { ApiError } from '../lib/api';
  import { errorText, t } from '../lib/i18n.svelte';
  import type { Driver, MatchView } from '../lib/match';
  import { play } from '../lib/sound.svelte';
  import Avatar from './Avatar.svelte';
  import Card from './Card.svelte';

  let { match, driver }: { match: MatchView; driver: Driver } = $props();

  const s = $derived(match.state);
  const rec = $derived(s.history.at(-1) ?? null);
  const winner = $derived(rec?.winner ?? s.winner ?? -1);
  const nameAt = (seat: number) => (seat === match.me ? t('you') : (match.people[seat]?.name ?? '?'));
  /** Everyone, the round's winner first, then by points so far. */
  const order = $derived(
    Array.from({ length: s.players }, (_, i) => i).sort((a, b) => Number(b === winner) - Number(a === winner) || (match.totals[b] ?? 0) - (match.totals[a] ?? 0)),
  );
  const last = $derived(s.rules.target > 0 && match.standings.some((x) => x.total >= s.rules.target));

  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 500);
    return () => clearInterval(timer);
  });
  const left = $derived(match.readyBy ? Math.ceil(driver.left(match.readyBy, now) / 1000) : 0);

  // A little fanfare for the one who went out.
  $effect(() => {
    if (winner === match.me && winner >= 0) play.out();
  });

  let error = $state('');
  async function next(e: Event) {
    error = '';
    try {
      await driver.next(e);
    } catch (err) {
      error = errorText(err instanceof ApiError ? err.code : 'other');
    }
  }
</script>

<div class="veil">
  <div class="sheet result" role="dialog" aria-modal="true" aria-labelledby="round-end-title">
    <span class="label">{t('roundN', { n: s.round })}</span>
    <h2 class="display" id="round-end-title">{winner === match.me ? t('outYou') : t('out', { name: nameAt(winner) })}</h2>
    {#if rec}<p class="gain">+{rec.points[winner] ?? 0}</p>{/if}

    <ol class="rows" data-scroll>
      {#each order as seat (seat)}
        {@const p = match.people[seat]}
        {@const cards = s.hands?.[seat] ?? []}
        <li class:won={seat === winner} class:me={seat === match.me}>
          <span class="who">{#if p?.avatar}<Avatar avatar={p.avatar} size={24} ring={false} />{/if}<span>{nameAt(seat)}</span></span>
          <span class="cards">
            {#each cards.slice(0, 12) as card (card)}<span class="mini"><Card id={card} /></span>{/each}
            {#if cards.length > 12}<span class="more">+{cards.length - 12}</span>{/if}
          </span>
          <span class="total">{match.totals[seat] ?? 0}</span>
        </li>
      {/each}
    </ol>

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if match.me >= 0}
      {#if match.ready}
        <p class="hint">{t('waitingOthers')}{#if left > 0} · {left} s{/if}</p>
      {:else}
        <button class="btn primary block" type="button" onclick={next}>{last ? t('toFinal') : t('nextRound')}{#if left > 0} · {left} s{/if}</button>
      {/if}
    {:else if left > 0}
      <p class="hint">{t('nextIn', { n: left })}</p>
    {/if}
  </div>
</div>

<style>
  .veil {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    padding: calc(env(safe-area-inset-top, 0px) + 16px) 14px calc(env(safe-area-inset-bottom, 0px) + 16px);
    background: rgb(10 18 17 / 0.45);
    animation: fade 0.25s ease-out both;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  .result {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    width: min(460px, 100%);
    max-height: 100%;
    padding: 20px 16px 16px;
    text-align: center;
    animation: rise 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.1) both;
  }
  @keyframes rise {
    from {
      translate: 0 18px;
    }
  }
  h2 {
    margin: 0;
    font-size: 22px;
    line-height: 1.15;
    text-wrap: balance;
  }
  .gain {
    margin: 0;
    font: 800 26px/1 var(--display);
    color: var(--sun-text);
  }
  .rows {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 0;
    margin: 4px 0 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
    overscroll-behavior: contain;
  }
  li {
    display: grid;
    grid-template-columns: minmax(0, 7.5em) minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-height: 46px;
    padding: 4px 6px;
    border-bottom: 1px solid var(--line-2);
    text-align: left;
  }
  li.won .who span {
    color: var(--sun-text);
  }
  li.me {
    background: var(--ewo-fill-2);
  }
  .who {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font: 600 14.5px/1.2 var(--text);
  }
  .who span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cards {
    display: flex;
    align-items: center;
    min-width: 0;
    overflow: hidden;
  }
  .mini {
    flex: none;
    width: 26px;
    margin-right: -10px;
  }
  .more {
    margin-left: 14px;
    font: 700 12px/1 var(--display);
    color: var(--mute);
  }
  .total {
    font: 800 16px/1 var(--display);
    font-variant-numeric: tabular-nums;
  }
  .hint {
    margin: 0;
    font-size: 13.5px;
    color: var(--mute);
  }
</style>
