<!--
  The start: who you are (a seal and your name), then a game against bots (how many, how good, how far
  and with which house rules; or carry on the one you left), a new table for friends, or a table by
  its code. How to play opens once on a device's first visit. From Würfle's Home.svelte.
-->
<script lang="ts">
  import GuideRow from './GuideRow.svelte';
  import HouseRules from './HouseRules.svelte';
  import { api, ApiError, CODE, HOUSE_RULES, LEVELS, TARGETS, type Level, type Rules, type Seat } from '../lib/api';
  import type { Avatar } from '../lib/avatar';
  import { errorText, t } from '../lib/i18n.svelte';
  import { saveAvatar, savedAvatar, savedName } from '../lib/session';
  import { record, savedSolo, type SoloSetup } from '../lib/solo.svelte';
  import { newKey, waitAt } from '../lib/waits';
  import AvatarMaker from './AvatarMaker.svelte';
  import { firstVisit } from '../../vendor/ewo/elements/guide.js';
  import { ui } from '../lib/ui.svelte';

  // A device's first visit opens how to play, once (Folio's firstVisit: never again, and never when
  // storage is unavailable).
  $effect(() => {
    if (firstVisit('yksi:guide')) ui.guide = true;
  });

  let {
    oncreate,
    onjoin,
    onsolo,
  }: {
    oncreate: (seat: Seat, name: string, signal: AbortSignal) => Promise<void>;
    onjoin: (code: string) => void;
    /** A solo game: a new one with this setup, or (null) the one left unfinished. */
    onsolo: (setup: SoloSetup | null, name: string) => void;
  } = $props();

  const SETUP = 'yksi:solo-setup';
  const RULES: Rules = { stack: false, jumpIn: false, sevenZero: false, drawToPlay: false, target: 500 };
  function savedSetup(): SoloSetup {
    const fallback: SoloSetup = { bots: 3, level: 'journeyman', rules: { ...RULES } };
    try {
      const s = JSON.parse(localStorage.getItem(SETUP) ?? 'null');
      const r = s?.rules;
      const rulesOk = r && TARGETS.includes(r.target) && HOUSE_RULES.every((k) => typeof r[k] === 'boolean');
      if (s && Number.isInteger(s.bots) && s.bots >= 1 && s.bots <= 9 && LEVELS.includes(s.level) && rulesOk) return s;
    } catch {
      // the defaults
    }
    return fallback;
  }

  let name = $state(savedName());
  let avatar: Avatar = $state(savedAvatar());
  let code = $state('');
  let error = $state('');
  let setup: SoloSetup = $state(savedSetup());
  const unfinished = savedSolo();
  let key = newKey();

  const cleanCode = $derived(code.trim().toUpperCase());

  function changeAvatar(next: Avatar) {
    avatar = next;
    saveAvatar(next);
  }

  function changeSetup(patch: Partial<SoloSetup>) {
    setup = { ...setup, ...patch };
    try {
      localStorage.setItem(SETUP, JSON.stringify(setup));
    } catch {
      // not kept
    }
  }

  function who() {
    if (!name.trim()) {
      error = errorText('name');
      return null;
    }
    error = '';
    return name.trim();
  }

  function solo(resume: boolean) {
    const n = who();
    if (n) onsolo(resume ? null : setup, n);
  }

  async function create(event: Event) {
    const n = who();
    if (!n) return;
    try {
      await waitAt(event, async (signal) => oncreate(await api.create(n, avatar, key, signal), n, signal), t('wait_create'));
      key = newKey();
    } catch (e) {
      error = errorText(e instanceof ApiError ? e.code : 'other');
    }
  }

  function join(event: SubmitEvent) {
    event.preventDefault();
    if (CODE.test(cleanCode)) onjoin(cleanCode);
  }
</script>

<div class="home">
  <section class="sheet card">
    <h1 class="display">{t('whoAreYou')}</h1>
    <AvatarMaker {avatar} onchange={changeAvatar} />
    <label class="field">
      <span class="label">{t('yourName')}</span>
      <input class="input" bind:value={name} maxlength="16" autocomplete="nickname" placeholder={t('namePlaceholder')} />
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </section>

  <section class="sheet card">
    <h2 class="display">{t('soloTitle')}</h2>
    {#if unfinished}
      <button class="btn primary block" type="button" onclick={() => solo(true)}>{t('soloResume')}</button>
    {/if}
    <div class="setting">
      <span class="label">{t('opponents')}</span>
      <ewo-segmented stretch value={String(Math.min(setup.bots, 5))} label={t('opponents')} onchange={(e) => changeSetup({ bots: Number(e.detail.value) })}>
        {#each [1, 2, 3, 4, 5] as n (n)}<option value={String(n)}>{n}</option>{/each}
      </ewo-segmented>
    </div>
    <div class="setting">
      <span class="label">{t('bots')}</span>
      <ewo-segmented stretch value={setup.level} label={t('bots')} onchange={(e) => changeSetup({ level: e.detail.value as Level })}>
        {#each LEVELS as level (level)}<option value={level}>{t(`level_${level}`)}</option>{/each}
      </ewo-segmented>
      <span class="hint">{t(`levelHint_${setup.level}`)}</span>
    </div>
    <details class="more">
      <summary class="label">{t('rules')}</summary>
      <HouseRules rules={setup.rules} onchange={(patch) => changeSetup({ rules: { ...setup.rules, ...patch } })} />
    </details>
    <button class="btn {unfinished ? '' : 'primary'} block" type="button" onclick={() => solo(false)}>{unfinished ? t('soloNew') : t('solo')}</button>
    {#if record.played}
      <p class="record">{t(record.played === 1 ? 'recordOne' : 'record', { won: record.won, played: record.played })}</p>
    {/if}
  </section>

  <section class="sheet card">
    <h2 class="display">{t('newTable')}</h2>
    <p class="hint">{t('newTableHint')}</p>
    <button class="btn primary block" type="button" onclick={create}>{t('newTable')}</button>
    <form class="join" onsubmit={join}>
      <span class="label">{t('joinWithCode')}</span>
      <div class="row">
        <input
          class="input code"
          bind:value={code}
          maxlength="4"
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          placeholder={t('codePlaceholder')}
          aria-label={t('code')}
        />
        <button class="btn" type="submit" disabled={!CODE.test(cleanCode)}>{t('join')}</button>
      </div>
    </form>
  </section>

  <GuideRow />
</div>

<style>
  .home {
    display: flex;
    flex-direction: column;
    gap: 18px;
    max-width: 440px;
    margin: 18px auto 0;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 22px 20px 20px;
  }
  h1,
  h2 {
    margin: 0;
    line-height: 1.1;
  }
  h1 {
    font-size: 24px;
    text-align: center;
  }
  h2 {
    font-size: 19px;
  }
  .more {
    border-top: 1px solid var(--line-2);
    padding-top: 10px;
  }
  .more summary {
    cursor: pointer;
    padding: 8px 0;
  }
  .field,
  .setting,
  .join {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .hint {
    font-size: 13px;
    line-height: 1.4;
    color: var(--mute);
  }
  .record {
    margin: 0;
    text-align: center;
    font: 600 14.5px/1.35 var(--text);
    color: var(--sun-text);
  }
  .row {
    display: flex;
    gap: 10px;
  }
  .code {
    flex: 1;
    min-width: 0;
    font: 800 20px/1.2 var(--display);
    letter-spacing: 0.3em;
    text-transform: uppercase;
  }
</style>
