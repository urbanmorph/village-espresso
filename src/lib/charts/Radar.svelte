<script lang="ts">
  import { INDICATORS, indicatorScore, type Village } from '$lib/data';

  type Props = {
    village: Village;
    peers: Village[]; // benchmark overlay (mean across peers)
  };

  let { village, peers }: Props = $props();

  const W = 360;
  const H = 360;
  const cx = W / 2;
  const cy = H / 2;
  const R = 130;

  const inds = INDICATORS;
  const N = inds.length;

  function pointAt(i: number, value: number): [number, number] {
    const angle = (i / N) * 2 * Math.PI - Math.PI / 2;
    const r = (value / 100) * R;
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  }

  function labelAt(i: number, padding = 18): { x: number; y: number; anchor: 'start' | 'middle' | 'end' } {
    const angle = (i / N) * 2 * Math.PI - Math.PI / 2;
    const x = cx + Math.cos(angle) * (R + padding);
    const y = cy + Math.sin(angle) * (R + padding);
    const anchor: 'start' | 'middle' | 'end' =
      Math.abs(Math.cos(angle)) < 0.2 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end';
    return { x, y, anchor };
  }

  function polygonPath(vals: number[]): string {
    return vals
      .map((v, i) => {
        const [x, y] = pointAt(i, v);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ') + ' Z';
  }

  const villageVals = $derived(inds.map((i) => indicatorScore(village.code, i.code)));
  const peerVals = $derived(
    inds.map((i) => {
      if (peers.length === 0) return 0;
      const sum = peers.reduce((s, p) => s + indicatorScore(p.code, i.code), 0);
      return Math.round(sum / peers.length);
    })
  );

  const rings = [25, 50, 75, 100];
</script>

<div class="flex h-full min-h-0 flex-col rounded-lg border border-neutral-200 bg-white p-3">
  <div class="mb-1 flex items-baseline justify-between">
    <h3 class="text-sm font-semibold tracking-tight">Indicator radar</h3>
    <div class="flex items-center gap-3 text-[10px] text-neutral-500">
      <span class="flex items-center gap-1">
        <span class="inline-block h-2 w-3 rounded-sm bg-neutral-900/85"></span>{village.name}
      </span>
      <span class="flex items-center gap-1">
        <span class="inline-block h-2 w-3 rounded-sm border border-neutral-400"></span>peer avg
      </span>
    </div>
  </div>

  <svg viewBox="0 0 {W} {H}" class="m-auto block max-h-full w-auto max-w-full">
    <!-- rings -->
    {#each rings as r}
      <circle cx={cx} cy={cy} r={(r / 100) * R} fill="none" stroke="#e5e7eb" stroke-width="0.6" />
    {/each}
    <!-- spokes -->
    {#each inds as _, i}
      {@const [x, y] = pointAt(i, 100)}
      <line x1={cx} y1={cy} x2={x} y2={y} stroke="#e5e7eb" stroke-width="0.6" />
    {/each}

    <!-- peer overlay -->
    <path d={polygonPath(peerVals)} fill="#94a3b8" fill-opacity="0.12" stroke="#94a3b8" stroke-width="1" stroke-dasharray="3 3" />
    <!-- village -->
    <path d={polygonPath(villageVals)} fill="#0a0a0a" fill-opacity="0.12" stroke="#0a0a0a" stroke-width="1.5" />
    <!-- village vertices -->
    {#each villageVals as v, i}
      {@const [x, y] = pointAt(i, v)}
      <circle cx={x} cy={y} r="2.5" fill="#0a0a0a" />
    {/each}

    <!-- axis labels -->
    {#each inds as ind, i}
      {@const lp = labelAt(i)}
      <text
        x={lp.x}
        y={lp.y}
        text-anchor={lp.anchor}
        dominant-baseline="middle"
        class="fill-neutral-700"
        style="font-size:10px;font-family:ui-sans-serif,system-ui;"
      >
        {ind.label}
      </text>
    {/each}
  </svg>
</div>
