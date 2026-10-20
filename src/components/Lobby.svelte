<!--
  The lobby: the table's code, link and QR code; the players in the order they'll play, and who's
  watching; and the host's settings: how far the match goes (500 points by default), the house rules
  (all off by default), the clock, the bots' rank. A setting answers the tap at once and the server's
  echo takes over once it agrees (learnings/ui-preferences.md → "A control answers the tap"). From
  Würfle's Lobby.svelte.
-->
<script lang="ts">
  import GuideRow from './GuideRow.svelte';
  import HouseRules from './HouseRules.svelte';
  import { ApiError, LEVELS, type Config, type Level, type Player, type Rules, type Settings, type View } from '../lib/api';
  import type { Avatar as AvatarValue } from '../lib/avatar';
  import { errorText, t } from '../lib/i18n.svelte';
  import type { Room } from '../lib/room.svelte';
  import { saveAvatar } from '../lib/session';
  import { actAt } from '../lib/waits';
  import Avatar from './Avatar.svelte';
  import AvatarMaker from './AvatarMaker.svelte';
  import BotRank from './BotRank.svelte';
  import PlayerMenu from './PlayerMenu.svelte';
  import Qr from './Qr.svelte';

  let { room, view, config }: { room: Room; view: View; config: Config | null } = $props();

  const MAX = $derived(config?.seats ?? 10);
  const MIN = $derived(config?.players.min ?? 2);
  const SECONDS = $derived(config?.moveSeconds ?? { relaxed: 60, quick: 25 });

  let pending: Partial<Settings> = $state({});
  let pendingRules: Partial<Rules> = $state({});
  let sending = false;
  let error = $state('');
  let copied = $state(false);
  let menuFor: string | null = $state(null);
  let avatarOpen = $state(false);
  let avatarShown = $state(false);
  let myAvatar: AvatarValue | null = $state(null);
  $effect(() => {
    if (avatarOpen) avatarShown = true;
  });

  const isHost = $derived(view.me === view.host);
  const settings: Settings = $derived({ ...view.settings, ...pending });
  const rules: Rules = $derived({ ...view.rules, ...pendingRules });
  const hostName = $derived(view.players.find((p) => p.id === view.host)?.name ?? '');
  const link = $derived(`${location.origin}/${view.code}`);
  const seated = $derived(view.order.map((id) => view.players.find((p) => p.id === id)).filter((p): p is Player => Boolean(p)));
  const watching = $derived(view.players.filter((p) => !view.order.includes(p.id)));
  const amSeated = $derived(view.me !== null && view.order.includes(view.me));
  const menuPlayer = $derived(view.players.find((p) => p.id === menuFor) ?? null);
  const menuAt = $derived(menuFor ? view.order.indexOf(menuFor) : -1);

  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  // The server agrees: its value takes over.
  $effect(() => {
    const server = view.settings;
    const left = Object.fromEntries(Object.entries(pending).filter(([k, v]) => !same(server[k as keyof Settings], v)));
    if (Object.keys(left).length !== Object.keys(pending).length) pending = left;
    const rulesLeft = Object.fromEntries(Object.entries(pendingRules).filter(([k, v]) => !same(view.rules[k as keyof Rules], v)));
    if (Object.keys(rulesLeft).length !== Object.keys(pendingRules).length) pendingRules = rulesLeft;
  });

  function change(patch: Partial<Settings>) {
    if (!isHost) return;
    pending = { ...pending, ...patch };
    void flush();
  }

  function changeRules(patch: Partial<Rules>) {
    if (!isHost) return;
    pendingRules = { ...pendingRules, ...patch };
    void flush();
  }

  async function flush() {
    if (sending) return;
    const body: Record<string, unknown> = { ...pending };
    if (Object.keys(pendingRules).length) body.rules = { ...pendingRules };
    if (!Object.keys(body).length) return;
    sending = true;
    error = '';
    try {
      await room.act('settings', body);
    } catch (e) {
      pending = {};
      pendingRules = {};
      error = errorText(e instanceof ApiError ? e.code : 'other');
    } finally {
      sending = false;
    }
    const now: Record<string, unknown> = { ...pending };
    if (Object.keys(pendingRules).length) now.rules = { ...pendingRules };
    if (Object.keys(now).length && !same(now, body)) void flush();
  }

  async function act(action: string, body?: unknown, from?: Event) {
    error = '';
    try {
      await actAt(room, action, body, from);
    } catch (e) {
      error = errorText(e instanceof ApiError ? e.code : 'other');
    }
  }

  let menuError = $state('');
  async function fromMenu(action: string, body: unknown, from: Event, close = true) {
    menuError = '';
    try {
      await actAt(room, action, body, from);
      if (close) menuFor = null;
    } catch (e) {
      menuError = errorText(e instanceof ApiError ? e.code : 'other');
    }
  }

  /** One place earlier or later in the order of play. */
  function moveSeat(by: number, from: Event) {
    const order = [...view.order];
    const i = order.indexOf(menuFor ?? '');
    const j = i + by;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    void fromMenu('order', { order }, from, false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch {
      // The link is on the page to select by hand.
    }
  }

  function tapPlayer(p: Player) {
    if (p.id === view.me) {
      myAvatar = p.avatar;
      avatarOpen = true;
    } else if (isHost) menuFor = p.id;
  }

  function changeAvatar(next: AvatarValue) {
    myAvatar = next;
    saveAvatar(next);
    void act('avatar', { avatar: next });
  }
</script>

{#snippet playerRow(p: Player, chair: number | null)}
  {@const tappable = p.id === view.me || isHost}
  <svelte:element
    this={tappable ? 'button' : 'div'}
    class="player"
    class:me={p.id === view.me}
    class:away={!p.online}
    type={tappable ? 'button' : undefined}
    onclick={tappable ? () => tapPlayer(p) : undefined}
    role={tappable ? undefined : 'listitem'}
  >
    {#if chair !== null}<span class="chair">{chair}</span>{/if}
    <Avatar avatar={p.avatar} size={30} />
    <span class="name">{p.name}</span>
    {#if p.id === view.me}<small>{t('you')}</small>{/if}
    {#if p.id === view.host}<small>{t('host')}</small>{/if}
    {#if p.bot}{@const level = p.level ?? 'journeyman'}<small class="rank"><span class="sr-only">{t('bot')}: </span><BotRank {level} decorative />{t(`level_${level}`)}</small>{/if}
  </svelte:element>
{/snippet}

<div class="lobby">
  <section class="sheet roomcard">
    <span class="label">{t('code')}</span>
    <div class="coderow">
      <span class="code">{view.code}</span>
      <button class="btn small" type="button" onclick={copy}>{copied ? t('copied') : t('copyLink')}</button>
    </div>
    <div class="share">
      <div class="qr"><Qr url={link} /></div>
      <p class="hint">{t('invite')}<br /><span class="url">{link}</span></p>
    </div>
  </section>

  <section class="sheet seats">
    <div class="seathead">
      <h2 class="display">{t('table')}</h2>
      <span class="label">{seated.length}/{MAX}</span>
    </div>
    <div class="chairs" role="list">
      {#each seated as p, i (p.id)}{@render playerRow(p, i + 1)}{/each}
    </div>
    <p class="hint">{t('tableOrder')}</p>
    <div class="row">
      {#if amSeated}
        <button class="btn small quiet" type="button" onclick={(e) => act('sit', { seated: false }, e)}>{t('watch')}</button>
      {:else if seated.length < MAX}
        <button class="btn small" type="button" onclick={(e) => act('sit', { seated: true }, e)}>{t('sit')}</button>
      {/if}
      {#if isHost}
        <button class="btn small" type="button" disabled={seated.length < 2} onclick={(e) => act('shuffle', undefined, e)}>{t('shuffle')}</button>
        <button class="btn small" type="button" disabled={seated.length >= MAX} onclick={(e) => act('bot', { add: true }, e)}>{t('addBot')}</button>
      {/if}
    </div>
    {#if watching.length}
      <span class="label">{t('watchers')}</span>
      <div class="chairs" role="list">
        {#each watching as p (p.id)}{@render playerRow(p, null)}{/each}
      </div>
    {/if}
  </section>

  <section class="sheet setup" aria-label={t('settings')}>
    <HouseRules {rules} editable={isHost} onchange={changeRules} />
    <div class="setting">
      <span class="label">{t('clock')}</span>
      {#if isHost}
        <ewo-segmented stretch value={settings.clock} label={t('clock')} onchange={(e) => change({ clock: e.detail.value as Settings['clock'] })}>
          <option value="off">{t('clock_off')}</option>
          <option value="relaxed">{SECONDS.relaxed} s</option>
          <option value="quick">{SECONDS.quick} s</option>
        </ewo-segmented>
      {:else}
        <b class="value">{settings.clock === 'off' ? t('clock_off') : `${SECONDS[settings.clock]} s`}</b>
      {/if}
      {#if settings.clock !== 'off'}<span class="hint">{t('clockHint')}</span>{/if}
    </div>
    <div class="setting">
      <span class="label">{t('bots')}</span>
      {#if isHost}
        <ewo-segmented stretch value={settings.bots} label={t('bots')} onchange={(e) => change({ bots: e.detail.value as Level })}>
          {#each LEVELS as level (level)}<option value={level}>{t(`level_${level}`)}</option>{/each}
        </ewo-segmented>
      {:else}
        <b class="value">{t(`level_${settings.bots}`)}</b>
      {/if}
      <span class="hint">{t(`levelHint_${settings.bots}`)}</span>
    </div>
  </section>
  <GuideRow />

  <div class="go">
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if isHost}
      <button class="btn primary block" type="button" disabled={seated.length < MIN} onclick={(e) => act('start', undefined, e)}>{t('start')}</button>
      {#if seated.length < MIN}<p class="hint center">{t('needTwo')}</p>{/if}
    {:else}
      <p class="hint center">{t('startHint', { name: hostName })}</p>
    {/if}
  </div>
</div>

<PlayerMenu
  player={menuPlayer}
  seated={menuPlayer ? view.order.includes(menuPlayer.id) : false}
  full={seated.length >= MAX}
  first={menuAt === 0}
  last={menuAt === view.order.length - 1}
  onseat={(on, e) => void fromMenu('move', { player: menuFor, seated: on }, e)}
  onmove={moveSeat}
  onremove={(e) => {
    const p = menuPlayer;
    if (p) void fromMenu(p.bot ? 'bot' : 'kick', p.bot ? { add: false, player: p.id } : { player: p.id }, e);
  }}
  onlevel={(level, e) => void fromMenu('bot', { player: menuFor, level }, e, false)}
  onclose={() => ((menuFor = null), (menuError = ''))}
  error={menuError}
/>

<ewo-sheet open={avatarOpen} label={t('yourAvatar')} oncancel={() => (avatarOpen = false)} onclose={() => ((avatarShown = false), (avatarOpen = false))}>
  <span slot="heading">{t('yourAvatar')}</span>
  {#if avatarShown && myAvatar}
    <div class="menu">
      <AvatarMaker avatar={myAvatar} onchange={changeAvatar} />
      <button class="btn primary block" type="button" onclick={() => (avatarOpen = false)}>{t('back')}</button>
    </div>
  {/if}
</ewo-sheet>

<style>
  .lobby {
    display: grid;
    gap: 16px;
    max-width: 520px;
    margin: 12px auto 0;
  }
  .roomcard,
  .seats,
  .setup {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px 18px 16px;
  }
  .coderow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .code {
    font: 800 44px/1 var(--display);
    letter-spacing: 0.12em;
    color: var(--ink);
  }
  .share {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .qr {
    flex: none;
    width: 108px;
  }
  .url {
    overflow-wrap: anywhere;
    font: 400 13.5px/1.4 var(--text);
    color: var(--ink-2);
  }
  h2 {
    margin: 0;
    font-size: 22px;
    color: var(--ink);
  }
  .seathead {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  .chairs {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .player {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 46px;
    padding: 4px 10px 4px 4px;
    border: 0;
    border-bottom: 1px solid var(--line-2);
    background: none;
    color: var(--ink);
    font: 600 17px/1.2 var(--text);
    text-align: left;
  }
  button.player:hover {
    background: var(--ewo-fill-2);
  }
  .player.away {
    opacity: 0.55;
  }
  .player .name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .player small {
    padding: 3px 7px 2px;
    border-radius: 4px;
    background: var(--ewo-fill-3);
    font: 700 11.5px/1.2 var(--text);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--lagoon-text);
  }
  .player small.rank {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .chair {
    width: 22px;
    font: 800 16px/1 var(--display);
    text-align: center;
    color: var(--lagoon-text);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .hint {
    margin: 0;
    font-size: 13px;
    line-height: 1.4;
    color: var(--mute);
  }
  .center {
    text-align: center;
  }
  .setting {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .setting + .setting {
    padding-top: 12px;
    border-top: 1px solid var(--line-2);
  }
  .value {
    font: 800 18px/1.2 var(--display);
    color: var(--ink);
  }
  .go {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .menu {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-bottom: 8px;
  }
</style>
