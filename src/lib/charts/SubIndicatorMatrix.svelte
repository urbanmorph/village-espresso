<script lang="ts">
  import scoresJson from '../../../data/processed/scores.json';
  import { FRAMEWORK, type Village } from '$lib/data';

  type ScoreRow = { v: string; p: string; s: number | null };
  const SCORES = scoresJson as ScoreRow[];

  type Props = {
    village: Village;
    peers: Village[];
    selectedComponentCode: string;
  };

  let { village, peers, selectedComponentCode }: Props = $props();

  // Index scores by (village, parameter) for fast lookup
  const byKey = new Map<string, number>();
  for (const r of SCORES) {
    if (r.s != null) byKey.set(`${r.v}::${r.p}`, r.s);
  }

  function paramScore(villageCode: string, paramCode: string): number | null {
    const v = byKey.get(`${villageCode}::${paramCode}`);
    return v ?? null;
  }

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

  function colorForGap(gap: number): string {
    if (gap >= 10) return 'text-emerald-600';
    if (gap >= 0) return 'text-emerald-500';
    if (gap >= -10) return 'text-orange-500';
    return 'text-rose-600';
  }

  function colorBg(s: number | null): string {
    if (s == null) return 'bg-neutral-200';
    if (s >= 70) return 'bg-emerald-500';
    if (s >= 50) return 'bg-lime-400';
    if (s >= 35) return 'bg-amber-400';
    if (s >= 20) return 'bg-orange-500';
    return 'bg-rose-500';
  }
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
                  <span class="inline-flex h-5 w-9 items-center justify-center rounded text-[11px] font-semibold tabular-nums text-white {colorBg(vScore)}">
                    {vScore}
                  </span>
                {:else}
                  <span class="text-neutral-300">—</span>
                {/if}
              </td>
              <td class="px-2 py-1.5 text-right tabular-nums text-neutral-500">
                {pAvg ?? '—'}
              </td>
              <td class={`px-2 py-1.5 text-right tabular-nums ${gap == null ? 'text-neutral-300' : colorForGap(gap)}`}>
                {gap == null ? '—' : (gap >= 0 ? '+' : '') + gap}
              </td>
            </tr>
          {/each}
        {/each}
      </tbody>
    </table>
  </div>
</div>
