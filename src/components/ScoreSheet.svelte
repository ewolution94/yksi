<!--
  The scores, a tap away at the table: every round so far, what each seat scored in it (only the one
  who went out scores), and the totals, with the target above. Folio's ewo-sheet. From Stammtisch's
  ScoreSheet.svelte.
-->
<script lang="ts">
  import { t } from '../lib/i18n.svelte';
  import type { MatchView } from '../lib/match';

  let { open, match, onclose }: { open: boolean; match: MatchView; onclose: () => void } = $props();

  let shown = $state(false);
  $effect(() => {
    if (open) shown = true;
  });
  const s = $derived(match.state);
  const nameAt = (seat: number) => (seat === match.me ? t('you') : (match.people[seat]?.name ?? '?'));
</script>

<ewo-sheet {open} label={t('scores')} oncancel={onclose} onclose={() => ((shown = false), onclose())}>
  <span slot="heading">{t('scores')}</span>
  {#if shown}
    <p class="target">{s.rules.target ? t('targetIs', { n: s.rules.target }) : t('targetRound')}</p>
    <div class="wrap" data-scroll>
      <table>
        <thead>
          <tr>
            <th class="r"></th>
            {#each match.people as _, seat (seat)}<th class:me={seat === match.me}>{nameAt(seat)}</th>{/each}
          </tr>
        </thead>
        <tbody>
          {#each s.history as rec, i (i)}
            <tr>
              <td class="r">{i + 1}</td>
              {#each match.people as _, seat (seat)}<td class:won={rec.winner === seat}>{rec.winner === seat ? rec.points[seat] : '·'}</td>{/each}
            </tr>
          {/each}
          {#if !s.history.length}
            <tr><td class="r"></td><td class="none" colspan={match.people.length}>{t('noRoundsYet')}</td></tr>
          {/if}
        </tbody>
        <tfoot>
          <tr>
            <td class="r">Σ</td>
            {#each match.people as _, seat (seat)}<td class:me={seat === match.me}>{match.totals[seat] ?? 0}</td>{/each}
          </tr>
        </tfoot>
      </table>
    </div>
  {/if}
</ewo-sheet>

<style>
  .target {
    margin: 0 0 12px;
    color: var(--mute);
    font-size: 14px;
  }
  .wrap {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  th {
    padding: 6px 6px;
    font: 700 12px/1.2 var(--text);
    text-align: center;
    white-space: nowrap;
    color: var(--ink-2);
    border-bottom: 1.5px solid var(--ink);
  }
  th.me,
  td.me {
    color: var(--lagoon-text);
  }
  td {
    height: 36px;
    padding: 0 6px;
    text-align: center;
    font: 600 14px/1 var(--display);
    border-bottom: 1px solid var(--line-2);
    color: var(--mute);
  }
  td.won {
    color: var(--sun-text);
    font-weight: 800;
  }
  .r {
    width: 28px;
    text-align: left;
    color: var(--mute);
    font: 700 12px/1 var(--text);
  }
  .none {
    font: 500 14px/1.3 var(--text);
  }
  tfoot td {
    border-bottom: 0;
    border-top: 1.5px solid var(--ink);
    font-weight: 800;
    color: var(--ink);
  }
</style>
