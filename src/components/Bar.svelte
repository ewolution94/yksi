<!-- The bar across the top: the name (home), the table's code in a room, and Settings. -->
<script lang="ts">
  import { t } from '../lib/i18n.svelte';
  import Logo from './Logo.svelte';
  import Settings from './Settings.svelte';

  let { code }: { code: string | null } = $props();

  let settingsOpen = $state(false);
  let button: HTMLElement | undefined = $state();

  function closeSettings() {
    settingsOpen = false;
    // Focus goes back where it came from.
    button?.focus();
  }
</script>

<header class="bar">
  <a class="home" href="/" aria-label="Yksi"><Logo /></a>
  <div class="end">
    {#if code}
      <span class="code" aria-label="{t('code')} {code}">{code}</span>
    {/if}
    <!-- A real <button> sits inside the element: Enter and Space reach this handler as a click. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <ewo-settings-button bind:this={button} onclick={() => (settingsOpen = true)}></ewo-settings-button>
  </div>
</header>

<Settings open={settingsOpen} onclose={closeSettings} />

<style>
  .bar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: var(--bar-h);
    padding: env(safe-area-inset-top, 0px) var(--gutter) 0;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    color: var(--ink);
  }
  /* A flex box, so the logo is centred in the bar; as a line box it stood on its baseline, high. */
  .home {
    display: flex;
    text-decoration: none;
  }
  .end {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .code {
    padding: 5px 9px 4px;
    border-radius: 999px;
    background: var(--ewo-fill-2);
    color: var(--ink);
    font: 800 14px/1 var(--display);
    letter-spacing: 0.14em;
  }
</style>
