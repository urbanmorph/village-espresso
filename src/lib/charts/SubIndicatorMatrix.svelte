<script lang="ts">
  import { FRAMEWORK, loadParameterScores, type Village } from '$lib/data';
  import { scoreBg, gapTone } from '$lib/colors';

  type Props = {
    village: Village;
    peers: Village[];
    selectedComponentCode: string;
  };

  let { village, peers, selectedComponentCode }: Props = $props();

  // Build the (village, parameter) -> score lookup once, after the lazy
  // scores.json chunk arrives.
  let byKey = $state<Map<string, number> | null>(null);
  $effect(() => {
    if (byKey !== null) return;
    loadParameterScores().then((rows) => {
      const m = new Map<string, number>();
      for (const r of rows) if (r.s != null) m.set(`${r.v}::${r.p}`, r.s);
      byKey = m;
    });
  });

  const paramScore = (villageCode: string, paramCode: string): number | null =>
    byKey?.get(`${villageCode}::${paramCode}`) ?? null;

  // Group parameters by sub-indicator → indicator → component, scoped to selectedComponent
  const params = $derived(
    selectedComponentCode === 'all'
      ? FRAMEWORK.parameters
      : FRAMEWORK.parameters.filter((p) => p.component === selectedComponentCode)
  );

  // Compute peer averages once per render
  const peerAvgs = $derived.by(() => {
    const out = new Map<string, number>();
    if (peers.length === 0) return out;
    for (const p of params) {
      let sum = 0;
      let n = 0;
      for (const pe of peers) {
        const s = paramScore(pe.code, p.parameter_code);
        if (s != null) {
          sum += s;
          n++;
        }
      }
      if (n > 0) out.set(p.parameter_code, Math.round(sum / n));
    }
    return out;
  });

  // Group rows: one per (indicator, sub_indicator)
  const grouped = $derived.by(() => {
    const map = new Map<string, { indicator: string; sub_indicator: string; rows: typeof params }>();
    for (const p of params) {
      const k = `${p.indicator}|${p.sub_indicator}`;
      if (!map.has(k))
        map.set(k, { indicator: p.indicator, sub_indicator: p.sub_indicator, rows: [] });
      map.get(k)!.rows.push(p);
    }
    return [...map.values()];
  });

  const cellBg = (s: number | null) => (s == null ? 'bg-neutral-200' : scoreBg(s));
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white">
  <div class="flex items-baseline justify-between border-b border-neutral-100 px-3 py-2">
    <h3 class="text-sm font-semibold tracking-tight">Sub-indicator matrix</h3>
    <span class="text-[11px] text-neutral-500">
      {selectedComponentCode === 'all' ? 'all components' : selectedComponentCode}
      · vs peer average
    </span>
  </div>
  <div class="min-h-0 flex-1 overflow-y-auto">
    <table class="w-full text-[11px]">
      <thead class="sticky top-0 bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500">
        <tr>
          <th class="px-3 py-1.5 text-left font-medium">Sub-indicator / Parameter</th>
          <th class="px-2 py-1.5 text-right font-medium">{village.name}</th>
          <th class="px-2 py-1.5 text-right font-medium">Peers</th>
          <th class="px-2 py-1.5 text-right font-medium">Δ</th>
        </tr>
      </thead>
      <tbody>
        {#each grouped as g}
          <tr class="bg-neutral-50/60">
            <td colspan="4" class="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">
              <span class="text-neutral-400">{g.indicator.replace(/^(Ec|Env|S)-?\s*/, '')}</span>
              <span class="mx-1 text-neutral-300">·</span>
              {g.sub_indicator}
            </td>
          </tr>
          {#each g.rows as p}
            {@const vScore = paramScore(village.code, p.parameter_code)}
            {@const pAvg = peerAvgs.get(p.parameter_code) ?? null}
            {@const gap = vScore != null && pAvg != null ? vScore - pAvg : null}
            <tr class="border-b border-neutral-100 last:border-b-0 hover:bg-neutral-50">
              <td class="px-3 py-1.5 text-neutral-700">{p.parameter_name}</td>
              <td class="px-2 py-1.5 text-right">
                {#if vScore != null}
                  <span class="inline-flex h-5 w-9 items-center justify-center rounded text-[11px] font-semibold tabular-nums text-white {cellBg(vScore)}">
                    {vScore}
                  </span>
                {:else}
                  <span class="text-neutral-300">—</span>
                {/if}
              </td>
              <td class="px-2 py-1.5 text-right tabular-nums text-neutral-500">
                {pAvg ?? '—'}
              </td>
              <td class={`px-2 py-1.5 text-right tabular-nums ${gap == null ? 'text-neutral-300' : gapTone(gap)}`}>
                {gap == null ? '—' : (gap >= 0 ? '+' : '') + gap}
              </td>
            </tr>
          {/each}
        {/each}
      </tbody>
    </table>
  </div>
</div>
