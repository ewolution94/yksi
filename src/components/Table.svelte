<!--
  The table, the same for a room and a game against bots (a MatchView to show, a Driver to ask): the
  bar (the round, the target, the clock, the scores, Settings), the others across the top in the order
  play goes (how many cards each holds, their points, "yksi!" when they've called), the stock and the
  pile in the middle with the colour in play, your hand along the bottom (Folio's card kit: flick a
  card or tap it twice; Hand.svelte), and the shout button by your right thumb.

  The shout button says what shouting means now: "yksi!" before you play your second-to-last card (it
  goes with that card), or right away if you're down to one and forgot; "Erwischt!" when someone else
  sits at one card without having called, which makes them draw two. A wild asks for its colour first,
  a 7 under the 7-0 rule for whom to swap with; a Wild Draw Four played on you asks whether to
  challenge it. Each question floats over the table above your hand, so the table keeps its size
  (learnings/projects/stichle.md). On an iPhone the page holds still while you play (Würfle's
  finding, learnings/ios-and-webkit.md).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiError, type Move } from '../lib/api';
  import { COLOURS, colourName, INK, isWild, parse, signSvg, type Colour } from '../lib/deck';
  import { errorText, i18n, t } from '../lib/i18n.svelte';
  import type { Driver, MatchView } from '../lib/match';
  import { play as sfx, unlockOnGesture } from '../lib/sound.svelte';
  import { stackPlace } from '../lib/table';
  import { askTilt } from '../lib/tilt';
  import Avatar from './Avatar.svelte';
  import Card from './Card.svelte';
  import Clock from './Clock.svelte';
  import Hand from './Hand.svelte';
  import Inspect from './Inspect.svelte';
  import RoundEnd from './RoundEnd.svelte';
  import ScoreSheet from './ScoreSheet.svelte';

  let { match, driver, onsettings }: { match: MatchView; driver: Driver; onsettings: () => void } = $props();

  const s = $derived(match.state);
  const n = $derived(s.players);
  const me = $derived(match.me);
  const home = $derived(me >= 0 ? me : 0);
  const playing = $derived(s.phase === 'play');
  const myTurn = $derived(playing && me >= 0 && s.turn === me && match.autopilot !== me);
  const hand = $derived(s.hand ?? []);
  const top = $derived(s.pile.at(-1) ?? null);
  const pending = $derived(s.pending && typeof s.pending.victim === 'number' ? s.pending : null);
  /** A Wild Draw Four played on you: challenge it, or take the cards (or, stacking, add a Four). */
  const challengedByMe = $derived(Boolean(myTurn && pending?.kind === 'd4' && pending.victim === me));
  /** Cards you owe under the stacking rule, while you may still add on. */
  const owed = $derived(myTurn && pending && pending.victim === me ? Number(pending.count ?? 0) : 0);
  /** Out of turn (jump-in): the cards identical to the top one. */
  const jumpable = $derived(playing && !myTurn ? s.jumpable : []);
  const nameAt = (seat: number) => (seat === me ? t('you') : (match.people[seat]?.name ?? '?'));
  /** The others in the order play goes from you (this round's direction). */
  const others = $derived(Array.from({ length: Math.max(0, n - 1) }, (_, i) => (home + s.dir * (1 + i) + n * 10) % n));

  // ---- messages -----------------------------------------------------------------------------

  let toast = $state('');
  let toastTimer = 0;
  function say(text: string, ms = 2400) {
    toast = text;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toast = ''), ms);
  }

  async function send(move: Move, from?: Element | Event | null) {
    try {
      await driver.move(move, from);
    } catch (e) {
      say(errorText(e instanceof ApiError ? e.code : ((e as { code?: string } | null)?.code ?? 'other')));
      throw e;
    }
  }

  // ---- the shout ----------------------------------------------------------------------------

  /** "yksi!" said before the second-to-last card: it goes with that card's play. */
  let armed = $state(false);
  $effect(() => {
    if (!myTurn || hand.length !== 2) armed = false;
  });
  const canCall = $derived(myTurn && hand.length === 2 && s.playable.length > 0);
  const iAmOpen = $derived(playing && me >= 0 && s.open === me);
  const someoneOpen = $derived(playing && s.open !== null && s.open !== me && me >= 0);
  const shout = $derived<'call' | 'late' | 'catch' | null>(someoneOpen ? 'catch' : iAmOpen ? 'late' : canCall ? 'call' : null);

  async function onShout(e: Event) {
    if (shout === 'catch') {
      await send({ type: 'catch' }, e).catch(() => {});
    } else if (shout === 'late') {
      await send({ type: 'call' }, e).catch(() => {});
    } else if (shout === 'call') {
      armed = !armed;
      if (armed) sfx.call();
    }
  }

  // ---- playing a card -----------------------------------------------------------------------

  /** A card that asks first: a wild (its colour), a 7 under 7-0 (whom to swap with). */
  let asking: { card: string; kind: 'colour' | 'swap' } | null = $state(null);
  $effect(() => {
    if (!myTurn) asking = null;
  });
  const swaps = (card: string) => Boolean(s.rules.sevenZero) && parse(card)?.f === '7' && hand.length > 1;

  function intercept(card: string) {
    const p = parse(card);
    if (!p) return false;
    // The last card ends the round: no colour to name, nobody to swap with.
    if (isWild(p.f) && hand.length > 1) {
      asking = { card, kind: 'colour' };
      return true;
    }
    if (swaps(card)) {
      asking = { card, kind: 'swap' };
      return true;
    }
    return false;
  }

  function playCard(card: string, extra: { colour?: Colour; swap?: number } = {}) {
    // Out of turn, a card identical to the top one jumps in (the house rule).
    const move: Move = !myTurn && jumpable.includes(card) ? { type: 'jump', card, ...(extra.colour ? { colour: extra.colour } : {}) } : { type: 'play', card, ...extra };
    if (armed) move.call = true;
    armed = false;
    return send(move);
  }

  function choose(c: Colour) {
    if (!asking) return;
    const card = asking.card;
    asking = null;
    void playCard(card, { colour: c }).catch(() => {});
  }

  function swapWith(seat: number) {
    if (!asking) return;
    const card = asking.card;
    asking = null;
    void playCard(card, { swap: seat }).catch(() => {});
  }

  function refused(card: string) {
    if (!myTurn) return say(t('notYourTurn'));
    if (pending?.kind === 'd4' && !s.playable.length) return say(t('hintChallenge'));
    if (owed) return say(t('youStack', { n: owed }));
    if (s.drawn && card !== s.drawn) return say(t('hintDrawnOnly'));
    const p = parse(card);
    if (p?.f === 'd4') return say(t('hintD4'));
    say(top && s.colour ? t('hintFit', { colour: colourName(s.colour, i18n.lang) }) : t('hintFitAny'));
  }

  // Where your card lands on the pile.
  let pileEl: HTMLDivElement | undefined = $state();
  let pileWidth = $state(90);
  const laidAt = (card: string, index: number) => stackPlace(card, index, pileWidth);
  function target(card: string) {
    if (!pileEl) return null;
    const r = pileEl.getBoundingClientRect();
    const at = laidAt(card, s.piled);
    return { x: r.left + r.width / 2 + at.dx, y: r.top + r.height / 2 + at.dy, rot: at.r, width: r.width };
  }

  let inspecting: string | null = $state(null);
  function inspect(card: string) {
    askTilt();
    inspecting = card;
  }

  // ---- what happened ------------------------------------------------------------------------

  // Each event said once, with a sound: who was skipped, drew, called, was caught, a challenge's end.
  let lastEvent = -1;
  let lastId = '';
  $effect(() => {
    const events = match.events;
    if (match.id !== lastId) {
      lastId = match.id;
      lastEvent = events.at(-1)?.n ?? 0;
      return;
    }
    const fresh = events.filter((e) => e.n > lastEvent);
    if (!fresh.length) return;
    lastEvent = events[events.length - 1].n;
    for (const e of fresh) {
      const seat = typeof e.seat === 'number' ? e.seat : -1;
      const mine = seat === me;
      if (e.type === 'play') sfx.lay();
      else if (e.type === 'draw') {
        sfx.draw();
        if (e.penalty && seat >= 0) say(mine ? t('drewYou', { n: Number(e.count) }) : t('drew', { name: nameAt(seat), n: Number(e.count) }));
      } else if (e.type === 'skip' && seat >= 0) say(mine ? t('skippedYou') : t('skipped', { name: nameAt(seat) }));
      else if (e.type === 'reverse') say(t('reversed'), 1800);
      else if (e.type === 'call' && seat >= 0) {
        sfx.call();
        say(mine ? t('calledYou') : t('called', { name: nameAt(seat) }), 1800);
      } else if (e.type === 'catch' && seat >= 0) {
        sfx.caught();
        const by = typeof e.by === 'number' ? nameAt(e.by) : '?';
        say(mine ? t('caughtYou', { name: by }) : t('caught', { name: nameAt(seat), by }), 2800);
      } else if (e.type === 'challenge' && seat >= 0) {
        const against = typeof e.against === 'number' ? e.against : -1;
        say(e.guilty ? t('challengeGuilty', { name: nameAt(against) }) : t('challengeInnocent', { name: nameAt(seat) }), 3200);
      } else if (e.type === 'reshuffle') say(t('reshuffled'), 1800);
      else if (e.type === 'swap') say(t('swapped'), 2000);
      else if (e.type === 'rotate') say(t('rotated'), 2000);
    }
  });

  // Your turn: a little sound, once per turn.
  let wasMine = false;
  $effect(() => {
    if (myTurn && !wasMine) sfx.yourTurn();
    wasMine = myTurn;
  });

  // After your challenge, the hand you were shown, until you've seen it.
  let peekSeen = $state('');
  const peek = $derived(s.peek && `${s.peek.from}:${s.peek.hand.join()}` !== peekSeen ? s.peek : null);

  const status = $derived.by(() => {
    if (me < 0) return t('watching');
    if (!playing) return '';
    if (match.autopilot === me) return t('autoYou');
    if (myTurn) {
      if (s.colour === null) return t('pickColourFirst');
      if (pending?.kind === 'd4') return t('youChallenge', { name: nameAt(pending.seat) });
      if (owed) return t('youStack', { n: owed });
      if (s.drawn) return t('youDrawn');
      return s.playable.length ? t('youPlay') : t('youDraw');
    }
    if (match.autopilot === s.turn) return t('auto', { name: nameAt(s.turn) });
    return t('theirTurn', { name: nameAt(s.turn) });
  });

  const roundLine = $derived(s.rules.target ? t('roundTo', { round: s.round, target: s.rules.target }) : t('roundOne'));
  let sheetOpen = $state(false);

  // ---- holding still --------------------------------------------------------------------------

  // On an iPhone, a touch on any part of the table that claims no drag lets iOS pull the whole page
  // (Würfle, 2026-10-20): every touchmove on the table is claimed, except in a part that scrolls.
  let tableEl: HTMLDivElement | undefined = $state();
  onMount(() => {
    unlockOnGesture();
    const el = tableEl;
    if (!el) return;
    const hold = (e: TouchEvent) => {
      const at = e.target instanceof Element ? e.target : null;
      if (at?.closest('[data-scroll]')) return;
      if (e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchmove', hold, { passive: false });
    return () => el.removeEventListener('touchmove', hold);
  });
</script>

<div class="table" bind:this={tableEl}>
  <header class="top">
    <span class="round">{roundLine}</span>
    {#if match.endsAt && playing}<Clock left={(at, now) => driver.left(at, now)} endsAt={match.endsAt} tick={myTurn} />{/if}
    <button class="btn small quiet scores" type="button" onclick={() => (sheetOpen = true)}>{t('scores')}</button>
    <!-- A real <button> sits inside the element: Enter and Space reach this handler as a click. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <ewo-settings-button onclick={onsettings}></ewo-settings-button>
  </header>

  <ol class="seats" class:many={others.length > 4} aria-label={t('players')}>
    {#each others as seat (seat)}
      {@const p = match.people[seat]}
      {@const count = s.counts[seat] ?? 0}
      <li class="seat" class:on={playing && s.turn === seat} class:open={s.open === seat} class:gone={p?.gone || (!p?.online && !p?.bot)}>
        <span class="av">{#if p?.avatar}<Avatar avatar={p.avatar} size={30} ring={false} />{/if}<b class="n" aria-hidden="true">{count}</b></span>
        <span class="who">{p?.name ?? '?'}</span>
        <span class="held"><span class="k" aria-label={t('cards', { n: count })}><svg viewBox="0 0 10 14" aria-hidden="true"><rect x=".5" y=".5" width="9" height="13" rx="1.6" /></svg>{count}</span><span class="pts" aria-label={t('pointsOf', { n: match.totals[seat] ?? 0 })}>{match.totals[seat] ?? 0}</span></span>
        {#if s.open === seat}<span class="tag warn">{t('oneLeft')}</span>{:else if count === 1}<span class="tag">yksi!</span>{/if}
      </li>
    {/each}
  </ol>

  <div class="felt">
    <svg class="ring" class:ccw={s.dir === -1} viewBox="0 0 236 236" aria-hidden="true"
      ><g fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 7" stroke-linecap="round"><path d="M118 8 A110 110 0 0 1 228 118" /><path d="M118 228 A110 110 0 0 1 8 118" /></g><path
        d="M222 104 L228 120 L236 106"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      /><path d="M14 132 L8 116 L0 130" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg
    >
    <div class="middle">
      <button
        class="stock"
        type="button"
        disabled={!myTurn || Boolean(asking) || s.colour === null}
        onclick={(e) => void send(s.drawn ? { type: 'pass' } : { type: 'draw' }, e).catch(() => {})}
        aria-label={s.drawn ? t('keep') : t('drawBtn', { n: s.stock })}
      >
        {#each { length: Math.min(4, Math.max(1, Math.ceil(s.stock / 12))) } as _, k (k)}
          <span class="back" style:translate="{k * -1.5}px {k * -1.5}px"><Card back /></span>
        {/each}
        <span class="count">{s.stock}</span>
      </button>
      <div class="pile" bind:this={pileEl} bind:clientWidth={pileWidth}>
        {#each s.pile as card, i (`${s.piled - s.pile.length + i}:${card}`)}
          {@const at = laidAt(card, s.piled - s.pile.length + i)}
          <span class="laid" style:translate="{at.dx.toFixed(1)}px {at.dy.toFixed(1)}px" style:rotate="{at.r.toFixed(1)}deg" style:z-index={i}><Card id={card} /></span>
        {/each}
        {#if s.colour && top && isWild(parse(top)?.f ?? '0')}<span class="halo" style:--c={INK[s.colour]}></span>{/if}
      </div>
    </div>
    {#if s.colour}
      <p class="colour"><span class="mark">{@html signSvg(s.colour)}</span>{t('inPlay', { colour: colourName(s.colour, i18n.lang) })}{#if pending}<b class="owed">+{pending.count}</b>{/if}</p>
    {/if}
  </div>

  <div class="dock">
    {#if toast}
      <p class="status toast" role="alert">{toast}</p>
    {:else if status && !asking && !challengedByMe}
      <p class="status" class:mine={myTurn} aria-live="polite">{status}</p>
    {/if}

    {#if myTurn && s.colour === null}
      <div class="panel sheet">
        <span class="label">{t('pickColourFirst')}</span>
        <div class="colours">
          {#each COLOURS as c (c)}
            <button class="btn colourbtn" type="button" style:--c={INK[c]} onclick={(e) => void send({ type: 'colour', colour: c }, e).catch(() => {})}>
              <span class="mark">{@html signSvg(c, c === 'y' ? '#2b2410' : '#fbfaf5')}</span>{colourName(c, i18n.lang)}
            </button>
          {/each}
        </div>
      </div>
    {:else if asking?.kind === 'colour'}
      <div class="panel sheet">
        <span class="label">{t('pickColour')}</span>
        <div class="colours">
          {#each COLOURS as c (c)}
            <button class="btn colourbtn" type="button" style:--c={INK[c]} onclick={() => choose(c)}>
              <span class="mark">{@html signSvg(c, c === 'y' ? '#2b2410' : '#fbfaf5')}</span>{colourName(c, i18n.lang)}
            </button>
          {/each}
        </div>
        <button class="btn quiet small" type="button" onclick={() => (asking = null)}>{t('back')}</button>
      </div>
    {:else if asking?.kind === 'swap'}
      <div class="panel sheet">
        <span class="label">{t('pickSwap')}</span>
        <div class="swaps">
          {#each others as seat (seat)}
            <button class="btn small" type="button" onclick={() => swapWith(seat)}>{nameAt(seat)} · {t('cards', { n: s.counts[seat] ?? 0 })}</button>
          {/each}
        </div>
        <button class="btn quiet small" type="button" onclick={() => (asking = null)}>{t('back')}</button>
      </div>
    {:else if challengedByMe && pending}
      <div class="panel sheet">
        <span class="label">{t('d4On', { name: nameAt(pending.seat) })}</span>
        <p class="ask">{t('challengeAsk', { name: nameAt(pending.seat) })}</p>
        <div class="pair">
          <button class="btn primary" type="button" onclick={(e) => void send({ type: 'challenge' }, e).catch(() => {})}>{t('challenge')}</button>
          <button class="btn" type="button" onclick={(e) => void send({ type: 'draw' }, e).catch(() => {})}>{t('takeFour', { n: owed || 4 })}</button>
        </div>
      </div>
    {:else if peek}
      <div class="panel sheet">
        <span class="label">{t('peekOf', { name: nameAt(peek.from) })}</span>
        <div class="peek" data-scroll>
          {#each peek.hand as card (card)}<span class="mini"><Card id={card} /></span>{/each}
        </div>
        <button class="btn small" type="button" onclick={() => (peekSeen = `${peek.from}:${peek.hand.join()}`)}>{t('ok')}</button>
      </div>
    {/if}

    <div class="actions">
      {#if myTurn && s.drawn}
        <button class="btn small" type="button" onclick={(e) => void send({ type: 'pass' }, e).catch(() => {})}>{t('keep')}</button>
      {:else if myTurn && !challengedByMe && s.colour !== null}
        <button class="btn small" type="button" onclick={(e) => void send({ type: 'draw' }, e).catch(() => {})}>{owed ? t('drawN', { n: owed }) : t('draw')}</button>
      {/if}
      <span class="me">
        {#if me >= 0}
          {@const p = match.people[me]}
          {#if p?.avatar}<Avatar avatar={p.avatar} size={24} ring={false} />{/if}
          <b>{match.totals[me] ?? 0}</b>
        {/if}
      </span>
    </div>

    <button
      class="shout"
      class:ready={shout !== null && !(shout === 'call' && armed)}
      class:armed={shout === 'call' && armed}
      class:catch={shout === 'catch'}
      type="button"
      disabled={shout === null}
      aria-pressed={shout === 'call' ? armed : undefined}
      onclick={onShout}
    >{shout === 'catch' ? t('catchBtn') : 'yksi!'}</button>

    {#if me >= 0}
      <Hand
        cards={hand}
        legal={myTurn ? s.playable : jumpable}
        canPlay={((myTurn && s.colour !== null) || jumpable.length > 0) && !asking}
        onplay={(card) => playCard(card)}
        {target}
        oninspect={inspect}
        onrefuse={refused}
        {intercept}
        marked={s.drawn}
      />
    {:else}
      <p class="watching">{t('watching')}</p>
    {/if}
  </div>
</div>

{#if s.phase === 'scored'}
  <RoundEnd {match} {driver} />
{/if}

<Inspect card={inspecting} onclose={() => (inspecting = null)} />
<ScoreSheet open={sheetOpen} {match} onclose={() => (sheetOpen = false)} />

<style>
  .table {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    padding: calc(env(safe-area-inset-top, 0px) + 6px) 10px calc(env(safe-area-inset-bottom, 0px) + 6px);
    overflow: hidden;
    overscroll-behavior: none;
    background-color: var(--ground);
    /* The four signs printed big and faint across the paper (Kangas). */
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='168' height='148' viewBox='0 0 168 148'%3E%3Cg fill='%23000' fill-opacity='.028'%3E%3Cpath d='M30 12 53 52H7Z'/%3E%3Crect x='96' y='14' width='36' height='36' rx='4'/%3E%3Ccircle cx='72' cy='104' r='20'/%3E%3Cpath d='M150 82 170 104 150 126 130 104Z'/%3E%3C/g%3E%3C/svg%3E");
    background-size: 168px 148px;
    color: var(--ink);
  }
  :global(:root[data-theme='dark']) .table {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='168' height='148' viewBox='0 0 168 148'%3E%3Cg fill='%23fff' fill-opacity='.035'%3E%3Cpath d='M30 12 53 52H7Z'/%3E%3Crect x='96' y='14' width='36' height='36' rx='4'/%3E%3Ccircle cx='72' cy='104' r='20'/%3E%3Cpath d='M150 82 170 104 150 126 130 104Z'/%3E%3C/g%3E%3C/svg%3E");
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .table {
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='168' height='148' viewBox='0 0 168 148'%3E%3Cg fill='%23fff' fill-opacity='.035'%3E%3Cpath d='M30 12 53 52H7Z'/%3E%3Crect x='96' y='14' width='36' height='36' rx='4'/%3E%3Ccircle cx='72' cy='104' r='20'/%3E%3Cpath d='M150 82 170 104 150 126 130 104Z'/%3E%3C/g%3E%3C/svg%3E");
    }
  }
  /* On a wide screen: one table in the middle (learnings/ui-preferences.md). */
  @media (min-width: 720px) {
    .table {
      padding-inline: max(16px, calc((100vw - 640px) / 2));
    }
  }

  .top {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 0 0 6px;
  }
  .round {
    flex: 1 1 auto;
    min-width: 0;
    font: 700 12px/1.2 var(--text);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--mute);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .scores {
    min-height: 34px;
    padding: 0 10px;
  }

  /* The others, in the order play goes from you: one row of up to four, then two rows of smaller ones. */
  .seats {
    flex: none;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
    gap: 6px;
    margin: 4px 0 0;
    padding: 0;
    list-style: none;
  }
  .seats.many {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
  .seat {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: auto auto;
    align-items: center;
    column-gap: 7px;
    min-width: 0;
    min-height: 52px;
    padding: 6px 8px;
    border-radius: 14px;
    background: var(--panel);
    border: 1.5px solid transparent;
    box-shadow: 0 1px 0 var(--line-2);
    transition: border-color 0.2s, background-color 0.2s;
  }
  .seat.on {
    border-color: var(--lagoon);
  }
  .seat.open {
    border-color: var(--sun);
    animation: nudge 1s ease-in-out infinite;
  }
  @keyframes nudge {
    50% {
      translate: 0 -2px;
    }
  }
  .seat.gone {
    opacity: 0.55;
  }
  .av {
    position: relative;
    grid-row: 1 / 3;
    display: grid;
  }
  .n {
    position: absolute;
    right: -6px;
    bottom: -4px;
    min-width: 19px;
    padding: 2px 4px;
    border-radius: 999px;
    background: var(--lagoon);
    color: var(--lagoon-ink);
    font: 800 11px/1 var(--display);
    text-align: center;
    box-shadow: 0 0 0 2px var(--panel);
  }
  .who {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 700 13.5px/1.2 var(--text);
  }
  .held {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    min-width: 0;
    white-space: nowrap;
    font: 600 13px/1.2 var(--display);
    font-variant-numeric: tabular-nums;
    color: var(--ink);
  }
  .k {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .held svg {
    flex: none;
    width: 9px;
    height: 13px;
    fill: var(--lagoon);
  }
  .pts {
    font-size: 11.5px;
    color: var(--sun-text);
  }
  /* The count on the avatar only where the chips are small. */
  .n {
    display: none;
  }
  .seats.many .n {
    display: block;
  }
  .seats.many .held {
    display: none;
  }
  .tag {
    position: absolute;
    top: -8px;
    right: 6px;
    padding: 2px 6px;
    border-radius: 999px;
    background: var(--sun);
    color: var(--sun-ink);
    font: 800 10px/1.2 var(--display);
  }
  .tag.warn {
    background: var(--bad);
    color: #ffffff;
  }
  /* Seven to nine others: the avatar and its count, the name under it, small. */
  .seats.many .seat {
    grid-template-columns: 1fr;
    justify-items: center;
    row-gap: 2px;
    padding: 6px 4px 5px;
  }
  .seats.many .av {
    grid-row: auto;
  }
  .seats.many .who {
    max-width: 100%;
    font-size: 11.5px;
  }


  /* The middle: the stock and the pile, the way play goes round them, the colour in play under them. */
  .felt {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
  }
  .ring {
    position: absolute;
    left: 50%;
    top: 46%;
    width: min(236px, 62vw);
    aspect-ratio: 1;
    translate: -50% -50%;
    color: var(--mute);
    opacity: 0.5;
    transition: transform 0.5s;
    pointer-events: none;
  }
  .ring.ccw {
    transform: scaleX(-1);
  }
  .middle {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: clamp(22px, 9vw, 48px);
  }
  .stock,
  .pile {
    position: relative;
    width: clamp(84px, 28vw, 120px);
    aspect-ratio: 5 / 7;
  }
  .stock {
    padding: 0;
    border: 0;
    background: none;
    -webkit-tap-highlight-color: transparent;
  }
  .stock:disabled {
    cursor: default;
  }
  .stock:not(:disabled) .back:last-of-type :global(.face) {
    box-shadow: 0 0 0 3px var(--sun), var(--card-shadow);
  }
  .back,
  .laid {
    position: absolute;
    inset: 0;
  }
  .laid {
    animation: lay 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.2) backwards;
  }
  @keyframes lay {
    from {
      scale: 1.15;
      opacity: 0;
    }
  }
  .halo {
    position: absolute;
    inset: -9px;
    z-index: 20;
    border-radius: 14px;
    border: 3.5px solid var(--c);
    pointer-events: none;
  }
  .stock .count {
    position: absolute;
    right: -8px;
    bottom: -8px;
    left: auto;
    min-width: 28px;
    padding: 4px 6px;
    border-radius: 999px;
    background: var(--raised);
    color: var(--ink);
    font: 800 12px/1 var(--display);
    text-align: center;
    box-shadow: var(--card-shadow);
  }
  .colour {
    position: relative;
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0;
    padding: 5px 12px 5px 9px;
    border-radius: 999px;
    background: var(--raised);
    border: 1px solid var(--line);
    font: 700 13.5px/1.2 var(--text);
  }
  .colour .mark :global(svg) {
    display: block;
    width: 15px;
    height: 15px;
  }
  .owed {
    margin-left: 4px;
    color: var(--bad);
    font: 800 13px/1 var(--display);
  }

  /* Your end of the table: the status floats above it, then your draw or keep, your points, the
     shout by your right thumb, your hand. Nothing here changes height while you play. */
  .dock {
    position: relative;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .status {
    position: absolute;
    z-index: 6;
    left: 50%;
    bottom: calc(100% + 8px);
    translate: -50% 0;
    width: max-content;
    max-width: calc(100% - 24px);
    margin: 0;
    padding: 5px 13px;
    border-radius: 999px;
    background: var(--raised);
    border: 1px solid var(--line);
    font: 600 14px/1.3 var(--text);
    text-align: center;
    color: var(--ink-2);
  }
  .status.mine {
    background: var(--ink);
    color: var(--ground);
    border-color: var(--ink);
  }
  .toast {
    background: var(--ink);
    color: var(--ground);
  }
  .panel {
    position: absolute;
    z-index: 30;
    left: 0;
    right: 0;
    bottom: calc(100% + 8px);
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 440px;
    margin-inline: auto;
    padding: 16px 16px 14px;
    animation: rise 0.28s cubic-bezier(0.2, 0.9, 0.3, 1.1) both;
  }
  @keyframes rise {
    from {
      translate: 0 14px;
      opacity: 0;
    }
  }
  .ask {
    margin: 0;
    font-size: 14.5px;
    line-height: 1.4;
  }
  .colours {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .colourbtn {
    justify-content: flex-start;
    gap: 10px;
    border-color: var(--c);
    background: var(--c);
    color: #fbfaf5;
  }
  .colourbtn:nth-child(2) {
    color: #2b2410;
  }
  .colourbtn .mark :global(svg) {
    display: block;
    width: 20px;
    height: 20px;
  }
  .swaps {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .peek {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .mini {
    flex: none;
    width: 46px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    padding: 0 96px 0 4px;
  }
  .me {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    font: 800 14px/1 var(--display);
    color: var(--mute);
  }
  .watching {
    margin: 10px 0 18px;
    text-align: center;
    color: var(--mute);
  }

  /* The shout: round, by the right thumb, over the hand's top right corner. */
  .shout {
    position: absolute;
    z-index: 8;
    right: 4px;
    top: -30px;
    width: 76px;
    height: 76px;
    border: 0;
    border-radius: 50%;
    background: var(--lagoon);
    color: var(--lagoon-ink);
    font: 800 17px/1 var(--display);
    box-shadow: 0 8px 18px -8px rgb(0 0 0 / 0.5);
    opacity: 0.4;
    transition: opacity 0.2s, transform 0.15s, background-color 0.2s;
    -webkit-tap-highlight-color: transparent;
  }
  .shout:disabled {
    cursor: default;
  }
  .shout.ready {
    opacity: 1;
    animation: ready 1.1s ease-in-out infinite;
  }
  .shout.armed {
    opacity: 1;
    background: var(--sun);
    color: var(--sun-ink);
  }
  .shout.catch {
    background: var(--bad);
    color: #ffffff;
  }
  .shout:active:not(:disabled) {
    transform: scale(0.94);
  }
  .shout:focus-visible {
    outline: 3px solid var(--sun);
    outline-offset: 3px;
  }
  @keyframes ready {
    50% {
      box-shadow:
        0 0 0 9px rgb(242 182 0 / 0.45),
        0 8px 18px -8px rgb(0 0 0 / 0.5);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .shout.ready {
      animation: none;
      box-shadow: 0 0 0 6px rgb(242 182 0 / 0.45);
    }
    .seat.open {
      animation: none;
    }
  }
</style>
