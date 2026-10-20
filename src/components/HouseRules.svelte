<!--
  How far the match goes and the house rules (server/rules.mjs → RULES; all off by default, as in the
  printed rules): for whoever sets the table (alone: you; at a table: the host), the state for
  everyone else. Each switch says what it does underneath.
-->
<script lang="ts">
  import { HOUSE_RULES, TARGETS, type HouseRule, type Rules, type Target } from '../lib/api';
  import { t } from '../lib/i18n.svelte';

  let { rules, editable = true, onchange }: { rules: Rules; editable?: boolean; onchange?: (patch: Partial<Rules>) => void } = $props();

  const targetName = (n: Target) => (n === 0 ? t('targetRound') : t('targetPoints', { n }));
  const on = $derived(HOUSE_RULES.filter((k) => rules[k]));
</script>

<div class="rules">
  <div class="setting">
    <span class="label">{t('target')}</span>
    {#if editable}
      <ewo-segmented stretch value={String(rules.target)} label={t('target')} onchange={(e) => onchange?.({ target: Number(e.detail.value) as Target })}>
        {#each TARGETS as n (n)}<option value={String(n)}>{targetName(n)}</option>{/each}
      </ewo-segmented>
    {:else}
      <b class="value">{targetName(rules.target)}</b>
    {/if}
    <span class="hint">{rules.target === 0 ? t('targetHintRound') : t('targetHint', { n: rules.target })}</span>
  </div>

  <div class="setting">
    <span class="label">{t('houseRules')}</span>
    {#if editable}
      {#each HOUSE_RULES as k (k)}
        <div class="rule">
          <div class="line">
            <span class="name">{t(`rule_${k}`)}</span>
            <ewo-switch checked={rules[k]} aria-label={t(`rule_${k}`)} onchange={(e) => onchange?.({ [k]: e.detail.checked } as Partial<Rules>)}></ewo-switch>
          </div>
          <span class="hint">{t(`ruleHint_${k}`)}</span>
        </div>
      {/each}
    {:else}
      <b class="value">{on.length ? on.map((k: HouseRule) => t(`rule_${k}`)).join(', ') : t('houseRulesNone')}</b>
    {/if}
  </div>
</div>

<style>
  .rules,
  .setting {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .rules {
    gap: 16px;
  }
  .rule {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 0 8px;
    border-top: 1px solid var(--line-2);
  }
  .line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 32px;
  }
  .name {
    font: 600 15.5px/1.3 var(--text);
  }
  .value {
    font: 600 16px/1.3 var(--text);
  }
  .hint {
    font-size: 13px;
    line-height: 1.4;
    color: var(--mute);
  }
</style>
