<script lang="ts">
  import {
    INDICATORS,
    COMPONENTS,
    indicatorScore,
    avgInComponent,
    effectiveScore,
    type Village
  } from '$lib/data';

  type Props = {
    village: Village;
    peers: Village[]; // currently filtered villages, used for ranking + comparison
    selectedIndicatorCode: string;
    selectedComponentCode: string;
  };

  let { village, peers, selectedIndicatorCode, selectedComponentCode }: Props = $props();

  const componentInds = $derived(
    selectedComponentCode === 'all'
      ? INDICATORS
      : INDICATORS.filter((i) => i.component === selectedComponentCode)
  );

  const villageAvg = $derived(avgInComponent(village.code, selectedComponentCode));

  // Rank by avg-in-current-component among peers
  const peersAvgs = $derived(
    peers.map((p) => ({ code: p.code, avg: avgInComponent(p.code, selectedComponentCode) }))
  );
  const rankAvg = $derived.by(() => {
    const sorted = [...peersAvgs].sort((a, b) => b.avg - a.avg);
    const idx = sorted.findIndex((p) => p.code === village.code);
    return idx === -1 ? null : { rank: idx + 1, total: sorted.length };
  });

  // Best / worst indicator for this village WITHIN the current component scope
  const indicatorList = $derived(
    componentInds.map((i) => ({ ...i, score: indicatorScore(village.code, i.code) }))
  );
  const best = $derived([...indicatorList].sort((a, b) => b.score - a.score)[0]);
  const worst = $derived([...indicatorList].sort((a, b) => a.score - b.score)[0]);

  // Selected indicator card — honors component scope when 'overall'
  const selScore = $derived(effectiveScore(village.code, selectedComponentCode, selectedIndicatorCode));
  const selPeerAvg = $derived(
    peers.length === 0
      ? 0
      : Math.round(
          peers.reduce(
            (s, p) => s + effectiveScore(p.code, selectedComponentCode, selectedIndicatorCode),
            0
          ) / peers.length
        )
  );
  const selLabel = $derived(
    selectedIndicatorCode === 'overall'
      ? selectedComponentCode === 'all'
        ? 'Overall'
        : `${COMPONENTS.find((c) => c.code === selectedComponentCode)?.label ?? ''} avg`
      : INDICATORS.find((i) => i.code === selectedIndicatorCode)?.label ?? selectedIndicatorCode
  );

  function colorFor(s: number) {
    if (s >= 70) return { bg: 'bg-emerald-500', text: 'text-emerald-700' };
    if (s >= 50) return { bg: 'bg-lime-400', text: 'text-lime-800' };
    if (s >= 35) return { bg: 'bg-amber-400', text: 'text-amber-800' };
    if (s >= 20) return { bg: 'bg-orange-500', text: 'text-orange-700' };
    return { bg: 'bg-rose-500', text: 'text-rose-700' };
  }
  const selColor = $derived(colorFor(selScore));
  const bestColor = $derived(colorFor(best.score));
  const worstColor = $derived(colorFor(worst.score));

  const gap = $derived(selScore - selPeerAvg);
</script>

<div class="grid grid-cols-2 gap-3">
  <!-- Households + rank -->
  <div class="rounded-lg border border-neutral-200 bg-white px-3 py-2">
    <div class="text-[10px] font-medium tracking-wide text-neutral-500 uppercase">Households</div>
    <div class="mt-0.5 text-2xl font-semibold tabular-nums">{village.households ?? '—'}</div>
    <div class="text-[11px] text-neutral-500">
      {#if rankAvg}
        rank {rankAvg.rank} / {rankAvg.total} by avg
      {/if}
    </div>
  </div>

  <!-- Selected indicator vs peers -->
  <div class="rounded-lg border border-neutral-200 bg-white px-3 py-2">
    <div class="flex items-baseline justify-between">
      <div class="text-[10px] font-medium tracking-wide text-neutral-500 uppercase truncate">
        {selLabel}
      </div>
      <div class={`text-[10px] font-medium tabular-nums ${selColor.text}`}>{selScore}</div>
    </div>
    <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
      <div class={`h-full ${selColor.bg}`} style="width:{Math.max(2, selScore)}%"></div>
    </div>
    <div class="mt-1 flex items-center justify-between text-[11px] text-neutral-500">
      <span>peer avg {selPeerAvg}</span>
      <span class={gap >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
        {gap >= 0 ? '+' : ''}{gap}
      </span>
    </div>
  </div>

  <!-- Strongest -->
  <div class="rounded-lg border border-neutral-200 bg-white px-3 py-2">
    <div class="text-[10px] font-medium tracking-wide text-neutral-500 uppercase">Strongest</div>
    <div class="mt-0.5 truncate text-sm font-semibold">{best.label}</div>
    <div class="flex items-baseline gap-2 text-xs">
      <span class={`text-base font-semibold tabular-nums ${bestColor.text}`}>{best.score}</span>
      <span class="text-neutral-400">/100</span>
    </div>
  </div>

  <!-- Weakest -->
  <div class="rounded-lg border border-neutral-200 bg-white px-3 py-2">
    <div class="text-[10px] font-medium tracking-wide text-neutral-500 uppercase">Weakest</div>
    <div class="mt-0.5 truncate text-sm font-semibold">{worst.label}</div>
    <div class="flex items-baseline gap-2 text-xs">
      <span class={`text-base font-semibold tabular-nums ${worstColor.text}`}>{worst.score}</span>
      <span class="text-neutral-400">/100</span>
    </div>
  </div>
</div>
