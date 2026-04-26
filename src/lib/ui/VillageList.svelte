<script lang="ts">
  import {
    INDICATORS,
    avgInComponent,
    effectiveScore,
    type Village
  } from '$lib/data';
  import { scoreBg, scoreText } from '$lib/colors';

  type SortMode = 'score' | 'name' | 'district' | 'imbalance';

  type Props = {
    villages: Village[];
    selectedVillageCode: string;
    selectedIndicatorCode: string;
    selectedComponentCode: string;
    onSelect: (code: string) => void;
  };

  let {
    villages,
    selectedVillageCode,
    selectedIndicatorCode,
    selectedComponentCode,
    onSelect
  }: Props = $props();

  let sort = $state<SortMode>('score');
  let query = $state('');
  let listEl: HTMLUListElement;

  // when selection changes from outside (map / strip plot), scroll the row
  // into view so the user sees the highlight without hunting for it.
  $effect(() => {
    if (!selectedVillageCode || !listEl) return;
    const row = listEl.querySelector<HTMLElement>(`[data-code="${selectedVillageCode}"]`);
    if (!row) return;
    const r = row.getBoundingClientRect();
    const c = listEl.getBoundingClientRect();
    if (r.top < c.top || r.bottom > c.bottom) {
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });

  const indicatorVal = (v: Village) =>
    effectiveScore(v.code, selectedComponentCode, selectedIndicatorCode);

  function imbalance(v: Village): number {
    let min = Infinity;
    let max = -Infinity;
    for (const i of INDICATORS) {
      const s = effectiveScore(v.code, 'all', i.code);
      if (s < min) min = s;
      if (s > max) max = s;
    }
    return max - min;
  }

  const COMPARATORS: Record<SortMode, (a: Village, b: Village) => number> = {
    score: (a, b) => indicatorVal(b) - indicatorVal(a),
    name: (a, b) => a.name.localeCompare(b.name),
    district: (a, b) => a.district.localeCompare(b.district) || a.name.localeCompare(b.name),
    imbalance: (a, b) => imbalance(b) - imbalance(a)
  };

  const ranked = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? villages.filter((v) => `${v.name} ${v.district}`.toLowerCase().includes(q))
      : villages;
    return [...filtered].sort(COMPARATORS[sort]);
  });
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white">
  <div class="border-b border-neutral-200 px-3 py-2">
    <div class="flex items-center gap-2">
      <input
        type="search"
        placeholder="Search villages or districts…"
        bind:value={query}
        class="flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs outline-none focus:border-neutral-400 focus:bg-white"
      />
      <select
        class="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs"
        bind:value={sort}
      >
        <option value="score">Sort: score</option>
        <option value="name">Sort: name</option>
        <option value="district">Sort: district</option>
        <option value="imbalance">Sort: imbalance</option>
      </select>
    </div>
    <div class="mt-1.5 flex items-center justify-between text-[11px] text-neutral-500">
      <span>{ranked.length} of {villages.length}</span>
      <span class="tabular-nums">
        {selectedIndicatorCode === 'overall' ? 'overall avg' : selectedIndicatorCode}
      </span>
    </div>
  </div>

  <ul bind:this={listEl} class="min-h-0 flex-1 divide-y divide-neutral-100 overflow-y-auto">
    {#each ranked as v, i (v.code)}
      {@const sel = indicatorVal(v)}
      {@const overall = avgInComponent(v.code, selectedComponentCode)}
      {@const isSelected = v.code === selectedVillageCode}
      <li>
        <button
          type="button"
          data-code={v.code}
          class="grid w-full grid-cols-[28px_1fr_auto] items-center gap-2 px-3 py-2 text-left hover:bg-neutral-50 {isSelected
            ? 'border-l-2 border-neutral-900 bg-neutral-200/70 pl-[10px]'
            : ''}"
          onclick={() => onSelect(v.code)}
        >
          <span class="text-right text-[10px] tabular-nums text-neutral-400">{i + 1}</span>

          <span class="min-w-0">
            <span class="block truncate text-sm font-medium leading-tight">{v.name}</span>
            <span class="block truncate text-[11px] text-neutral-500"
              >{v.district} · {v.state} · {v.households ?? '—'} HHs</span
            >
            <!-- single avg-score bar — width = village avg, color = bucket -->
            <span class="mt-1 block h-1.5 w-full overflow-hidden rounded-sm bg-neutral-100">
              <span
                class="block h-full rounded-sm {scoreBg(overall)}"
                style="width:{Math.max(2, overall)}%"
              ></span>
            </span>
          </span>

          <span class="flex flex-col items-end gap-0.5">
            <span
              class="inline-flex h-7 min-w-9 items-center justify-center rounded px-1 text-xs font-semibold tabular-nums {scoreBg(
                sel
              )} {scoreText(sel)}"
            >
              {sel}
            </span>
            {#if selectedIndicatorCode !== 'overall'}
              <span class="text-[10px] tabular-nums text-neutral-400">avg {overall}</span>
            {/if}
          </span>
        </button>
      </li>
    {/each}
  </ul>
</div>
