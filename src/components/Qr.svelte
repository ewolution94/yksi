<script lang="ts">
  // The room's link as a QR code, drawn here as one SVG path (no markup injected, so the CSP stays
  // strict). For the meeting room: the host's screen shows it, phones scan it.
  import { encode } from 'uqr';
  import { t } from '../lib/i18n.svelte';

  let { url }: { url: string } = $props();

  const qr = $derived(encode(url, { ecc: 'M', border: 0 }));
  const path = $derived(
    qr.data
      .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : '')))
      .join(''),
  );
</script>

<figure class="qr">
  <svg viewBox="-2 -2 {qr.size + 4} {qr.size + 4}" role="img" aria-label={t('qrLabel', { url })} shape-rendering="crispEdges">
    <rect x="-2" y="-2" width={qr.size + 4} height={qr.size + 4} rx="2" />
    <path d={path} />
  </svg>
</figure>

<style>
  .qr {
    margin: 0;
  }
  svg {
    display: block;
    width: 100%;
    height: auto;
  }
  rect {
    fill: #ffffff;
  }
  path {
    fill: #1a2321;
  }
</style>
