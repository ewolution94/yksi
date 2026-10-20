<!--
  The end of a match: who won, everyone's points and how many rounds each went out first. Below it,
  what comes next: at a table the host plays again or goes back to the lobby (the actions, from
  Game.svelte); against bots, another game or home (SoloGame.svelte). From Würfle's Final.svelte.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { names, t } from '../lib/i18n.svelte';
  import type { MatchView } from '../lib/match';
  import Avatar from './Avatar.svelte';

  let { match, note = '', actions }: { match: MatchView; note?: string; actions: Snippet } = $props();

  const nameAt = (seat: number) => (seat === match.me ? t('you') : (match.people[seat]?.name ?? '?'));
  const history = $derived(match.state.history ?? []);
  const played = $derived(history.length > 0);
  const winners = $derived(played ? match.standings.filter((s) => s.place === 1) : []);
  const top = $derived(winners[0]?.total ?? 0);
  const roundsWon = (seat: number) => history.filter((r) => r.winner === seat).length;
</script>

<div class="final">
  <section class="sheet head">
    {#if note}<span class="label early">{note}</span>{/if}
    {#if winners.length}
      <div class="crown">
        {#each winners as w (w.seat)}
          {@const p = match.people[w.seat]}
          {#if p?.avatar}<Avatar avatar={p.avatar} size={64} />{/if}
        {/each}
      </div>
      <h1 class="display">
        {#if winners.length > 1}{t('winnersAre', { names: names(winners.map((w) => nameAt(w.seat))) })}{:else if winners[0].seat === match.me}{t('youWin')}{:else}{t('winnerIs', { name: nameAt(winners[0].seat) })}{/if}
      </h1>
      <p class="points">{t('withPoints', { n: top })}</p>
    {/if}

    <table class="standings">
      <thead>
        <tr>
          <th></th>
          <th></th>
          <th class="g">{t('roundsWon')}</th>
          <th class="sum">{t('points')}</th>
        </tr>
      </thead>
      <tbody>
        {#each match.standings as s (s.seat)}
          {@const p = match.people[s.seat]}
          <tr class:me={s.seat === match.me}>
            <td class="place">{t('place', { n: s.place })}</td>
            <td class="who">
              <div class="name">
                {#if p?.avatar}<Avatar avatar={p.avatar} size={24} ring={false} />{/if}
                <span>{nameAt(s.seat)}</span>
              </div>
            </td>
            <td class="g">{roundsWon(s.seat)}</td>
            <td class="sum">{s.total}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <div class="actions">
    {@render actions()}
  </div>
</div>

<style>
  .final {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 520px;
    margin: 14px auto 0;
  }
  .head {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 24px 18px 18px;
    text-align: center;
  }
  .early {
    color: var(--bad);
  }
  .crown {
    display: flex;
    gap: 6px;
  }
  h1 {
    margin: 0;
    font-size: 24px;
    line-height: 1.1;
    text-wrap: balance;
    color: var(--ink);
  }
  .points {
    margin: 0;
    font: 800 22px/1.2 var(--display);
    color: var(--sun-text);
  }
  .standings {
    width: 100%;
    margin-top: 6px;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums lining-nums;
  }
  th {
    padding: 0 4px 6px;
    font: 700 12px/1 var(--text);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--lagoon-text);
    border-bottom: 1.5px solid var(--lagoon-text);
  }
  td {
    height: 40px;
    padding: 0 4px;
    border-bottom: 1px solid var(--line-2);
  }
  tr.me td {
    background: var(--ewo-fill-2);
  }
  .place {
    width: 28px;
    font: 800 16px/1 var(--display);
    color: var(--lagoon-text);
    text-align: center;
  }
  .who {
    text-align: left;
  }
  /* The avatar and the name centred together, not set on the cell's line. */
  .who .name {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .who span {
    font: 600 17px/1 var(--text);
    color: var(--ink);
  }
  .g {
    width: 64px;
    text-align: center;
    font: 800 16px/1 var(--display);
    color: var(--ink-2);
  }
  th.g {
    font: 700 12px/1 var(--text);
    letter-spacing: 0.12em;
    color: var(--lagoon-text);
  }
  .sum {
    width: 64px;
    text-align: right;
    font: 800 20px/1 var(--display);
    color: var(--sun-text);
  }
  th.sum {
    font: 700 11.5px/1 var(--text);
    letter-spacing: 0.12em;
    color: var(--lagoon-text);
  }
  .actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .actions :global(.btn) {
    width: 100%;
  }
  .actions :global(.btn.quiet) {
    width: auto;
  }
</style>
