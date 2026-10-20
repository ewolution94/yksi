<!--
  A player's seal from their three numbers, drawn by Folio's token emblem (src/lib/avatar.ts): a
  round seal with a division and a charge, ringed in the night's navy.
-->
<script lang="ts">
  import type { Avatar } from '../lib/avatar';

  let { avatar, size = 40, ring = true }: { avatar: Avatar; size?: number; ring?: boolean } = $props();
</script>

<ewo-emblem class="av" theme="token" value={avatar} {size} {ring}></ewo-emblem>

<style>
  .av {
    --ewo-emblem-ink: var(--ground);
    --ewo-emblem-paper: var(--ink);
  }
</style>
