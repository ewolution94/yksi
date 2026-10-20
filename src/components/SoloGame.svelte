<!-- A game against bots, all in the page: the table, then its end. -->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from '../lib/i18n.svelte';
  import type { Solo } from '../lib/solo.svelte';
  import Final from './Final.svelte';
  import Settings from './Settings.svelte';
  import Table from './Table.svelte';

  let { solo, onagain, onhome }: { solo: Solo; onagain: () => void; onhome: () => void } = $props();

  let settingsOpen = $state(false);
  onDestroy(() => solo.close());
</script>

{#if solo.view.over}
  <Final match={solo.view}>
    {#snippet actions()}
      <button class="btn primary" type="button" onclick={onagain}>{t('soloAgain')}</button>
      <button class="btn quiet" type="button" onclick={onhome}>{t('home')}</button>
    {/snippet}
  </Final>
{:else}
  <Table match={solo.view} driver={solo} onsettings={() => (settingsOpen = true)} />
  <Settings
    open={settingsOpen}
    onclose={() => (settingsOpen = false)}
    ongiveup={() => {
      settingsOpen = false;
      solo.abandon();
      onhome();
    }}
  />
{/if}
