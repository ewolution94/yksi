<script lang="ts">
  import { t } from '../lib/i18n.svelte';
</script>

<footer class="foot">
  <a href="https://ewolution.cloud/">ewolution.cloud</a>
  <a href="https://apps.ewolution.cloud/">{t('allApps')}</a>
</footer>

<style>
  .foot {
    position: relative;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 24px;
    max-width: var(--page);
    margin: 0 auto;
    padding: 20px var(--gutter) 40px;
    font: 600 12.5px / 1.4 var(--text);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--mute);
  }
  a {
    text-decoration: none;
  }
  a:hover {
    color: var(--ink);
  }
</style>
