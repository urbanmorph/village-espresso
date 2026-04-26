<script lang="ts">
  import type { Village } from '$lib/data';
  import { scoreHex } from '$lib/colors';

  type Props = {
    label: string;
    villages: Village[];
    indicatorCode: string;
    selectedVillageCode: string;
    isHighlighted: boolean;
    scoreFor: (villageCode: string, indicatorCode: string) => number;
    onSelectVillage: (code: string) => void;
    onSelectIndicator: () => void;
  };

  let {
    label,
    villages,
    indicatorCode,
    selectedVillageCode,
    isHighlighted,
    scoreFor,
    onSelectVillage,
    onSelectIndicator
  }: Props = $props();

  const W = 720;
  const H = 36;
  const PAD_L = 8;
  const PAD_R = 8;
  const trackY = H / 2;

  function x(score: number): number {
    return PAD_L + (score / 100) * (W - PAD_L - PAD_R);
  }

  function r(households: number | null): number {
    const h = households ?? 80;
    return Math.max(3, Math.min(9, Math.sqrt(h) / 2));
  }

  const sortedVillages = $derived(
    [...villages].sort((a, b) => {
      const aSel = a.code === selectedVillageCode ? 1 : 0;
      const bSel = b.code === selectedVillageCode ? 1 : 0;
      if (aSel !== bSel) return aSel - bSel;
      return (a.households ?? 0) - (b.households ?? 0);
    })
  );

  const avg = $derived(
    villages.length === 0
      ? 0
      : villages.reduce((s, v) => s + scoreFor(v.code, indicatorCode), 0) / villages.length
  );

  const minV = $derived(
    villages.length === 0
      ? null
      : villages.reduce((m, v) =>
          scoreFor(v.code, indicatorCode) < scoreFor(m.code, indicatorCode) ? v : m
        )
  );
  const maxV = $derived(
    villages.length === 0
      ? null
      : villages.reduce((m, v) =>
          scoreFor(v.code, indicatorCode) > scoreFor(m.code, indicatorCode) ? v : m
        )
  );
</script>

<div
  class="grid grid-cols-[160px_1fr_60px] items-center gap-3 rounded px-2 py-1.5 {isHighlighted
    ? 'bg-neutral-100'
    : 'hover:bg-neutral-50'}"
>
  <button
    class="truncate text-left text-xs font-medium {isHighlighted
      ? 'text-neutral-900'
      : 'text-neutral-700'} hover:underline"
    onclick={onSelectIndicator}
    title="Select {label}"
  >
    {label}
  </button>

  <svg viewBox="0 0 {W} {H}" class="h-9 w-full">
    <line x1={PAD_L} y1={trackY} x2={W - PAD_R} y2={trackY} stroke="#e5e7eb" stroke-width="1" />
    <line x1={x(50)} y1={trackY - 6} x2={x(50)} y2={trackY + 6} stroke="#d1d5db" stroke-width="1" />
    <line
      x1={x(avg)}
      y1={trackY - 9}
      x2={x(avg)}
      y2={trackY + 9}
      stroke="#6b7280"
      stroke-width="1"
      stroke-dasharray="2 2"
    />

    {#each sortedVillages as v}
      {@const s = scoreFor(v.code, indicatorCode)}
      {@const isSelected = v.code === selectedVillageCode}
      <circle
        cx={x(s)}
        cy={trackY}
        r={isSelected ? r(v.households) + 1 : r(v.households)}
        fill={scoreHex(s)}
        fill-opacity={isSelected ? 1 : 0.55}
        stroke={isSelected ? '#0a0a0a' : 'white'}
        stroke-width={isSelected ? 1.5 : 0.5}
        class="cursor-pointer"
        role="button"
        tabindex="0"
        aria-label="{v.name}, {v.district}: {s}"
        onclick={() => onSelectVillage(v.code)}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectVillage(v.code);
          }
        }}
      >
        <title>{v.name} · {v.district} · {s}</title>
      </circle>
    {/each}
  </svg>

  <div class="flex items-baseline justify-end gap-1 text-[11px] text-neutral-500 tabular-nums">
    <span class="font-medium text-neutral-700">{Math.round(avg)}</span>
    <span class="text-neutral-400">avg</span>
  </div>
</div>

{#if isHighlighted && minV && maxV}
  <div class="ml-[172px] mr-[68px] flex justify-between text-[10px] text-neutral-500">
    <span>↓ {minV.name} ({scoreFor(minV.code, indicatorCode)})</span>
    <span>↑ {maxV.name} ({scoreFor(maxV.code, indicatorCode)})</span>
  </div>
{/if}
