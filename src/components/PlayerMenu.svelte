<!--
  The host's sheet for one player: one place earlier or later in the order of play, seat them at the
  table or send them to watch, or take them out of the room (a bot: remove it). A bot's sheet sets its
  rank (Apprentice, Journeyman, Master). It stays open while the move waits at the tapped button
  (src/lib/waits.ts), and shows why when it fails. From Stammtisch's PlayerMenu.svelte.
-->
<script lang="ts">
  import { LEVELS, type Level, type Player } from '../lib/api';
  import { t } from '../lib/i18n.svelte';
  import BotRank from './BotRank.svelte';

  let {
    player,
    seated,
    full,
    onseat,
    onremove,
    onlevel,
    onmove,
    first = false,
    last = false,
    onclose,
    levels = LEVELS,
    error = '',
  }: {
    player: Player | null;
    seated: boolean;
    full: boolean;
    onseat: (seated: boolean, from: Event) => void;
    onremove: (from: Event) => void;
    /** A bot's own rank. */
    onlevel: (level: Level, from: Event) => void;
    /** One place earlier (-1) or later (1) in the order of play. */
    onmove: (by: number, from: Event) => void;
    first?: boolean;
    last?: boolean;
    onclose: () => void;
    /** The ranks this game has (Mau-Mau two). */
    levels?: Level[];
    /** Why the last move failed. */
    error?: string;
  } = $props();

  let shown: Player | null = $state(null);
  $effect(() => {
    if (player) shown = player;
  });
  /** The rank shown: the server's, or the one just tapped while its move is on the way. */
  let picked: Level | null = $state(null);
  $effect(() => {
    void player?.level;
    picked = null;
  });
  const level = $derived.by(() => {
    const l = picked ?? (shown as Player | null)?.level ?? 'journeyman';
    return levels.includes(l) ? l : levels[levels.length - 1];
  });
</script>

<ewo-sheet open={Boolean(player)} label={t('playerActions', { name: shown?.name ?? '' })} oncancel={onclose} onclose={() => ((shown = null), onclose())}>
  <span slot="heading">{shown?.name ?? ''}</span>
  {#if shown}
    <div class="menu">
      {#if shown.bot}
        <span class="label">{t('bots')}</span>
        <div class="levels" role="radiogroup" aria-label={t('bots')}>
          {#each levels as l (l)}
            <button
              class="level"
              class:on={level === l}
              type="button"
              role="radio"
              aria-checked={level === l}
              onclick={(e) => {
                if (level === l) return;
                picked = l;
                onlevel(l, e);
              }}
            >
              <BotRank level={l} size={8} decorative />
              <b class="display">{t(`level_${l}`)}</b>
              <span>{t(`levelHint_${l}`)}</span>
            </button>
          {/each}
        </div>
      {/if}
      {#if seated}
        <div class="pair">
          <button class="btn" type="button" disabled={first} onclick={(e) => onmove(-1, e)}>{t('earlier')}</button>
          <button class="btn" type="button" disabled={last} onclick={(e) => onmove(1, e)}>{t('later')}</button>
        </div>
      {/if}
      {#if !shown.bot}
        {#if seated}
          <button class="btn block" type="button" onclick={(e) => onseat(false, e)}>{t('makeWatch')}</button>
        {:else}
          <button class="btn block" type="button" disabled={full} onclick={(e) => onseat(true, e)}>{t('makeSit')}</button>
        {/if}
      {/if}
      <button class="btn quiet block danger" type="button" onclick={(e) => onremove(e)}>{shown.bot ? t('removeBot') : t('kick')}</button>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </div>
  {/if}
</ewo-sheet>

<style>
  .menu {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-bottom: 8px;
  }
  .levels {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  /* A rank: its lozenges, its name in the display face, a line on how it plays. */
  .level {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 14px;
    row-gap: 3px;
    align-items: center;
    padding: 12px 14px;
    border: 0;
    border-radius: 14px;
    background: color-mix(in srgb, var(--ink) 4%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 12%, transparent);
    color: inherit;
    font: inherit;
    text-align: left;
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color 0.2s,
      box-shadow 0.2s;
  }
  .level :global(.pips) {
    grid-row: 1 / 3;
  }
  .level b {
    font-size: 19px;
    line-height: 1.1;
  }
  .level span:not(:global(.pips)) {
    grid-column: 2;
    font-size: 13px;
    line-height: 1.35;
    color: var(--mute);
  }
  .level.on {
    background: color-mix(in srgb, var(--sun-text) 14%, transparent);
    box-shadow: inset 0 0 0 2px var(--sun-text);
  }
  .level:focus-visible {
    outline: 2px solid var(--sun-text);
    outline-offset: 2px;
  }
  .danger {
    color: var(--bad);
  }
</style>
