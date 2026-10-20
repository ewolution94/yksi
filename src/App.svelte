<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError, CODE, type Seat } from './lib/api';
  import { Room } from './lib/room.svelte';
  import { forgetSeat, saveName, savedAvatar, savedSeat, saveSeat } from './lib/session';
  import { Solo, type SoloSetup } from './lib/solo.svelte';
  import { loadCensus } from './lib/census';
  import Bar from './components/Bar.svelte';
  import Home from './components/Home.svelte';
  import Join from './components/Join.svelte';
  import Game from './components/Game.svelte';
  import SoloGame from './components/SoloGame.svelte';
  import Footer from './components/Footer.svelte';
  import Guide from './components/Guide.svelte';

  // The whole app is one page. "/" is the start; "/solo" a game against bots; "/KXPT" is a table,
  // and the link people share.
  let path = $state(location.pathname);
  const code = $derived(codeFrom(path));
  const soloPath = $derived(path === '/solo');
  let room: Room | null = $state.raw(null);
  let solo: Solo | null = $state.raw(null);
  /** Arriving at a room with a saved seat: reclaiming it before anything shows. */
  let reclaiming = $state(false);
  /** At the table: it fills the screen, without the bar and footer. */
  const playing = $derived(atTable(room) || (soloPath && soloPlaying(solo)));

  function atTable(r: Room | null) {
    return r?.view?.phase === 'play' && Boolean(r.view.game);
  }
  function soloPlaying(s: Solo | null) {
    return Boolean(s && !s.view.over);
  }

  function codeFrom(p: string) {
    const segment = p.replace(/^\/+|\/+$/g, '').toUpperCase();
    return CODE.test(segment) ? segment : null;
  }

  function go(to: string, replace = false) {
    if (location.pathname !== to) history[replace ? 'replaceState' : 'pushState'](null, '', to);
    path = to;
  }

  /**
   * Into a room: its stream opens and the screen changes once the first view is there, so the lobby
   * shows whole. Until then the button that asked holds (Folio's track()); `signal` gives up.
   */
  async function enter(seat: Seat, signal?: AbortSignal) {
    const next = new Room(seat.code, seat);
    next.connect();
    try {
      await next.ready(signal);
    } catch (error) {
      next.close();
      throw error;
    }
    saveSeat(seat);
    room?.close();
    room = next;
    go(`/${seat.code}`);
    // The start page may have been scrolled (the keyboard for the name): the room starts at its top.
    scrollTo(0, 0);
  }

  function leaveRoom() {
    if (room) forgetSeat(room.code);
    room?.close();
    room = null;
    go('/');
  }

  /** Removed from a room (kicked, or gone too long in the lobby): drop the seat and ask for a name again. */
  function rejoin() {
    if (room) forgetSeat(room.code);
    room?.close();
    room = null;
  }

  /** Coming back to a room's link: take the saved seat again (the server checks it). */
  async function reclaim(c: string) {
    const seat = savedSeat(c);
    if (!seat) return;
    reclaiming = true;
    try {
      const ready = new AbortController();
      const timer = setTimeout(() => ready.abort(), 15_000);
      await enter(await api.join(c, '', null, seat.token, undefined, ready.signal), ready.signal).finally(() => clearTimeout(timer));
    } catch (error) {
      if (error instanceof ApiError && error.code !== 'offline') forgetSeat(c);
    } finally {
      reclaiming = false;
    }
  }

  /** A game alone: a new one, or (no setup) the one left unfinished on this device. */
  let lastSetup: SoloSetup | null = null;
  let lastName = '';
  function startSolo(setup: SoloSetup | null, name: string) {
    saveName(name);
    lastName = name;
    solo?.close();
    solo = setup ? new Solo(setup, { name, avatar: savedAvatar() }) : Solo.resume({ name, avatar: savedAvatar() });
    lastSetup = solo?.setup ?? null;
    if (solo) go('/solo');
  }

  $effect(() => {
    // Leaving a room by navigating (back button) closes its stream.
    if (room && room.code !== code) {
      room.close();
      room = null;
    }
    if (code && !room && !reclaiming) void reclaim(code);
    // At /solo with no game in hand (a reload): the saved one, or the start page.
    if (soloPath && !solo) {
      const resumed = Solo.resume({ name: lastName || 'Du', avatar: savedAvatar() });
      if (resumed) solo = resumed;
      else go('/', true);
    }
    if (!soloPath && solo) {
      solo.close();
      solo = null;
    }
  });

  /** The connection, for the pill: quiet while a button already says it (New table, Join). */
  const connection = $derived(connectionOf(room, reclaiming));
  function connectionOf(r: Room | null, coming: boolean) {
    if (coming) return 'connecting';
    if (!r || r.live) return 'online';
    return r.wasLive ? 'reconnecting' : 'connecting';
  }

  onMount(() => {
    // An unknown path (an old link, a typo) is the start page.
    if (!code && !soloPath && path !== '/') go('/', true);
    const onPop = () => (path = location.pathname);
    addEventListener('popstate', onPop);
    loadCensus();
    return () => removeEventListener('popstate', onPop);
  });
</script>

{#if !playing}<Bar code={room ? room.code : null} />{/if}

<main class:playing>
  {#if solo && soloPath}
    <SoloGame
      {solo}
      onagain={() => lastSetup && startSolo(lastSetup, lastName || solo?.view.people[0]?.name || 'Du')}
      onhome={() => {
        solo?.close();
        solo = null;
        go('/');
      }}
    />
  {:else if room}
    <Game {room} onleave={leaveRoom} onrejoin={rejoin} />
  {:else if code}
    {#if !reclaiming}
      <Join
        {code}
        onjoin={async (seat, name, signal) => {
          saveName(name);
          await enter(seat, signal);
        }}
        onback={() => go('/')}
      />
    {/if}
  {:else}
    <Home
      oncreate={async (seat, name, signal) => {
        saveName(name);
        await enter(seat, signal);
      }}
      onjoin={(c) => go(`/${c}`)}
      onsolo={startSolo}
    />
  {/if}
</main>

{#if !playing}<Footer />{/if}

<!-- How to play, opened from anywhere (src/lib/ui.svelte.ts). -->
<Guide />

<!-- A room that's gone (a deploy, or forgotten) closed its stream on purpose: no pill, nothing to reconnect. -->
{#if room && room.view?.phase !== 'gone'}
  <ewo-connection class="connection" state={connection} class:in-game={playing}></ewo-connection>
{/if}

<style>
  /* The connection pill (Folio's <ewo-connection>): under the bar, or at the top of the table. */
  .connection {
    --ewo-connection-top: calc(env(safe-area-inset-top, 0px) + var(--bar-h) + 8px);
    --ewo-connection-bg: var(--ink);
    --ewo-connection-fg: var(--ground);
    --ewo-connection-font: var(--ewo-sans);
  }
  .connection.in-game {
    --ewo-connection-top: calc(env(safe-area-inset-top, 0px) + 60px);
  }
  main {
    position: relative;
    z-index: 1;
    max-width: var(--page);
    min-height: calc(100dvh - var(--bar-h) - 120px);
    margin: 0 auto;
    padding: 8px var(--gutter) 48px;
  }
  main.playing {
    max-width: none;
    min-height: 0;
    padding: 0;
  }

  /* In the browser (not installed), Safari's toolbar floats over the bottom of the page. */
  @media not (display-mode: standalone) {
    @supports (-webkit-touch-callout: none) {
      main:not(.playing) {
        padding-bottom: 96px;
      }
    }
  }
</style>
