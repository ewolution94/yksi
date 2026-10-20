<!-- A room you have a seat in: the lobby, the table, or the match's end. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError, type Config } from '../lib/api';
  import { errorText, t } from '../lib/i18n.svelte';
  import { fromRoom } from '../lib/match';
  import { remote } from '../lib/remote';
  import type { Room } from '../lib/room.svelte';
  import { actAt } from '../lib/waits';
  import Final from './Final.svelte';
  import Lobby from './Lobby.svelte';
  import Settings from './Settings.svelte';
  import Table from './Table.svelte';

  let { room, onleave, onrejoin }: { room: Room; onleave: () => void; onrejoin: () => void } = $props();

  let config: Config | null = $state.raw(null);
  const view = $derived(room.view);
  const match = $derived(view ? fromRoom(view) : null);
  const driver = $derived(remote(room));
  let settingsOpen = $state(false);
  let error = $state('');

  onMount(() => {
    api.config().then((c) => (config = c), () => {});
  });

  // Removed from the room (kicked, or dropped from the lobby): ask for a name again.
  $effect(() => {
    if (view && view.phase !== 'gone' && view.me === null) onrejoin();
  });

  async function leave(from?: Event) {
    try {
      await actAt(room, 'leave', undefined, from);
    } catch {
      // gone either way
    }
    onleave();
  }

  async function again(body: unknown, from: Event) {
    error = '';
    try {
      await actAt(room, 'rematch', body, from);
    } catch (e) {
      error = errorText(e instanceof ApiError ? e.code : 'other');
    }
  }

  const isHost = $derived(view?.me === view?.host);
  const hostName = $derived(view?.players.find((p) => p.id === view.host)?.name ?? '');
  const note = $derived.by(() => {
    const g = view?.game;
    if (!g || g.ended === 'done') return '';
    if (g.ended === 'left') return t('endedLeft');
    if (g.stoppedBy === view?.me) return t('endedByYou');
    return t('endedBy', { name: view?.players.find((p) => p.id === g.stoppedBy)?.name ?? '' });
  });
</script>

{#if !view}
  <p class="label wait">{t(room.wasLive ? 'reconnecting' : 'connecting')}</p>
{:else if view.phase === 'gone'}
  <div class="gone sheet">
    <p class="display">{t('gone')}</p>
    <button class="btn" type="button" onclick={onleave}>{t('home')}</button>
  </div>
{:else if view.phase === 'lobby'}
  <Lobby {room} {view} {config} />
  <button class="btn quiet leave" type="button" onclick={(e) => leave(e)}>{t('leaveGame')}</button>
{:else if view.phase === 'final' && match}
  <Final {match} {note}>
    {#snippet actions()}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      {#if isHost}
        <button class="btn primary" type="button" onclick={(e) => again(undefined, e)}>{t('again')}</button>
        <button class="btn" type="button" onclick={(e) => again({ lobby: true }, e)}>{t('toLobby')}</button>
      {:else}
        <p class="hint">{t('startHint', { name: hostName })}</p>
      {/if}
      <button class="btn quiet" type="button" onclick={(e) => leave(e)}>{t('leaveGame')}</button>
    {/snippet}
  </Final>
{:else if match}
  <Table {match} {driver} onsettings={() => (settingsOpen = true)} />
  <Settings open={settingsOpen} onclose={() => (settingsOpen = false)} {room} onleave={(e) => leave(e)} />
{/if}

<style>
  .wait {
    text-align: center;
    margin-top: 40px;
  }
  .gone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    max-width: 420px;
    margin: 40px auto 0;
    padding: 28px;
    text-align: center;
  }
  .gone .display {
    margin: 0;
    font-size: 24px;
  }
  .leave {
    display: flex;
    margin: 18px auto 0;
  }
  .hint {
    margin: 0;
    text-align: center;
    color: var(--mute);
  }
</style>
