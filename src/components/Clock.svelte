<!-- Seconds left until the server's deadline, ticking down; the last ten turn red (and tick, if asked). -->
<script lang="ts">
  import { play } from '../lib/sound.svelte';

  let { left, endsAt, tick = false }: { left: (at: number, now?: number) => number; endsAt: number; tick?: boolean } = $props();

  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(timer);
  });
  const secs = $derived(Math.ceil(left(endsAt, now) / 1000));
  let ticked = -1;
  $effect(() => {
    if (tick && secs > 0 && secs <= 5 && secs !== ticked) {
      ticked = secs;
      play.tick();
    }
  });
</script>

<span class="clock" class:urgent={secs <= 10} role="timer" aria-live="off">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>

<style>
  .clock {
    font: 800 15px/1 var(--display);
    font-variant-numeric: lining-nums tabular-nums;
    letter-spacing: 0.02em;
    padding: 4px 8px 3px;
    border-radius: 4px;
    background: var(--ground);
    color: var(--sun-text);
    box-shadow: 0 0 0 1.5px var(--sun-text);
  }
  .urgent {
    background: var(--bad);
    color: var(--sun-ink);
    box-shadow: none;
  }
</style>
