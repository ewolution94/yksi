<!--
  Arriving at a room's link without a seat: who you are, then into the game.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError, type Seat } from '../lib/api';
  import type { Avatar } from '../lib/avatar';
  import { errorText, t } from '../lib/i18n.svelte';
  import { saveAvatar, savedAvatar, savedName } from '../lib/session';
  import { newKey, waitAt } from '../lib/waits';
  import AvatarMaker from './AvatarMaker.svelte';

  /** `onjoin` resolves once the room can show (its first view): the button waits for that. */
  let {
    code,
    onjoin,
    onback,
  }: { code: string; onjoin: (seat: Seat, name: string, signal: AbortSignal) => Promise<void>; onback: () => void } = $props();

  let name = $state(savedName());
  let avatar: Avatar = $state(savedAvatar());
  let error = $state('');
  let missing = $state(false);
  /** One key per join, kept for its retries, so a timed-out first try doesn't seat you twice. */
  let key = newKey();

  onMount(() => {
    api.info(code).then(
      (info) => {
        if (info.full) error = errorText('room-full');
      },
      (e) => {
        if (e instanceof ApiError && e.code === 'no-room') missing = true;
      },
    );
  });

  function changeAvatar(next: Avatar) {
    avatar = next;
    saveAvatar(next);
  }

  async function join(event: SubmitEvent) {
    event.preventDefault();
    if (!name.trim()) {
      error = errorText('name');
      return;
    }
    error = '';
    const who = name.trim();
    try {
      await waitAt(event, async (signal) => onjoin(await api.join(code, who, avatar, undefined, key, signal), who, signal), t('wait_join'));
      key = newKey();
    } catch (e) {
      error = errorText(e instanceof ApiError ? e.code : 'other');
    }
  }
</script>

<div class="join">
  {#if missing}
    <div class="sheet gone">
      <p>{errorText('no-room')}</p>
      <button class="btn" type="button" onclick={onback}>{t('home')}</button>
    </div>
  {:else}
    <form class="sheet card" onsubmit={join}>
      <span class="file"><span class="label">{t('code')}</span> <b>{code}</b></span>
      <h1 class="display">{t('whoAreYou')}</h1>
      <AvatarMaker {avatar} onchange={changeAvatar} />
      <label class="field">
        <span class="label">{t('yourName')}</span>
        <input class="input" bind:value={name} maxlength="16" autocomplete="nickname" placeholder={t('namePlaceholder')} />
      </label>
      <button class="btn primary block" type="submit">{t('joinTable')}</button>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </form>
    <button class="btn quiet back" type="button" onclick={onback}>{t('back')}</button>
  {/if}
</div>

<style>
  .join {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 440px;
    margin: 14px auto 0;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 26px 22px 22px;
  }
  .file {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 8px;
  }
  .file b {
    font: 800 20px/1 var(--display);
    letter-spacing: 0.14em;
    color: var(--ink);
  }
  h1 {
    margin: 0;
    color: var(--ink);
    font-size: 28px;
    line-height: 1.1;
    text-align: center;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .back {
    align-self: center;
  }
  .gone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 28px 18px;
    text-align: center;
  }
</style>
